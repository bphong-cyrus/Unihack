import sys
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from retrieval_eval import evaluate, EvaluationError


class RetrievalEvaluationTests(unittest.TestCase):
    def test_metrics_count_misses_and_first_relevant_rank(self):
        item = SimpleNamespace(document_id='A', article='1', clause='1', point='', document_title='', text='hồ sơ hải quan tờ khai')
        snapshot = SimpleNamespace(snapshot_id='fixture', provisions=[item], lookup=lambda *args: item)
        cases = [
            {'id':'found', 'question':'hồ sơ hải quan', 'as_of':'2024-01-01', 'relevant':[{'document':'A','article':'1','clause':'1'}]},
            {'id':'miss', 'question':'không tìm được', 'as_of':'2024-01-01', 'relevant':[{'document':'A','article':'1','clause':'1'}]},
        ]
        result=evaluate(snapshot,cases,3)
        self.assertEqual(result['recall_at_k'],0.5)
        self.assertEqual(result['mrr_at_k'],0.5)
        self.assertEqual(result['cases'][1]['retrieved'],[])

    def test_duplicate_ids_and_missing_labels_are_rejected(self):
        snapshot=SimpleNamespace(snapshot_id='test', provisions=[])
        for cases in ([{'id':'a','question':'câu hỏi','as_of':'2024-01-01','relevant':[]}],
                      [{'id':'a','question':'câu hỏi','as_of':'2024-01-01','relevant':[{'document':'A','article':'1','clause':'1'}]}]*2):
            with self.assertRaises(EvaluationError): evaluate(snapshot,cases,3)

    def test_evaluates_explicit_no_result_cases_separately(self):
        item = SimpleNamespace(document_id='A', article='1', clause='1', point='', document_title='', text='hồ sơ hải quan tờ khai')
        snapshot = SimpleNamespace(snapshot_id='fixture', provisions=[item], lookup=lambda *args: item)
        cases = [
            {'id':'abstain', 'question':'thiên văn hành tinh', 'as_of':'2024-01-01', 'relevant':[], 'expect_no_result':True},
            {'id':'wrong', 'question':'hồ sơ hải quan', 'as_of':'2024-01-01', 'relevant':[], 'expect_no_result':True},
            {'id':'found', 'question':'hồ sơ hải quan', 'as_of':'2024-01-01', 'relevant':[{'document':'A','article':'1','clause':'1'}]},
        ]
        result = evaluate(snapshot, cases, 3)
        self.assertEqual(result['recall_at_k'], 1.0)
        self.assertEqual(result['no_result_count'], 2)
        self.assertEqual(result['no_result_accuracy'], 0.5)
        self.assertTrue(result['cases'][0]['correct_no_result'])
        self.assertFalse(result['cases'][1]['correct_no_result'])

if __name__ == '__main__': unittest.main()
