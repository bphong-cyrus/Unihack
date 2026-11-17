import sys,unittest,json,hashlib
from pathlib import Path
from datetime import date
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from demo_api import Ask,ask,SNAPSHOT,MANIFEST
from legal_corpus import load_snapshot,CorpusError
class DemoPackTests(unittest.TestCase):
 def call(self,q,**kw): return ask(Ask(question_id='demo-test',question=q,as_of=date(2026,11,17),**kw))
 def test_official_files_match_hashes(self):
  m=json.loads(MANIFEST.read_text());self.assertEqual(len(m['documents']),6);self.assertEqual(SNAPSHOT.provision_count,34)
  for d in m['documents']:
   self.assertEqual(hashlib.sha256((MANIFEST.parent/d['source_file']).read_bytes()).hexdigest(),d['source_sha256'])
 def test_no_certificate_furniture_in_legal_text(self):
  for p in SNAPSHOT.provisions:
   self.assertNotIn('Email:',p.text);self.assertNotIn('CÔNG BÁO/',p.text)
 def test_deadline_arithmetic(self):
  r=self.call('Hàng đến ngày 01/11/2026, hôm nay 17/11/2026, theo mốc 30 ngày còn bao nhiêu ngày?')
  self.assertIn('16 ngày',r['answer']);self.assertIn('14 ngày',r['answer']);self.assertTrue(r['validation']['passed'])
 def test_future_review_not_inferred(self):
  r=ask(Ask(question_id='d',question='thời hạn tờ khai nhập khẩu',as_of=date(2026,11,18)))
  self.assertFalse(r['validation']['passed']);self.assertEqual(r['citations'],[])
 def test_machinery_no_hs_or_origin_inference(self):
  r=self.call('Nhập máy tiện cũ từ Nhật năm 2012 để bán lại, chưa có mã HS hay giám định?',tier='deep')
  self.assertEqual(r['answer_status'],'NEEDS_CLARIFICATION');self.assertIn('không tự chứng minh',r['answer']);self.assertNotIn('hoàn thuế',r['answer'])
  self.assertTrue(all(c['document']!='107/2016/QH13' for c in r['citations']));self.assertTrue(r['validation']['passed'])
 def test_current_repeal_128(self):
  r=self.call('128/2020/NĐ-CP còn hiệu lực không?')
  self.assertIn('01/07/2026',r['answer']);self.assertTrue(r['validation']['passed'])
  self.assertTrue(all(c['document']=='169/2026/NĐ-CP' for c in r['citations']))
 def test_version_boundary(self):
  self.assertIsNotNone(SNAPSHOT.lookup('128/2020/NĐ-CP','35','1','',date(2026,6,30)))
  self.assertIsNone(SNAPSHOT.lookup('128/2020/NĐ-CP','35','1','',date(2026,7,1)))
  self.assertIsNone(SNAPSHOT.lookup('169/2026/NĐ-CP','38','1','',date(2026,6,30)))
  self.assertIsNotNone(SNAPSHOT.lookup('169/2026/NĐ-CP','38','1','',date(2026,7,1)))
 def test_factcheck_wrong_number_preserved(self):
  s=SNAPSHOT.lookup('54/2014/QH13','25','1','b',date(2026,11,17)).text.replace('30','60')
  r=self.call('Kiểm chứng nguồn',mode='factcheck',factcheck_payload=dict(document='54/2014/QH13',article='25',clause='1',point='b',excerpt=s))
  self.assertFalse(r['validation']['passed']);self.assertIn('60',r['answer']);self.assertIn('30',r['answer']);self.assertEqual(r['citations'][0]['excerpt'],s)
 def test_factcheck_999_preserved(self):
  r=self.call('Kiểm chứng Điều 999 khoản 9 Luật 54/2014/QH13',mode='factcheck')
  self.assertFalse(r['validation']['passed']);self.assertEqual(r['citations'][0]['article'],'999');self.assertIn('corpus',r['answer'])
 def test_factcheck_valid_quote(self):
  p=SNAPSHOT.lookup('54/2014/QH13','25','1','b',date(2026,11,17))
  r=self.call('Kiểm chứng',mode='factcheck',factcheck_payload=dict(document=p.document_id,article=p.article,clause=p.clause,point=p.point,excerpt=p.text))
  self.assertTrue(r['validation']['passed']);self.assertFalse(r['validation']['settlement_eligible'])
 def test_no_quote_is_not_match(self):
  r=self.call('Kiểm chứng Điều 25 khoản 1 Luật 54/2014/QH13',mode='factcheck')
  self.assertFalse(r['validation']['passed']);self.assertIn('Chưa kiểm tra nguyên văn',r['answer'])
 def test_out_of_scope_abstains(self):
  r=self.call('Chủ trọ giữ tiền cọc có hợp pháp không?');self.assertFalse(r['validation']['passed']);self.assertEqual(r['citations'],[])
 def test_no_rule_based_answer_authorizes_release(self):
  for q in ['Thời hạn nộp tờ khai nhập khẩu?','Nhập máy tiện cũ','128/2020 còn hiệu lực?']:
   r=self.call(q);self.assertFalse(r['validation']['settlement_eligible']);self.assertEqual(r['answer_method'],'RULE_BASED_DEMO')
if __name__=='__main__': unittest.main()
