import sys
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from snapshot_search import retrieve


class SnapshotSearchTests(unittest.TestCase):
    def test_rare_query_term_ranks_relevant_provision_above_common_terms(self):
        def item(doc, text):
            return SimpleNamespace(document_id=doc, article='1', clause='1', point='', document_title='', text=text)
        items = [item('A', 'hải quan hải quan hải quan'), item('B', 'hải xylophone'), item('C', 'hải quan')]
        snapshot = SimpleNamespace(provisions=items, lookup=lambda doc, article, clause, point, day: next(x for x in items if x.document_id == doc))
        result = retrieve(snapshot, 'hải quan xylophone', date(2024, 1, 1), 3)
        self.assertEqual(result[0].document_id, 'B')

    def test_unreviewed_results_and_single_term_query_are_excluded(self):
        item=SimpleNamespace(document_id='A', article='1', clause='1', point='', document_title='', text='hải quan tờ khai')
        snapshot=SimpleNamespace(provisions=[item], lookup=lambda *args: None)
        self.assertEqual(retrieve(snapshot, 'hải quan', date(2024, 1, 1), 3), [])
        self.assertEqual(retrieve(snapshot, 'hải', date(2024, 1, 1), 3), [])

if __name__ == '__main__': unittest.main()
