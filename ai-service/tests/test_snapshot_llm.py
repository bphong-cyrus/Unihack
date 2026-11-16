import os
import sys
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from snapshot_api import ask_snapshot

class SnapshotLLMTests(unittest.TestCase):
    def setUp(self):
        self.item = SimpleNamespace(document_id='A', document_title='A', article='1', clause='1', point='',
                                    text='Hồ sơ hải quan phải nộp tờ khai và các chứng từ liên quan theo quy định')
        self.snapshot = SimpleNamespace(snapshot_id='test', snapshot_sha256='a'*64, provisions=[self.item])
        self.req = SimpleNamespace(question='hồ sơ hải quan', tier='quick', as_of=date(2024, 1, 1),
                                   question_id='q', simulate_hallucination=False, simulate_expired_law=False)

    @patch('snapshot_api.validate_snapshot_citations', return_value={'passed': True})
    @patch('snapshot_api.retrieve')
    def test_llm_output_is_validated_against_retrieved_provision(self, retrieve, validate):
        retrieve.return_value = [self.item]
        generated = {'answer': 'Cần nộp tờ khai.', 'citations': [{'doc_id':'A','article':'1','clause':'1','excerpt':self.item.text}]}
        with patch.dict(os.environ, {'ASKPAY_LEGALQA_MODE':'llm'}), patch('snapshot_api.generate_answer', return_value=(generated, None)):
            result = ask_snapshot(self.req, self.snapshot)
        self.assertEqual(result['answer_method'], 'LLM_STRICT_JSON')
        self.assertEqual(result['citations'][0]['excerpt'], self.item.text)
        validate.assert_called_once()

    @patch('snapshot_api.validate_snapshot_citations', return_value={'passed': False})
    @patch('snapshot_api.retrieve')
    def test_llm_unretrieved_citation_is_rejected(self, retrieve, validate):
        retrieve.return_value = [self.item]
        generated = {'answer':'x', 'citations':[{'doc_id':'B','article':'1','clause':'1','excerpt':self.item.text}]}
        with patch.dict(os.environ, {'ASKPAY_LEGALQA_MODE':'llm'}), patch('snapshot_api.generate_answer', return_value=(generated,None)):
            with self.assertRaises(HTTPException):
                ask_snapshot(self.req, self.snapshot)
