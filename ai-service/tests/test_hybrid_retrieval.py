import sys
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hybrid_retrieval import tokenize, reciprocal_rank_fusion
from snapshot_search import retrieve


def provision(identifier, text):
    return SimpleNamespace(document_id=identifier, article='1', clause='1', point='', document_title='', text=text)


class HybridRetrievalTests(unittest.TestCase):
    def test_tokenizer_keeps_negation_and_legal_bigrams(self):
        terms = tokenize('Không được hoàn thuế nhập khẩu')
        self.assertIn('không', terms)
        self.assertIn('hoàn__thuế', terms)
        self.assertIn('nhập__khẩu', terms)

    def test_rank_fusion_keeps_distinct_provisions_from_one_document(self):
        ranked = reciprocal_rank_fusion([[0, 1], [1, 0]], [1.0, 0.8], 5)
        self.assertEqual(len(ranked), 2)
        self.assertEqual(set(ranked), {0, 1})

    def test_only_reviewed_date_eligible_chunks_reach_neural_components(self):
        reviewed = provision('A', 'Hồ sơ hải quan phải có tờ khai hàng hóa nhập khẩu')
        unreviewed = provision('B', 'Hồ sơ hải quan tờ khai hàng hóa nhập khẩu chưa duyệt')
        snapshot = SimpleNamespace(provisions=[reviewed, unreviewed],
            lookup=lambda doc, article, clause, point, day: reviewed if doc == 'A' else None)
        seen = []
        class Ranker:
            def rank(self, question, items):
                seen.append([item.document_id for item in items])
                return list(range(len(items)))
        result = retrieve(snapshot, 'hồ sơ hải quan tờ khai nhập khẩu', date(2024, 1, 1), 3,
                          dense_ranker=Ranker(), reranker=Ranker())
        self.assertEqual([item.document_id for item in result], ['A'])
        self.assertEqual(seen, [['A'], ['A']])

    def test_explicit_article_does_not_fall_back_to_another_article(self):
        item = provision('A', 'Thời hạn nộp hồ sơ hải quan tờ khai là 30 ngày')
        snapshot = SimpleNamespace(provisions=[item], lookup=lambda *args: item)
        self.assertEqual(retrieve(snapshot, 'Điều 999 khoản 9 hồ sơ hải quan', date(2024, 1, 1), 3), [])


if __name__ == '__main__':
    unittest.main()
