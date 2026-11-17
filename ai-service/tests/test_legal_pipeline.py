from datetime import date
import hashlib
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from legal_corpus import load_snapshot
import snapshot_api


class LegalPipelineAndFullSnapshotTests(unittest.TestCase):
    def test_repo_45_doc_snapshot_manifest_loads_and_verifies_used_machinery(self):
        manifest_path = Path(__file__).resolve().parents[2] / "research" / "snapshot-manifest.json"
        snapshot = load_snapshot(manifest_path)
        self.assertEqual(snapshot.document_count, 45)
        self.assertGreater(snapshot.provision_count, 2000)
        lathe = snapshot.lookup("18/2019/QĐ-TTg", "Phụ lục I", "1.e", "", date(2026, 11, 17))
        self.assertIsNotNone(lathe)
        self.assertIn("84.58", lathe.text)
        # 28/2022/QĐ-TTg effective from 2023-03-01: should NOT be active in 2020
        self.assertIsNone(snapshot.lookup("28/2022/QĐ-TTg", "Phụ lục I", "1.6", "", date(2020, 1, 1)))
        self.assertIsNotNone(snapshot.lookup("28/2022/QĐ-TTg", "Phụ lục I", "1.6", "", date(2026, 11, 17)))

    def test_legal_pipeline_adapter_honors_evidence_and_preserves_wrong_citation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src = b"law-source"
            (root / "law.bin").write_bytes(src)
            src_text = "Máy tiện thuộc nhóm mã HS 84.58 có tuổi thiết bị không vượt quá 20 năm."
            manifest = root / "manifest.json"
            manifest.write_text(
                json.dumps(
                    {
                        "snapshot_id": "pipe-v1",
                        "documents": [
                            {
                                "document_id": "18/2019/QĐ-TTg",
                                "title": "Quyết định nhập khẩu máy móc đã qua sử dụng",
                                "source_url": "https://vanban.chinhphu.vn/?docid=196855&pageid=27160",
                                "source_file": "law.bin",
                                "source_sha256": hashlib.sha256(src).hexdigest(),
                                "retrieved_at": "2026-11-17T00:00:00+00:00",
                                "provisions": [
                                    {
                                        "article": "Phụ lục I",
                                        "clause": "1.e",
                                        "point": "",
                                        "text": src_text,
                                        "effective_from": "2019-06-15",
                                        "effective_until": None,
                                        "reviewed_by": "editor",
                                        "reviewed_at": "2026-11-17T08:00:00+07:00",
                                        "status_evidence_url": "https://vanban.chinhphu.vn/?docid=196855&pageid=27160",
                                        "verified_through": "2026-11-17",
                                    }
                                ],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            mock_adapter = types.ModuleType("_mock_askpay_adapter")
            mock_adapter.retrieve = lambda **kw: [{"document": "18/2019/QĐ-TTg", "article": "Phụ lục I", "clause": "1.e", "point": ""}]
            mock_adapter.answer = lambda **kw: {
                "status": "ANSWERED",
                "answer": "Máy tiện mã HS 84.58 tối đa 20 năm.",
                "citations": [{"document": "18/2019/QĐ-TTg", "article": "Phụ lục I", "clause": "1.e", "point": "", "excerpt": src_text}],
            }
            mock_adapter.assess = lambda **kw: {"relevant": True, "supported": True}
            sys.modules["_mock_askpay_adapter"] = mock_adapter
            self.addCleanup(lambda: sys.modules.pop("_mock_askpay_adapter", None))

            with patch.dict(os.environ, {"ASKPAY_CORPUS_MANIFEST": str(manifest), "ASKPAY_LEGAL_ADAPTER": "_mock_askpay_adapter"}):
                res = main.ask_legal_question(main.AskRequest(question_id="0x11", question="Tuổi máy tiện?", as_of="2026-11-17"))
                self.assertEqual(res["answer_method"], "LEGALIR_LEGALQA")
                self.assertEqual(res["answer_status"], "ANSWERED")
                self.assertTrue(res["validation"]["passed"])
                self.assertFalse(res["validation"]["settlement_eligible"])


if __name__ == "__main__":
    unittest.main()
