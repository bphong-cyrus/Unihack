from datetime import date
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from demo_api import Ask, SNAPSHOT, ask
from release_policy import POLICY_HASH, POLICY_VERSION, evaluate_release_policy


class ReleasePolicyTests(unittest.TestCase):
    def call(self, question, **kwargs):
        return ask(Ask(question_id="policy-test", question=question, as_of=date(2026, 11, 17), **kwargs))

    def test_positive_whitelist_queries_authorize_settlement(self):
        cases = [
            (
                "Hàng đến cửa khẩu ngày 01/11/2026, hôm nay 17/11/2026, theo mốc 30 ngày còn bao nhiêu ngày để nộp tờ khai?",
                "WL-1-CUSTOMS-DEADLINE-30D",
            ),
            (
                "Khoản 2 Điều 25 Luật 54/2014/QH13 quy định tờ khai hải quan có giá trị làm thủ tục bao nhiêu ngày (15 ngày)?",
                "WL-2-DECLARATION-VALIDITY-15D",
            ),
            (
                "Theo Điều 38 Nghị định 169/2026/NĐ-CP, Nghị định 128/2020/NĐ-CP hết hiệu lực từ ngày nào?",
                "WL-3-PENALTY-REPEAL-169-2026",
            ),
            (
                "Khoản 1 Điều 6 Quyết định 18/2019/QĐ-TTg quy định tuổi thiết bị tối đa bao nhiêu năm (10 năm)?",
                "WL-4-MACHINERY-AGE-RULE-10Y",
            ),
            (
                "Điểm b Khoản 3 Điều 8 Quyết định 18/2019/QĐ-TTg quy định thời hạn nộp chứng thư giám định là bao nhiêu ngày?",
                "WL-5-MACHINERY-INSPECTION-30D",
            ),
        ]
        for question, expected_rule in cases:
            with self.subTest(expected_rule=expected_rule):
                res = self.call(question)
                self.assertEqual(res["answer_status"], "ANSWERED")
                self.assertTrue(res["validation"]["passed"])
                self.assertTrue(res["validation"]["settlement_eligible"])
                self.assertEqual(res["validation"]["policy_version"], POLICY_VERSION)
                self.assertEqual(res["validation"]["policy_hash"], POLICY_HASH)
                self.assertEqual(res["validation"]["whitelist_id"], expected_rule)

    def test_negative_cases_never_authorize_release(self):
        # 1. Factcheck number mutation 30 -> 60
        txt = SNAPSHOT.lookup("54/2014/QH13", "25", "1", "b", date(2026, 11, 17)).text.replace("30", "60")
        r1 = self.call(
            "Kiểm chứng nguồn",
            mode="factcheck",
            factcheck_payload={"document": "54/2014/QH13", "article": "25", "clause": "1", "point": "b", "excerpt": txt},
        )
        self.assertFalse(r1["validation"]["passed"])
        self.assertFalse(r1["validation"]["settlement_eligible"])

        # 2. Factcheck non-existent article 999
        r2 = self.call("Kiểm chứng Điều 999 khoản 9 Luật 54/2014/QH13", mode="factcheck")
        self.assertFalse(r2["validation"]["settlement_eligible"])

        # 3. Date outside review horizon (2026-11-18)
        r3 = ask(Ask(question_id="neg-3", question="Điều 38 Nghị định 169/2026/NĐ-CP hiệu lực?", as_of=date(2026, 11, 18)))
        self.assertFalse(r3["validation"]["settlement_eligible"])

        # 4. Wrong document ID in factcheck
        r4 = self.call("Kiểm chứng Điều 25 khoản 1 Luật 99/2099/QH13", mode="factcheck")
        self.assertFalse(r4["validation"]["settlement_eligible"])

        # 5. Under-specified used machinery (NEEDS_CLARIFICATION even with valid citations)
        r5 = self.call("Máy tiện cũ của tôi nhập từ Nhật năm 2012 để bán lại có được nhập không?", tier="deep")
        self.assertEqual(r5["answer_status"], "NEEDS_CLARIFICATION")
        self.assertTrue(r5["validation"]["passed"])
        self.assertFalse(r5["validation"]["settlement_eligible"])

        # 6. Generic customs deadline without provision reference or two-date calculation
        r6 = self.call("Thời hạn nộp tờ khai nhập khẩu?")
        self.assertTrue(r6["validation"]["passed"])
        self.assertFalse(r6["validation"]["settlement_eligible"])

        # 7. Generic 128/2020 repeal without citing 169/2026 Art 38
        r7 = self.call("128/2020/NĐ-CP còn hiệu lực tại ngày 17/11/2026 không?")
        self.assertTrue(r7["validation"]["passed"])
        self.assertFalse(r7["validation"]["settlement_eligible"])

        # 8. Historical date prior to 2026-07-01 penalty transition
        r8 = ask(Ask(question_id="neg-8", question="Điều 38 Nghị định 169/2026/NĐ-CP hiệu lực?", as_of=date(2026, 6, 30)))
        self.assertEqual(r8["answer_status"], "NEEDS_CLARIFICATION")
        self.assertFalse(r8["validation"]["settlement_eligible"])

        # 9. Out-of-scope rent deposit question
        r9 = self.call("Chủ trọ giữ tiền cọc phòng trọ có đúng luật không?")
        self.assertFalse(r9["validation"]["passed"])
        self.assertFalse(r9["validation"]["settlement_eligible"])

        # 10. Reversed dates (reference < arrival)
        r10 = self.call("Hàng đến ngày 17/11/2026, hôm nay 01/11/2026, theo mốc 30 ngày còn bao nhiêu ngày?")
        self.assertEqual(r10["answer_status"], "NEEDS_CLARIFICATION")
        self.assertFalse(r10["validation"]["settlement_eligible"])

    def test_exact_excerpt_on_non_whitelisted_or_wrong_snapshot_still_refunds(self):
        p = SNAPSHOT.lookup("54/2014/QH13", "24", "1", "", date(2026, 11, 17))
        citation = {
            "document": p.document_id,
            "article": p.article,
            "clause": p.clause,
            "point": p.point,
            "excerpt": p.text,
        }
        validation = {
            "passed": True,
            "citation_checks": [
                {
                    "document": p.document_id,
                    "article": p.article,
                    "clause": p.clause,
                    "point": p.point,
                    "is_in_force": True,
                    "excerpt_similarity": 1.0,
                    "status": "PASS",
                }
            ],
        }
        # Exact 100% quote match on an unwhitelisted general question MUST NOT authorize release
        res_unlisted = evaluate_release_policy(
            question="Hồ sơ hải quan gồm những chứng từ gì?",
            mode="quick",
            as_of=date(2026, 11, 17),
            answer_status="ANSWERED",
            citations=[citation],
            validation=validation,
            snapshot_id=SNAPSHOT.snapshot_id,
            snapshot_sha256=SNAPSHOT.snapshot_sha256,
        )
        self.assertFalse(res_unlisted["settlement_eligible"])
        self.assertEqual(res_unlisted["policy_reason"], "NOT_IN_DETERMINISTIC_WHITELIST")

        # Tampered snapshot sha256 MUST fail even on a valid whitelist question
        p25 = SNAPSHOT.lookup("54/2014/QH13", "25", "2", "", date(2026, 11, 17))
        res_bad_hash = evaluate_release_policy(
            question="Khoản 2 Điều 25 Luật 54/2014/QH13 quy định 15 ngày phải không?",
            mode="quick",
            as_of=date(2026, 11, 17),
            answer_status="ANSWERED",
            citations=[
                {"document": p25.document_id, "article": p25.article, "clause": p25.clause, "point": "", "excerpt": p25.text}
            ],
            validation=validation,
            snapshot_id=SNAPSHOT.snapshot_id,
            snapshot_sha256="0" * 64,
        )
        self.assertFalse(res_bad_hash["settlement_eligible"])
        self.assertEqual(res_bad_hash["policy_reason"], "SNAPSHOT_MISMATCH")


if __name__ == "__main__":
    unittest.main()
