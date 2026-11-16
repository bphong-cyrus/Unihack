import hashlib
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from source_registry import import_source_manifest, RegistryError


class SourceRegistryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'law.pdf'
        self.source.write_bytes(b'law source')
        self.manifest = self.root / 'manifest.json'
        self.db = self.root / 'corpus.sqlite3'
        self.data = {'documents': [
            {'document_id': 'A/2020', 'metadata_url': 'https://vanban.chinhphu.vn/?docid=1',
             'identity_check': 'matched_metadata', 'retrieved_at_utc': '2025-01-01T00:00:00Z',
             'attachments': [{'file': 'law.pdf', 'url': 'https://datafiles.chinhphu.vn/law.pdf',
                              'sha256': hashlib.sha256(b'law source').hexdigest(), 'bytes': 10, 'signature_verified': False}]},
            {'document_id': 'B/2020', 'metadata_url': None, 'identity_check': 'unverified', 'attachments': [],
             'retrieved_at_utc': '2025-01-01T00:00:00Z'}]}
        self.write_manifest()

    def write_manifest(self):
        self.manifest.write_text(json.dumps(self.data), encoding='utf-8')

    def test_import_persists_source_provenance_and_does_not_mark_reviewed(self):
        report = import_source_manifest(self.manifest, self.db)
        self.assertEqual((report['documents'], report['attachments'], report['missing_documents']), (2, 1, 1))
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('select count(*) from source_documents').fetchone()[0], 2)
            self.assertEqual(db.execute('select review_status from source_documents where document_id=?', ('A/2020',)).fetchone()[0], 'UNREVIEWED')
            self.assertEqual(db.execute('select sha256 from source_artifacts').fetchone()[0], hashlib.sha256(b'law source').hexdigest())
            self.assertEqual(db.execute('select count(*) from provisions').fetchone()[0], 0)

    def test_failed_reimport_keeps_previous_registry(self):
        import_source_manifest(self.manifest, self.db)
        self.source.write_bytes(b'corrupted')
        with self.assertRaises(RegistryError):
            import_source_manifest(self.manifest, self.db)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('select count(*) from source_documents').fetchone()[0], 2)

    def test_reimport_is_idempotent(self):
        import_source_manifest(self.manifest, self.db)
        import_source_manifest(self.manifest, self.db)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('select count(*) from source_artifacts').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
