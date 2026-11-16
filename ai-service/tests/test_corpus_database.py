import hashlib
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from corpus_database import import_reviewed_snapshot, load_database_snapshot, DatabaseError
from source_registry import import_source_manifest
from snapshot_search import retrieve
from snapshot_api import configured_snapshot
from fastapi import HTTPException


class CorpusDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        source = b'official fixture source'
        (self.root / 'law.pdf').write_bytes(source)
        self.sha = hashlib.sha256(source).hexdigest()
        self.db = self.root / 'sources.sqlite3'
        source_manifest = {'documents': [{'document_id': 'TEST/2020', 'metadata_url': 'https://vanban.chinhphu.vn/?docid=1',
            'identity_check': 'matched_metadata', 'retrieved_at_utc': '2025-01-01T00:00:00+00:00',
            'attachments': [{'file': 'law.pdf', 'url': 'https://datafiles.chinhphu.vn/law.pdf',
                             'sha256': self.sha, 'bytes': len(source), 'signature_verified': False}]}]}
        manifest_path = self.root / 'sources.json'
        manifest_path.write_text(json.dumps(source_manifest), encoding='utf-8')
        import_source_manifest(manifest_path, self.db)
        self.snapshot_path = self.root / 'snapshot.json'
        self.record = {'article': '1', 'clause': '1', 'point': '', 'text': 'Hồ sơ hải quan có tờ khai và chứng từ hàng hóa theo quy định pháp luật',
            'effective_from': '2020-01-01', 'effective_until': None, 'review_status': 'VERIFIED', 'legal_status': 'ACTIVE',
            'reviewed_by': 'reviewer', 'reviewed_at': '2025-01-01T00:00:00+00:00', 'verified_through': '2025-01-01',
            'status_evidence_url': 'https://example.gov.vn/status'}
        self.manifest = {'snapshot_id': 'fixture-v1', 'documents': [{'document_id': 'TEST/2020', 'title': 'Luật mẫu',
            'source_url': 'https://example.gov.vn/law', 'source_file': 'law.pdf', 'source_sha256': self.sha,
            'retrieved_at': '2025-01-01T00:00:00+00:00', 'provisions': [self.record]}]}
        self.write_snapshot()

    def write_snapshot(self):
        self.snapshot_path.write_text(json.dumps(self.manifest, ensure_ascii=False), encoding='utf-8')

    def test_verified_provision_is_persisted_and_retrievable(self):
        report = import_reviewed_snapshot(self.db, self.snapshot_path)
        self.assertEqual(report['reviewed_provisions'], 1)
        snapshot = load_database_snapshot(self.db, 'fixture-v1')
        self.assertEqual(snapshot.lookup('TEST/2020', '1', '1', '', date(2024, 1, 1)).text, self.record['text'])
        self.assertEqual(len(retrieve(snapshot, 'hải quan tờ khai chứng từ', date(2024, 1, 1), 3)), 1)

    def test_unreviewed_provision_is_never_retrieved_even_with_review_metadata(self):
        self.record['review_status'] = 'UNREVIEWED'
        self.write_snapshot()
        import_reviewed_snapshot(self.db, self.snapshot_path)
        snapshot = load_database_snapshot(self.db, 'fixture-v1')
        self.assertEqual(retrieve(snapshot, 'hải quan tờ khai chứng từ', date(2024, 1, 1), 3), [])

    def test_expired_provision_is_not_retrievable(self):
        self.record['legal_status'] = 'EXPIRED'
        self.write_snapshot()
        import_reviewed_snapshot(self.db, self.snapshot_path)
        snapshot = load_database_snapshot(self.db, 'fixture-v1')
        self.assertEqual(retrieve(snapshot, 'hải quan tờ khai chứng từ', date(2024, 1, 1), 3), [])

    def test_tampered_source_blocks_database_loading(self):
        import_reviewed_snapshot(self.db, self.snapshot_path)
        (self.root / 'law.pdf').write_bytes(b'corrupt')
        with self.assertRaises(DatabaseError):
            load_database_snapshot(self.db, 'fixture-v1')

    def test_snapshot_id_cannot_be_reused_with_changed_content(self):
        import_reviewed_snapshot(self.db, self.snapshot_path)
        self.record['text'] += ' thay đổi'
        self.write_snapshot()
        with self.assertRaises(DatabaseError):
            import_reviewed_snapshot(self.db, self.snapshot_path)

    def test_configured_retrieval_uses_database_snapshot_and_fails_closed(self):
        import_reviewed_snapshot(self.db, self.snapshot_path)
        with patch.dict(os.environ, {'ASKPAY_CORPUS_DATABASE': str(self.db), 'ASKPAY_CORPUS_SNAPSHOT_ID': 'fixture-v1'}, clear=True):
            snapshot = configured_snapshot()
            self.assertEqual(snapshot.snapshot_id, 'fixture-v1')
            (self.root / 'law.pdf').write_bytes(b'corrupt')
            with self.assertRaises(HTTPException) as error:
                configured_snapshot()
            self.assertEqual(error.exception.status_code, 503)
