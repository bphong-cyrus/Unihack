import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from status_evidence import import_observations, EvidenceError

class StatusEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name); self.db=root/'corpus.sqlite3'; self.path=root/'observations.json'
        with sqlite3.connect(self.db) as db:
            db.execute('create table source_documents(document_id text primary key,legal_status text not null)')
            db.executemany('insert into source_documents values (?,?)',[('A','UNKNOWN'),('B','UNKNOWN')])
        self.entries=[{'document_id':'A','status':'EXPIRED','effective_until':'2020-12-10',
                       'source_url':'https://vbpl.moj.gov.vn/tw/Pages/example?ItemID=1','source_access':'indexed_search_cache'},
                      {'document_id':'B','status':'PARTIALLY_EXPIRED','effective_until':None,
                       'source_url':'https://vbpl.vn/tw/Pages/example?ItemID=2','source_access':'indexed_search_cache'}]
    def write(self): self.path.write_text(json.dumps(self.entries))
    def test_full_expiry_is_recorded_without_marking_partly_expired_active(self):
        self.write(); import_observations(self.db,self.path); import_observations(self.db,self.path)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('select document_id,legal_status from source_documents order by document_id').fetchall(),[('A','EXPIRED'),('B','UNKNOWN')])
            self.assertEqual(db.execute('select count(*) from source_status_observations').fetchone()[0],2)
    def test_unknown_document_or_unofficial_url_rolls_back(self):
        self.entries[1]['source_url']='https://example.com/fake'; self.write()
        with self.assertRaises(EvidenceError): import_observations(self.db,self.path)
        with sqlite3.connect(self.db) as db: self.assertEqual(db.execute('select legal_status from source_documents where document_id="A"').fetchone()[0],'UNKNOWN')
