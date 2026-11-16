import hashlib
import json
import os
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from legal_corpus import load_snapshot
from legal_corpus import CorpusError
from snapshot_api import configured_snapshot
from snapshot_search import retrieve


class JsonlSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        source = b'source bytes'
        (self.root / 'source.pdf').write_bytes(source)
        self.path = self.root / 'snapshot.jsonl'
        self.chunk = {
            'doc_id': 'TEST/2020', 'doc_title': 'Test law', 'article': '1', 'clause': '1',
            'raw_text': 'Hồ sơ hải quan bao gồm tờ khai và chứng từ theo quy định của pháp luật',
            'status': 'ACTIVE', 'review_status': 'VERIFIED', 'effective_from': '2020-01-01',
            'effective_until': None, 'reviewed_by': 'reviewer', 'reviewed_at': '2025-01-01T00:00:00+00:00',
            'verified_through': '2025-01-01', 'status_evidence_url': 'https://example.gov.vn/status',
            'source_url': 'https://example.gov.vn/law', 'source_file': 'source.pdf',
            'source_sha256': hashlib.sha256(source).hexdigest(), 'retrieved_at': '2025-01-01T00:00:00+00:00',
        }

    def test_jsonl_retrieval_only_returns_verified_chunks(self):
        second = dict(self.chunk, clause='2', review_status='UNREVIEWED', raw_text='Hồ sơ hải quan chứng từ chưa được duyệt')
        self.path.write_text('\n'.join(json.dumps(x, ensure_ascii=False) for x in [self.chunk, second]), encoding='utf-8')
        snapshot = load_snapshot(self.path)
        results = retrieve(snapshot, 'hồ sơ hải quan tờ khai chứng từ', date(2024, 1, 1), 8)
        self.assertEqual([item.clause for item in results], ['1'])
        self.assertEqual(snapshot.provision_count, 2)

    def test_missing_configured_snapshot_produces_clear_503(self):
        with patch.dict(os.environ, {'CORPUS_SNAPSHOT_PATH': str(self.path)}, clear=True):
            with self.assertRaises(HTTPException) as error:
                configured_snapshot()
        self.assertEqual(error.exception.status_code, 503)
        self.assertIn('snapshot', str(error.exception.detail).lower())
        self.assertIn(str(self.path), str(error.exception.detail))

    def test_expired_or_unknown_status_never_retrieved(self):
        rows = [dict(self.chunk, clause='1', status='EXPIRED'), dict(self.chunk, clause='2', status='UNKNOWN')]
        self.path.write_text('\n'.join(json.dumps(row, ensure_ascii=False) for row in rows), encoding='utf-8')
        snapshot = load_snapshot(self.path)
        self.assertEqual(retrieve(snapshot, 'hồ sơ hải quan tờ khai', date(2024, 1, 1), 3), [])

    def test_default_missing_snapshot_fails_closed(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(HTTPException) as error:
                configured_snapshot()
        self.assertEqual(error.exception.status_code, 503)
        self.assertIn('corpus_snapshot.jsonl', str(error.exception.detail))

    def test_unreviewed_metadata_cannot_promote_a_chunk(self):
        self.path.write_text(json.dumps(dict(self.chunk, review_status='UNREVIEWED'), ensure_ascii=False), encoding='utf-8')
        snapshot = load_snapshot(self.path)
        self.assertEqual(retrieve(snapshot, 'hồ sơ hải quan tờ khai', date(2024, 1, 1), 3), [])

    def test_verified_chunk_without_review_provenance_is_rejected(self):
        self.path.write_text(json.dumps(dict(self.chunk, reviewed_by=None), ensure_ascii=False), encoding='utf-8')
        with self.assertRaises(CorpusError):
            load_snapshot(self.path)


if __name__ == '__main__':
    unittest.main()
