import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
import main


class SnapshotApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        source = b'synthetic source'
        (root / 'source.bin').write_bytes(source)
        self.text = 'Hồ sơ hải quan phải bao gồm tờ khai hải quan và chứng từ hàng hóa'
        self.manifest = root / 'corpus.json'
        self.manifest.write_text(json.dumps({'snapshot_id': 'test-snapshot', 'documents': [{
            'document_id': 'TEST/2020', 'title': 'Synthetic document', 'source_url': 'https://example.gov.vn/document',
            'source_file': 'source.bin', 'source_sha256': hashlib.sha256(source).hexdigest(),
            'retrieved_at': '2025-01-01T00:00:00+00:00',
            'provisions': [{'article': '1', 'clause': '1', 'point': '', 'text': self.text, 'status': 'ACTIVE', 'review_status': 'VERIFIED',
                            'effective_from': '2022-01-01', 'effective_until': None,
                            'reviewed_by': 'fixture', 'reviewed_at': '2025-01-01T00:00:00+00:00',
                            'status_evidence_url': 'https://example.gov.vn/status', 'verified_through': '2025-01-01'}]}]}, ensure_ascii=False))
        patcher = patch.dict(os.environ, {'ASKPAY_CORPUS_MANIFEST': str(self.manifest)})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_ask_retrieves_and_validates_the_same_snapshot(self):
        result = main.ask_legal_question(main.AskRequest(question_id='q1', question='Hồ sơ hải quan gồm tờ khai nào?', tier='quick', as_of='2023-01-01'))
        self.assertEqual(result['question_id'], 'q1')
        self.assertEqual(result['snapshot_id'], 'test-snapshot')
        self.assertEqual(result['citations'][0]['excerpt'], self.text)
        self.assertTrue(result['validation']['passed'])
        self.assertFalse(result['validation']['settlement_eligible'])
        self.assertEqual(result['validation']['corpus_status'], 'REVIEW_ASSERTED')
        self.assertEqual(result['validation']['citation_checks'][0]['source_url'], 'https://example.gov.vn/document')
        self.assertEqual(result['answer_method'], 'EXTRACTIVE')
        self.assertEqual(result['payment_status'], 'DISABLED')

    def test_ask_unknown_or_not_yet_effective_returns_no_citation(self):
        for question, query_date in [('Tỷ giá đô la hôm nay?', '2023-01-01'), ('Hồ sơ hải quan tờ khai', '2021-12-31')]:
            with self.subTest(question=question):
                result = main.ask_legal_question(main.AskRequest(question=question, as_of=query_date))
                self.assertEqual(result['citations'], [])
                self.assertFalse(result['validation']['passed'])

    def test_validate_and_corpus_use_configured_snapshot(self):
        citation = {'document': 'TEST/2020', 'article': '1', 'clause': '1', 'excerpt': self.text}
        result = main.validate_endpoint(main.ValidateRequest(citations=[citation], as_of='2023-01-01'))
        self.assertTrue(result['passed'])
        self.assertEqual(result['snapshot_id'], 'test-snapshot')
        corpus = main.get_corpus()
        self.assertEqual(corpus['snapshot_id'], 'test-snapshot')
        self.assertEqual(corpus['total_documents'], 1)

    def test_snapshot_manifest_hash_is_consistent_across_endpoints(self):
        expected = hashlib.sha256(self.manifest.read_bytes()).hexdigest()
        ask = main.ask_legal_question(main.AskRequest(question='Hồ sơ hải quan tờ khai', as_of='2023-01-01'))
        validation = main.validate_endpoint(main.ValidateRequest(citations=[], as_of='2023-01-01'))
        self.assertEqual(ask['snapshot_sha256'], expected)
        self.assertEqual(validation['snapshot_sha256'], expected)
        self.assertEqual(main.get_corpus()['snapshot_sha256'], expected)
        self.manifest.write_text(self.manifest.read_text() + ' ')
        self.assertNotEqual(main.get_corpus()['snapshot_sha256'], expected)

    def test_configured_bad_manifest_never_falls_back_to_demo(self):
        self.manifest.write_text('{}')
        for call in [lambda: main.get_corpus(), lambda: main.validate_endpoint(main.ValidateRequest(citations=[])),
                     lambda: main.ask_legal_question(main.AskRequest(question='Hồ sơ hải quan'))]:
            with self.subTest(call=call), self.assertRaises(HTTPException) as error:
                call()
            self.assertEqual(error.exception.status_code, 503)

    def test_debug_simulation_is_rejected_for_snapshot(self):
        with self.assertRaises(HTTPException) as error:
            main.ask_legal_question(main.AskRequest(question='hồ sơ', simulate_hallucination=True))
        self.assertEqual(error.exception.status_code, 400)


if __name__ == '__main__':
    unittest.main()
