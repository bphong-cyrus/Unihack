import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from review_queue import make_review_queue


class ReviewQueueTests(unittest.TestCase):
    def test_numbered_clauses_preserve_source_paragraphs_and_preamble(self):
        source = {'document_id':'TEST', 'docx_sha256':'abc', 'archive_sha256':'def', 'articles':[
            {'article':'2','paragraphs':['Điều 2. Test','Mở đầu','1. Một','a) Điểm a','2. Hai']}]}
        q = make_review_queue(source)
        self.assertEqual([x['clause'] for x in q['candidates']], ['preamble','1','2'])
        self.assertEqual(q['candidates'][1]['paragraphs'], ['1. Một','a) Điểm a'])
        self.assertEqual(q['candidates'][1]['source_paragraph_indexes'], [2,3])
        self.assertTrue(all(x['review_status']=='UNREVIEWED' for x in q['candidates']))

    def test_unnumbered_article_has_single_candidate(self):
        q=make_review_queue({'document_id':'TEST','docx_sha256':'a','archive_sha256':'b','articles':[{'article':'1','paragraphs':['Điều 1. A','Nội dung']}]})
        self.assertEqual(q['candidates'][0]['clause'], '0')
        self.assertEqual(q['candidates'][0]['paragraphs'], ['Nội dung'])

    def test_repeated_number_is_flagged_without_merging(self):
        q=make_review_queue({'document_id':'TEST','docx_sha256':'a','archive_sha256':'b','articles':[{'article':'1','paragraphs':['Điều 1. A','1. Một','1. Trùng']}]})
        self.assertEqual(q['duplicate_labels'], ['1:1'])
        self.assertEqual(len(q['candidates']), 2)

if __name__ == '__main__': unittest.main()
