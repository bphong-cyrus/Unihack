import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from extract_docx import extract_document, ExtractionError


class DocxExtractionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / 'source.docx'

    def write_document(self, xml):
        with ZipFile(self.source, 'w') as archive:
            archive.writestr('word/document.xml', xml)

    def test_extract_preserves_paragraphs_and_article_boundaries(self):
        self.write_document('''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
        <w:p><w:r><w:t>Văn bản mở đầu</w:t></w:r></w:p>
        <w:p><w:r><w:t>Điều 1. Phạm vi</w:t></w:r></w:p>
        <w:p><w:r><w:t>1. Nội dung </w:t><w:tab/><w:t>một.</w:t></w:r></w:p>
        <w:p><w:r><w:t>Điều 2. Đối tượng</w:t></w:r></w:p>
        <w:p><w:r><w:t>Áp dụng theo Điều 1. </w:t></w:r></w:p>
        </w:body></w:document>''')
        result = extract_document(self.source)
        self.assertEqual(result['docx_sha256'], hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertEqual([x['article'] for x in result['articles']], ['1', '2'])
        self.assertIn('\t', result['articles'][0]['paragraphs'][1])
        self.assertEqual(result['articles'][1]['paragraphs'][1], 'Áp dụng theo Điều 1. ')
        self.assertEqual(result['review_status'], 'UNREVIEWED')

    def test_missing_document_xml_is_rejected(self):
        with ZipFile(self.source, 'w') as archive:
            archive.writestr('other.xml', 'not a document')
        with self.assertRaises(ExtractionError):
            extract_document(self.source)

    def test_repeated_article_numbers_are_flagged_for_manual_review(self):
        self.write_document('''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
        <w:p><w:r><w:t>Điều 1. A</w:t></w:r></w:p>
        <w:p><w:r><w:t>Điều 1. B</w:t></w:r></w:p>
        </w:body></w:document>''')
        result = extract_document(self.source)
        self.assertEqual(result['duplicate_articles'], ['1'])


if __name__ == '__main__':
    unittest.main()
