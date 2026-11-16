import hashlib
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ocr_candidates import ingest_candidates, CandidateError

class OCRCandidateTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name); self.ocr=root/'extracted'; folder=self.ocr/'ocr-sample'; folder.mkdir(parents=True)
        self.db=root/'corpus.sqlite3'; self.files=[]
        source=root/'source.pdf'; source.write_bytes(b'law'); self.source_sha=hashlib.sha256(source.read_bytes()).hexdigest()
        with sqlite3.connect(self.db) as db:
            db.execute('create table ocr_review_attestations(relative_path text, page_sha256 text, document_id text, source_sha256 text, review_status text)')
            for page, texts in [(1,['Điều 1. Phạm vi','1. Đoạn đầu']), (2,['Nối tiếp nội dung','Điều 2. Quy định','Nội dung'])]:
                path=folder/f'page-{page:03}.json'; data={'document_id':'A/2020','source_sha256':self.source_sha,'source_file':'../../source.pdf','page':page,'page_count':2,'lines':[{'text':t} for t in texts]}
                path.write_text(json.dumps(data,ensure_ascii=False)); self.files.append(path)
                db.execute('insert into ocr_review_attestations values(?,?,?,?,?)',(str(path.relative_to(self.ocr)),hashlib.sha256(path.read_bytes()).hexdigest(),'A/2020',self.source_sha,'VERIFIED'))
    def test_attested_pages_generate_article_candidates_with_line_provenance(self):
        report=ingest_candidates(self.ocr,self.db)
        self.assertEqual((report['pages'],report['candidates']), (2,2))
        with sqlite3.connect(self.db) as db:
            rows=db.execute('select article,text,source_lines,structure_status,legal_status from ocr_article_candidates order by ordinal').fetchall()
        self.assertEqual([row[0] for row in rows],['1','2'])
        self.assertIn('Nối tiếp nội dung',rows[0][1]); self.assertEqual(len(json.loads(rows[0][2])),3)
        self.assertEqual(rows[0][3:],('UNREVIEWED','UNKNOWN'))
        self.assertEqual(ingest_candidates(self.ocr,self.db)['candidates'],2)
    def test_changed_page_is_rejected_and_cannot_replace_candidates(self):
        ingest_candidates(self.ocr,self.db)
        self.files[0].write_bytes(self.files[0].read_bytes()+b' ')
        with self.assertRaises(CandidateError): ingest_candidates(self.ocr,self.db)
        with sqlite3.connect(self.db) as db: self.assertEqual(db.execute('select count(*) from ocr_article_candidates').fetchone()[0],2)

    def test_reimport_preserves_existing_review_decisions(self):
        ingest_candidates(self.ocr,self.db)
        with sqlite3.connect(self.db) as db:
            db.execute("update ocr_article_candidates set structure_status='VERIFIED' where ordinal=1")
        with self.assertRaises(CandidateError): ingest_candidates(self.ocr,self.db)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('select structure_status from ocr_article_candidates where ordinal=1').fetchone()[0], 'VERIFIED')
