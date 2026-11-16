import sys
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class AnswerRelevanceTests(unittest.TestCase):
    @patch.dict('os.environ', {'ASKPAY_DEMO_MODE': 'true'})
    def test_used_machine_import_does_not_return_reexport_refund(self):
        request = main.AskRequest(question='Nhập máy tiện cũ từ Nhật cần điều kiện gì khi chưa có mã HS và chứng thư?', tier='quick')
        result = main.ask_legal_question(request)
        self.assertEqual(result['citations'], [])
        self.assertFalse(result['validation']['passed'])
        self.assertNotIn('hoàn thuế khi tái xuất', result['answer'].lower())


if __name__ == '__main__':
    unittest.main()
