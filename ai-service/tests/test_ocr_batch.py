import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ocr_batch import BatchError, run_batch


class OcrBatchTests(unittest.TestCase):
    def test_checkpoint_resume_preserves_pages_and_processes_only_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source.pdf'
            source.write_bytes(b'official source')
            calls = []
            def recognize(path, page, dpi):
                calls.append(page)
                return [{'bbox': [[0, 0], [1, 0], [1, 1], [0, 1]], 'text': f'trang {page}', 'confidence': 0.9}]
            out = root / 'ocr'
            run_batch(source, out, '123/2020/NĐ-CP', 2, recognize)
            first = (out / 'page-001.json').read_bytes()
            (out / 'page-002.json').unlink()
            calls.clear()
            run_batch(source, out, '123/2020/NĐ-CP', 2, recognize)
            self.assertEqual(calls, [2])
            self.assertEqual((out / 'page-001.json').read_bytes(), first)
            record = json.loads((out / 'page-002.json').read_text())
            self.assertEqual(record['review_status'], 'UNREVIEWED')
            self.assertEqual((out / record['source_file']).resolve(), source)

    def test_changed_source_or_document_fails_before_processing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source.pdf'
            source.write_bytes(b'original')
            out = root / 'ocr'
            recognize = lambda path, page, dpi: []
            run_batch(source, out, 'A', 1, recognize)
            with self.assertRaises(BatchError):
                run_batch(source, out, 'B', 1, recognize)
            source.write_bytes(b'changed')
            with self.assertRaises(BatchError):
                run_batch(source, out, 'A', 1, recognize)

    def test_bad_checkpoint_fails_before_any_missing_page_is_processed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source.pdf'
            source.write_bytes(b'original')
            out = root / 'ocr'
            run_batch(source, out, 'A', 2, lambda *args: [])
            (out / 'page-001.json').unlink()
            (out / 'page-002.json').write_text('{}')
            calls = []
            with self.assertRaises(BatchError):
                run_batch(source, out, 'A', 2, lambda *args: calls.append(args))
            self.assertEqual(calls, [])

    def test_unexpected_page_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source.pdf'
            source.write_bytes(b'original')
            out = root / 'ocr'
            run_batch(source, out, 'A', 1, lambda *args: [])
            (out / 'page-002.json').write_text('{}')
            with self.assertRaises(BatchError):
                run_batch(source, out, 'A', 1, lambda *args: [])


if __name__ == '__main__':
    unittest.main()
