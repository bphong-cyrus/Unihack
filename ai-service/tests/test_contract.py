import sys
import unittest
from fastapi import HTTPException
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

    def test_validate_endpoint_exists(self):
        routes = {(route.path, method) for route in main.app.routes for method in getattr(route, "methods", set())}
        self.assertIn(("/api/v1/legal/validate", "POST"), routes)

    def test_corpus_reports_sample_and_actual_document_count(self):
        result = main.get_corpus()
        self.assertEqual(result["total_documents"], len({r["doc_id"] for r in main.CORPUS_RECORDS}))
        self.assertEqual(result["corpus_status"], "DEMO_UNVERIFIED")


if __name__ == "__main__":
    unittest.main()
