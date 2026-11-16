import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from legal_qa import (
    LegalQAConfigurationError,
    LegalQAResponseError,
    build_request_payload,
    parse_structured_answer,
)


class LegalQATests(unittest.TestCase):
    def setUp(self):
        self.text = ('Người khai hải quan phải khai đầy đủ thông tin trên tờ khai và nộp chứng từ '
                     'theo quy định của cơ quan hải quan qua hệ thống điện tử.')
        self.evidence = [{
            'doc_id': '54/2014/QH13', 'article': '25', 'clause': '1',
            'raw_text': self.text, 'status': 'ACTIVE',
        }]

    def test_request_uses_strict_json_schema_and_verbatim_excerpt_instruction(self):
        payload = build_request_payload('Hồ sơ hải quan gồm những gì?', self.evidence, 'quick', 'model-test')
        schema = payload['response_format']['json_schema']
        self.assertTrue(schema['strict'])
        self.assertFalse(schema['schema']['additionalProperties'])
        prompt = payload['messages'][1]['content']
        self.assertIn('chép nguyên văn', prompt.lower())
        self.assertIn('10 từ', prompt)
        self.assertIn(self.text, prompt)

    def test_structured_answer_accepts_only_exact_quote_from_retrieved_evidence(self):
        answer = {
            'answer': 'Người khai hải quan phải kê khai đầy đủ thông tin và nộp chứng từ theo quy định.',
            'citations': [{
                'doc_id': '54/2014/QH13', 'article': '25', 'clause': '1', 'excerpt': self.text,
            }],
        }
        result = parse_structured_answer(json.dumps(answer, ensure_ascii=False), self.evidence)
        self.assertEqual(result['citations'][0]['excerpt'], self.text)

    def test_structured_answer_rejects_paraphrased_or_unknown_citations(self):
        cases = [
            {'doc_id': '54/2014/QH13', 'article': '25', 'clause': '1', 'excerpt': 'Khai đủ hồ sơ theo luật hải quan.'},
            {'doc_id': '99/9999/QH99', 'article': '25', 'clause': '1', 'excerpt': self.text},
        ]
        for citation in cases:
            with self.subTest(citation=citation), self.assertRaises(LegalQAResponseError):
                parse_structured_answer(json.dumps({'answer': 'Căn cứ quy định.', 'citations': [citation]}, ensure_ascii=False), self.evidence)

    def test_structured_answer_rejects_empty_or_malformed_json(self):
        for body in ('{}', 'not-json'):
            with self.subTest(body=body), self.assertRaises(LegalQAResponseError):
                parse_structured_answer(body, self.evidence)

    def test_abstention_preserves_empty_citations_for_refund_validation(self):
        result = parse_structured_answer('{"answer":"Không có căn cứ","citations":[]}', self.evidence)
        self.assertEqual(result['citations'], [])

    def test_tier_configuration_requires_a_model_and_api_key(self):
        from legal_qa import resolve_tier_config
        with self.assertRaises(LegalQAConfigurationError):
            resolve_tier_config('quick', {})
        quick = resolve_tier_config('quick', {'OPENAI_API_KEY': 'test-key', 'ASKPAY_QUICK_MODEL': 'quick-model'})
        deep = resolve_tier_config('deep', {'OPENAI_API_KEY': 'test-key', 'ASKPAY_DEEP_MODEL': 'deep-model'})
        self.assertEqual((quick.fee_usdc, quick.top_k, quick.model), ('0.05', 3, 'quick-model'))
        self.assertEqual((deep.fee_usdc, deep.top_k, deep.model), ('0.20', 8, 'deep-model'))
        alias = resolve_tier_config('quick', {'LLM_API_KEY': 'test-key', 'LLM_QUICK_MODEL': 'new-model'})
        self.assertEqual(alias.model, 'new-model')


if __name__ == '__main__':
    unittest.main()
