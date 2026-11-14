import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ocr_headings import find_headings


class HeadingTests(unittest.TestCase):
    def test_heading_candidates_retain_page_and_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'source.pdf').write_bytes(b'pdf')
            record = {'document_id': 'A', 'source_file': 'source.pdf', 'source_sha256': hashlib.sha256(b'pdf').hexdigest(),
                      'page': 1, 'page_count': 1, 'review_status': 'UNREVIEWED', 'lines': [
                          {'text': 'Điều 12. Quy định', 'confidence': 0.8},
                          {'text': 'Nội dung nhắc Điều 13.', 'confidence': 0.9}]}
            (root / 'page-001.json').write_text(json.dumps(record))
            result = find_headings(root)
            self.assertEqual(len(result['candidates']), 1)
            self.assertEqual(result['candidates'][0]['article'], '12')
            self.assertEqual(result['candidates'][0]['page'], 1)
            self.assertEqual(result['candidates'][0]['line_index'], 0)
            self.assertEqual(result['review_status'], 'UNREVIEWED')

    def test_rejects_incomplete_or_modified_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'source.pdf').write_bytes(b'changed')
            record = {'document_id': 'A', 'source_file': 'source.pdf', 'source_sha256': hashlib.sha256(b'original').hexdigest(),
                      'page': 1, 'page_count': 2, 'review_status': 'UNREVIEWED', 'lines': []}
            (root / 'page-001.json').write_text(json.dumps(record))
            with self.assertRaises(ValueError):
                find_headings(root)

    def test_recognizes_accent_ocr_errors_without_changing_original_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'source.pdf').write_bytes(b'pdf')
            record = {'document_id': 'A', 'source_file': 'source.pdf', 'source_sha256': hashlib.sha256(b'pdf').hexdigest(),
                      'page': 1, 'page_count': 1, 'review_status': 'UNREVIEWED',
                      'lines': [{'text': 'Đíều 1. Phạm vi', 'confidence': 0.5}]}
            (root / 'page-001.json').write_text(json.dumps(record))
            candidates = find_headings(root)['candidates']
            self.assertEqual(candidates[0]['article'], '1')
            self.assertEqual(candidates[0]['text'], 'Đíều 1. Phạm vi')

    def test_recognizes_heading_with_missing_or_misread_punctuation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'source.pdf').write_bytes(b'pdf')
            record = {'document_id': 'A', 'source_file': 'source.pdf', 'source_sha256': hashlib.sha256(b'pdf').hexdigest(),
                      'page': 1, 'page_count': 1, 'review_status': 'UNREVIEWED',
                      'lines': [{'text': 'Điều 7_', 'confidence': 0.5}, {'text': 'Điều 8', 'confidence': 0.5}]}
            (root / 'page-001.json').write_text(json.dumps(record))
            self.assertEqual([x['article'] for x in find_headings(root)['candidates']], ['7', '8'])
