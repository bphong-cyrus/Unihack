import hashlib
import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from factcheck import check_claim
from legal_corpus import load_snapshot
import main
from fastapi import HTTPException
from unittest.mock import patch


class FactcheckTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        source = b'synthetic law source'
        (root / 'law.pdf').write_bytes(source)
        self.text = 'Đối với hàng hóa nhập khẩu, nộp trước ngày hàng hóa đến cửa khẩu hoặc trong thời hạn 30 ngày kể từ ngày hàng hóa đến cửa khẩu.'
        manifest = {'snapshot_id': 'fixture', 'documents': [{'document_id': '54/2014/QH13', 'title': 'Luật fixture',
            'source_url': 'https://example.gov.vn/law', 'source_file': 'law.pdf',
            'source_sha256': hashlib.sha256(source).hexdigest(), 'retrieved_at': '2025-01-01T00:00:00+00:00',
            'provisions': [{'article': '25', 'clause': '1', 'point': '', 'text': self.text, 'status': 'ACTIVE', 'review_status': 'VERIFIED',
                'effective_from': '2020-01-01', 'effective_until': None, 'reviewed_by': 'fixture',
                'reviewed_at': '2025-01-01T00:00:00+00:00', 'verified_through': '2025-01-01',
                'status_evidence_url': 'https://example.gov.vn/status'}]}]}
        path = root / 'snapshot.json'
        path.write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
        self.snapshot = load_snapshot(path)

    def test_exact_requested_article_is_not_replaced_by_another(self):
        result = check_claim(self.snapshot, '54/2014/QH13', '999', '9', '', self.text, date(2024, 1, 1))
        self.assertFalse(result['passed'])
        self.assertEqual(result['citation']['article'], '999')
        self.assertEqual(result['fail_reason'], 'ARTICLE_OR_CLAUSE_NOT_FOUND')

    def test_altered_number_is_reported_against_requested_source(self):
        result = check_claim(self.snapshot, '54/2014/QH13', '25', '1', '', self.text.replace('30 ngày', '60 ngày'), date(2024, 1, 1))
        self.assertFalse(result['passed'])
        self.assertIn({'input': '60', 'source': '30'}, result['differences'])

    def test_endpoint_requires_reviewed_snapshot_and_preserves_requested_citation(self):
        request = main.FactcheckRequest(document='54/2014/QH13', article='999', clause='9', excerpt=self.text, as_of='2024-01-01')
        with patch('main.configured_snapshot', return_value=self.snapshot):
            result = main.factcheck_endpoint(request)
        self.assertEqual(result['citation']['article'], '999')
        self.assertFalse(result['passed'])
        with patch('main.configured_snapshot', return_value=None), self.assertRaises(HTTPException) as error:
            main.factcheck_endpoint(request)
        self.assertEqual(error.exception.status_code, 503)


if __name__ == '__main__':
    unittest.main()
