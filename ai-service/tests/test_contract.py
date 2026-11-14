import sys
import unittest
from fastapi import HTTPException
from pydantic import ValidationError
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class ValidatorContractTests(unittest.TestCase):
    def setUp(self):
        self.record = main.CORPUS_RECORDS[0]
        self.citation = {
            "document": self.record["doc_id"], "article": self.record["article"],
            "clause": self.record["clause"], "excerpt": self.record["raw_text"],
        }

    def test_validate_exact_sample_passes(self):
        result = main.validate_citations([self.citation])
        self.assertTrue(result["passed"])
        self.assertFalse(result["settlement_eligible"])
        self.assertEqual(result["corpus_status"], "DEMO_UNVERIFIED")
        self.assertEqual(result["citation_checks"][0]["raw_text"], self.record["raw_text"])

    def test_validate_empty_or_one_invalid_citation_refunds(self):
        self.assertFalse(main.validate_citations([])["passed"])
        bad = dict(self.citation, document="DOES-NOT-EXIST")
        result = main.validate_citations([self.citation, bad])
        self.assertFalse(result["passed"])
        self.assertEqual(result["verdict"], "UNVERIFIED_REFUND")
        self.assertEqual(result["citation_checks"][1]["fail_reason"], "DOCUMENT_NOT_IN_CORPUS")

    def test_validate_short_excerpt_fails_even_if_exact(self):
        excerpt = " ".join(self.record["raw_text"].split()[:9])
        self.assertEqual(main.compute_excerpt_similarity(excerpt, self.record["raw_text"]), 0)

    def test_similarity_just_below_threshold_is_not_rounded_up(self):
        excerpt = 'một hai ba bốn năm sáu bảy tám chín mười'
        source = 'một hai ba bốn năm sáu bảy tám chín khác'
        with patch('citation_text.fuzz.partial_ratio', return_value=89.999):
            self.assertLess(main.compute_excerpt_similarity(excerpt, source), 0.90)

    def test_excerpt_with_added_claim_does_not_pass_as_source_substring(self):
        record = self.record
        false_claim = record['raw_text'] + ' Doanh nghiệp được miễn toàn bộ thuế và hình phạt trong mọi trường hợp.' * 5
        result = main.validate_citations([dict(self.citation, excerpt=false_claim)])
        self.assertFalse(result['passed'])
        self.assertLess(result['citation_checks'][0]['excerpt_similarity'], 0.9)

    def test_validate_expired_citation_fails(self):
        rec = main.CORPUS_RECORDS[-1]
        result = main.validate_citations([dict(document=rec["doc_id"], article=rec["article"], clause=rec["clause"], excerpt=rec["raw_text"])])
        self.assertEqual(result["citation_checks"][0]["fail_reason"], "DOCUMENT_EXPIRED_OR_REPLACED")

    def test_demo_rejects_historical_date_instead_of_ignoring_it(self):
        for operation in (lambda: main.ask_legal_question(main.AskRequest(question='Hải quan', as_of='2020-01-01')),
                          lambda: main.validate_endpoint(main.ValidateRequest(citations=[], as_of='2020-01-01'))):
            with self.assertRaises(HTTPException) as error:
                operation()
            self.assertEqual(error.exception.status_code, 400)

    def test_ask_rejects_blank_question_and_unsupported_tier_or_domain(self):
        for values in ({'question': '   '}, {'question': 'hải quan', 'tier': 'other'},
                       {'question': 'hải quan', 'domain': 'other'}):
            with self.subTest(values=values), self.assertRaises(ValidationError):
                main.AskRequest(**values)

    def test_validate_endpoint_exists(self):
        routes = {(route.path, method) for route in main.app.routes for method in getattr(route, "methods", set())}
        self.assertIn(("/api/v1/legal/validate", "POST"), routes)

    def test_demo_unrelated_tax_question_has_no_citations(self):
        result = main.ask_legal_question(main.AskRequest(question='Thuế xuất khẩu cà phê áp dụng mức bao nhiêu?'))
        self.assertEqual(result['citations'], [])
        self.assertFalse(result['validation']['passed'])

    def test_demo_wrong_hs_penalty_question_keeps_example(self):
        result = main.ask_legal_question(main.AskRequest(question='Khai sai mã HS bị phạt bao nhiêu?'))
        self.assertTrue(result['citations'])

    def test_corpus_reports_sample_and_actual_document_count(self):
        result = main.get_corpus()
        self.assertEqual(result["total_documents"], len({r["doc_id"] for r in main.CORPUS_RECORDS}))
        self.assertEqual(result["corpus_status"], "DEMO_UNVERIFIED")


if __name__ == "__main__":
    unittest.main()
