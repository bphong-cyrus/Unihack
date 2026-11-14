import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from source_audit import audit_sources


class SourceAuditTests(unittest.TestCase):
    def test_audit_reports_integrity_and_documents_without_attachments(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'file.pdf').write_bytes(b'original')
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'documents': [
                {'document_id': 'A', 'attachments': [{'file': 'file.pdf', 'bytes': 8, 'sha256': hashlib.sha256(b'original').hexdigest()}]},
                {'document_id': 'B', 'attachments': []}]}))
            report = audit_sources(manifest)
            self.assertEqual(report['files_ok'], 1)
            self.assertEqual(report['documents_without_attachments'], ['B'])
            self.assertEqual(report['errors'], [])
            (root / 'file.pdf').write_bytes(b'changed')
            self.assertEqual(audit_sources(manifest)['files_ok'], 0)
            self.assertTrue(audit_sources(manifest)['errors'])

    def test_audit_rejects_paths_outside_source_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / 'manifest.json'
            manifest.write_text(json.dumps({'documents': [{'document_id': 'A', 'attachments': [{'file': '../outside', 'bytes': 0, 'sha256': 'x'}]}]}))
            self.assertTrue(audit_sources(manifest)['errors'])

    def test_audit_rejects_empty_or_duplicate_document_inventory(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / 'manifest.json'
            for documents in ([], [{'document_id': 'A', 'attachments': []}, {'document_id': 'A', 'attachments': []}]):
                with self.subTest(documents=documents):
                    manifest.write_text(json.dumps({'documents': documents}))
                    with self.assertRaises(ValueError):
                        audit_sources(manifest)
