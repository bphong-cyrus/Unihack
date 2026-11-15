import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ocr_batch import BatchError
from ocr_tesseract_batch import parse_tesseract_tsv


class TesseractTsvTests(unittest.TestCase):
    def test_parse_tsv_groups_words_into_source_ordered_lines(self):
        tsv = (
            'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'
            '4\t1\t1\t1\t1\t0\t8\t18\t70\t14\t-1\t\n'
            '5\t1\t1\t1\t1\t1\t10\t20\t30\t12\t90.0\tNghị\n'
            '5\t1\t1\t1\t1\t2\t45\t20\t20\t12\t80.0\tđịnh\n'
            '5\t1\t1\t1\t2\t1\t12\t40\t10\t12\t-1\t\n'
            '5\t1\t1\t2\t1\t1\t10\t40\t15\t10\t70.0\tĐiều\n'
        )

        lines = parse_tesseract_tsv(tsv)

        self.assertEqual([line['text'] for line in lines], ['Nghị định', 'Điều'])
        self.assertEqual(lines[0]['bbox'], [[10.0, 20.0], [65.0, 20.0], [65.0, 32.0], [10.0, 32.0]])
        self.assertAlmostEqual(lines[0]['confidence'], 0.85)
        self.assertEqual(lines[1]['bbox'], [[10.0, 40.0], [25.0, 40.0], [25.0, 50.0], [10.0, 50.0]])
        self.assertAlmostEqual(lines[1]['confidence'], 0.7)

    def test_parse_tsv_rejects_missing_required_columns(self):
        with self.assertRaises(BatchError):
            parse_tesseract_tsv('level\ttext\n5\tĐiều\n')

    def test_parse_tsv_rejects_invalid_word_geometry(self):
        tsv = (
            'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'
            '5\t1\t1\t1\t1\t1\t10\t20\t-2\t12\t90.0\tNghị\n'
        )
        with self.assertRaises(BatchError):
            parse_tesseract_tsv(tsv)

    def test_parse_tsv_preserves_leading_quote_without_merging_next_row(self):
        tsv = (
            'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'
            '5\t1\t1\t1\t1\t1\t10\t20\t30\t12\t90.0\t"Cơ\n'
            '5\t1\t1\t1\t1\t2\t45\t20\t20\t12\t80.0\tquan\n'
        )

        lines = parse_tesseract_tsv(tsv)

        self.assertEqual([line['text'] for line in lines], ['"Cơ quan'])

    def test_parse_tsv_keeps_tabs_in_text_column(self):
        tsv = (
            'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'
            '5\t1\t1\t1\t1\t1\t10\t20\t30\t12\t90.0\tĐiều\t1\n'
        )

        lines = parse_tesseract_tsv(tsv)

        self.assertEqual([line['text'] for line in lines], ['Điều\t1'])


if __name__ == '__main__':
    unittest.main()
