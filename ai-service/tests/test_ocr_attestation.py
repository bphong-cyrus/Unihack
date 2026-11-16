import hashlib
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ocr_attestation import attest_user_review, is_attested, AttestationError
from source_registry import import_source_manifest


class OCRAttestationTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        research = self.root / 'research'
        source = research / 'legal-sources' / 'law.pdf'
        source.parent.mkdir(parents=True)
        source.write_bytes(b'law bytes')
        self.source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
        manifest = source.parent / 'manifest.json'
        manifest.write_text(json.dumps({'documents': [{'document_id': 'A/2020', 'identity_check': 'matched_metadata',
            'metadata_url': 'https://vanban.chinhphu.vn/?docid=1', 'retrieved_at_utc': '2025-01-01T00:00:00Z',
            'attachments': [{'url': 'https://datafiles.chinhphu.vn/law.pdf', 'file': 'law.pdf',
                'sha256': self.source_sha, 'bytes': 9, 'signature_verified': False}]}]}))
        self.db = self.root / 'corpus.sqlite3'
        import_source_manifest(manifest, self.db)
        self.ocr_root = research / 'extracted'
        page_dir = self.ocr_root / 'ocr-fixture'
        page_dir.mkdir(parents=True)
        self.page = page_dir / 'page-001.json'
        self.page.write_text(json.dumps({'document_id': 'A/2020', 'source_file': '../../legal-sources/law.pdf',
            'source_sha256': self.source_sha, 'page_count': 1, 'page': 1, 'engine': 'fixture',
            'review_status': 'UNREVIEWED', 'lines': []}))

    def test_user_attestation_is_bound_to_exact_page_bytes_and_source(self):
        original = self.page.read_bytes()
        report = attest_user_review(self.ocr_root, self.db, 'Người dùng xác nhận đã đọc và duyệt toàn bộ OCR.')
        self.assertEqual(report['pages'], 1)
        self.assertEqual(self.page.read_bytes(), original)
        self.assertTrue(is_attested(self.db, 'ocr-fixture/page-001.json', hashlib.sha256(original).hexdigest()))
        self.page.write_bytes(original + b' ')
        self.assertFalse(is_attested(self.db, 'ocr-fixture/page-001.json', hashlib.sha256(self.page.read_bytes()).hexdigest()))
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('select review_status from ocr_review_attestations').fetchone()[0], 'VERIFIED')
            self.assertEqual(db.execute('select legal_status from source_documents').fetchone()[0], 'UNKNOWN')

    def test_source_hash_mismatch_is_rejected_before_attesting(self):
        data = json.loads(self.page.read_text())
        data['source_sha256'] = '0' * 64
        self.page.write_text(json.dumps(data))
        with self.assertRaises(AttestationError):
            attest_user_review(self.ocr_root, self.db, 'reviewed')


if __name__ == '__main__':
    unittest.main()
