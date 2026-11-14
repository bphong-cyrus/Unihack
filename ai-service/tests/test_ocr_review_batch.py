import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ocr_review_batch import render_batch
from ocr_review import ReviewError


class ReviewBatchTests(unittest.TestCase):
    def test_batch_creates_a_page_per_record_and_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source.pdf'
            source.write_bytes(b'pdf')
            records = root / 'records'
            records.mkdir()
            for page in (1, 2):
                (records / f'page-{page:03}.json').write_text(json.dumps({
                    'document_id': 'DOC', 'source_file': '../source.pdf',
                    'source_sha256': hashlib.sha256(b'pdf').hexdigest(), 'page': page,
                    'page_count': 2, 'review_status': 'UNREVIEWED', 'lines': []}))
            output = root / 'review'
            render_batch(records, output)
            self.assertIn('page-001.html', (output / 'index.html').read_text())
            self.assertIn('page-002.html', (output / 'index.html').read_text())
            self.assertIn('../source.pdf#page=2', (output / 'page-002.html').read_text())

    def test_batch_does_not_write_when_any_record_is_invalid(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'page-001.json').write_text('{}')
            output = root / 'out'
            with self.assertRaises(ReviewError):
                render_batch(root, output)
            self.assertFalse(output.exists())

    def test_batch_rejects_records_from_different_documents(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'source.pdf').write_bytes(b'pdf')
            for page, document in ((1, 'A'), (2, 'B')):
                (root / f'page-{page:03}.json').write_text(json.dumps({
                    'document_id': document, 'source_file': 'source.pdf',
                    'source_sha256': hashlib.sha256(b'pdf').hexdigest(), 'page': page,
                    'page_count': 2, 'review_status': 'UNREVIEWED', 'lines': []}))
            with self.assertRaises(ReviewError):
                render_batch(root, root / 'out')

    def test_index_explicitly_identifies_missing_pages(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'source.pdf').write_bytes(b'pdf')
            (root / 'page-001.json').write_text(json.dumps({
                'document_id': 'A', 'source_file': 'source.pdf',
                'source_sha256': hashlib.sha256(b'pdf').hexdigest(), 'page': 1,
                'page_count': 3, 'review_status': 'UNREVIEWED', 'lines': []}))
            render_batch(root, root / 'out')
            index = (root / 'out/index.html').read_text()
            self.assertIn('1/3', index)
            self.assertIn('2, 3', index)
