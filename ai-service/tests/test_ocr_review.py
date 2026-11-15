import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ocr_review import render_review, ReviewError


class OcrReviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.pdf = self.root / 'source.pdf'
        self.pdf.write_bytes(b'fixture source')
        self.record = {'document_id':'TEST', 'source_file':'source.pdf',
                       'source_sha256':hashlib.sha256(self.pdf.read_bytes()).hexdigest(),
                       'page':2, 'page_count':3, 'review_status':'UNREVIEWED',
                       'lines':[{'text':'<script>alert(1)</script>', 'confidence':0.42, 'bbox':[[0,0],[1,0],[1,1],[0,1]]}]}
        self.path = self.root / 'page.json'
        self.path.write_text(json.dumps(self.record))

    def test_render_escapes_text_and_links_to_correct_page(self):
        html = render_review(self.path, self.root / 'review.html')
        self.assertIn('source.pdf#page=2', html)
        self.assertIn('&lt;script&gt;', html)
        self.assertNotIn('<script>alert(1)</script>', html)
        self.assertIn('42.0%', html)
        self.assertIn('CHƯA DUYỆT', html)

    def test_render_rejects_modified_source(self):
        self.pdf.write_bytes(b'changed')
        with self.assertRaises(ReviewError):
            render_review(self.path, self.root / 'review.html')

    def test_render_rejects_invalid_page(self):
        self.record['page'] = 4
        self.path.write_text(json.dumps(self.record))
        with self.assertRaises(ReviewError):
            render_review(self.path, self.root / 'review.html')

if __name__ == '__main__': unittest.main()
