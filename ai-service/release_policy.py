"""Narrow deterministic escrow release policy (source-check-v1).

Only explicitly whitelisted, deterministic source-lookup / calendar-arithmetic queries
backed by the pinned verified snapshot and unambiguous PASS citations may authorize
settlement_eligible=True. Any under-specified clarification, out-of-scope query,
factcheck mode query, date outside review horizon, or unwhitelisted question stays
settlement_eligible=False.
"""
from datetime import date
import hashlib
import json
import re
import unicodedata

POLICY_VERSION = "source-check-v1"
EXPECTED_SNAPSHOT_ID = "askpay-demo-source-checked-2026-11-17"
EXPECTED_SNAPSHOT_SHA256 = "38f84d5d593a86142b23bb6d79187192a847be52f56f2befa9f0c0fabdd2bec3"
MAX_REVIEWED_AS_OF = date(2026, 11, 17)
MIN_REPEAL_AS_OF = date(2026, 7, 1)

WHITELIST_SPEC = {
    "policy_version": POLICY_VERSION,
    "snapshot_id": EXPECTED_SNAPSHOT_ID,
    "snapshot_sha256": EXPECTED_SNAPSHOT_SHA256,
    "max_reviewed_as_of": MAX_REVIEWED_AS_OF.isoformat(),
    "allowed_modes": ["quick", "deep"],
    "required_answer_status": "ANSWERED",
    "min_excerpt_similarity": 0.9,
    "whitelist_rules": [
        "WL-1-CUSTOMS-DEADLINE-30D",
        "WL-2-DECLARATION-VALIDITY-15D",
        "WL-3-PENALTY-REPEAL-169-2026",
        "WL-4-MACHINERY-AGE-RULE-10Y",
        "WL-5-MACHINERY-INSPECTION-30D",
    ],
}

POLICY_HASH = "0x" + hashlib.sha256(
    json.dumps(WHITELIST_SPEC, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
).hexdigest()


def _fold(text: str) -> str:
    return "".join(
        ch for ch in unicodedata.normalize("NFD", str(text or "").lower().replace("đ", "d"))
        if unicodedata.category(ch) != "Mn"
    )


def _citation_keys(citations: list[dict]) -> set[tuple[str, str, str, str]]:
    out = set()
    for item in citations or []:
        doc = "".join(str(item.get("document", "")).upper().split())
        art = str(item.get("article", "")).strip()
        cl = str(item.get("clause", "")).strip()
        pt = str(item.get("point", "")).strip()
        out.add((doc, art, cl, pt))
    return out


def _match_whitelist_rule(question: str, q_fold: str, as_of: date, cite_keys: set[tuple[str, str, str, str]]) -> str | None:
    dmy_dates = re.findall(r"\b\d{2}/\d{2}/\d{4}\b", question)

    # WL-1: Diem b Khoan 1 Dieu 25 Luat 54/2014/QH13 (30-day import declaration deadline)
    if ("54/2014/QH13", "25", "1", "b") in cite_keys:
        explicit_ref = ("54/2014" in q_fold or "dieu 25" in q_fold or "diem b" in q_fold) and (
            "30 ngay" in q_fold or "bao nhieu ngay" in q_fold
        )
        two_date_calc = len(dmy_dates) == 2 and "30 ngay" in q_fold
        if explicit_ref or two_date_calc:
            return "WL-1-CUSTOMS-DEADLINE-30D"

    # WL-2: Khoan 2 Dieu 25 Luat 54/2014/QH13 (15-day declaration validity)
    if ("54/2014/QH13", "25", "2", "") in cite_keys:
        if (
            ("khoan 2" in q_fold and "dieu 25" in q_fold)
            or ("54/2014" in q_fold and ("15 ngay" in q_fold or "gia tri lam thu tuc" in q_fold))
        ):
            return "WL-2-DECLARATION-VALIDITY-15D"

    # WL-3: Dieu 38 Nghi dinh 169/2026/ND-CP repealing 128/2020 from 01/07/2026
    if (
        as_of >= MIN_REPEAL_AS_OF
        and ("169/2026/NĐ-CP", "38", "1", "") in cite_keys
        and ("169/2026/NĐ-CP", "38", "2", "") in cite_keys
    ):
        if "169/2026" in q_fold and any(t in q_fold for t in ("dieu 38", "01/07/2026", "hieu luc", "het hieu luc")):
            return "WL-3-PENALTY-REPEAL-169-2026"

    # WL-4: Khoan 1 Dieu 6 Quyet dinh 18/2019/QD-TTg (general 10-year equipment age limit)
    if ("18/2019/QĐ-TTG", "6", "1", "") in cite_keys:
        unverified_lot = any(w in q_fold for w in ("ban lai", "may cua toi", "co duoc nhap", "nhap tu nhat", "nam 20"))
        if not unverified_lot and "18/2019" in q_fold and ("khoan 1 dieu 6" in q_fold or "dieu 6" in q_fold) and (
            "tuoi thiet bi" in q_fold or "10 nam" in q_fold
        ):
            return "WL-4-MACHINERY-AGE-RULE-10Y"

    # WL-5: Diem b Khoan 3 Dieu 8 Quyet dinh 18/2019/QD-TTg (30-day inspection certificate submission)
    if ("18/2019/QĐ-TTG", "8", "3", "b") in cite_keys:
        unverified_lot = any(w in q_fold for w in ("ban lai", "may cua toi", "nhap tu nhat"))
        if not unverified_lot and "18/2019" in q_fold and (
            "khoan 3 dieu 8" in q_fold or "diem b khoan 3 dieu 8" in q_fold
        ) and any(t in q_fold for t in ("chung thu giam dinh", "bao quan", "30 ngay")):
            return "WL-5-MACHINERY-INSPECTION-30D"

    return None


def evaluate_release_policy(
    *,
    question: str,
    mode: str,
    as_of: date,
    answer_status: str,
    citations: list[dict],
    validation: dict,
    snapshot_id: str,
    snapshot_sha256: str,
) -> dict:
    def reject(reason: str) -> dict:
        return {
            "settlement_eligible": False,
            "policy_version": POLICY_VERSION,
            "policy_hash": POLICY_HASH,
            "whitelist_id": None,
            "policy_reason": reason,
        }

    if snapshot_id != EXPECTED_SNAPSHOT_ID or str(snapshot_sha256 or "").lower() != EXPECTED_SNAPSHOT_SHA256:
        return reject("SNAPSHOT_MISMATCH")
    if as_of > MAX_REVIEWED_AS_OF:
        return reject("AS_OF_OUTSIDE_REVIEW_HORIZON")
    if mode not in ("quick", "deep"):
        return reject("MODE_NOT_ELIGIBLE_FOR_RELEASE")
    if answer_status != "ANSWERED":
        return reject(f"ANSWER_STATUS_{answer_status}_NOT_ELIGIBLE")
    if not validation.get("passed"):
        return reject("VALIDATION_NOT_PASSED")

    checks = validation.get("citation_checks") or []
    if not citations or not checks or len(citations) != len(checks):
        return reject("MISSING_OR_MISMATCHED_CITATIONS")

    for check in checks:
        if (
            check.get("status") != "PASS"
            or not check.get("is_in_force")
            or float(check.get("excerpt_similarity", 0)) < 0.90
        ):
            return reject("CITATION_CHECK_INELIGIBLE")

    q_fold = _fold(question)
    whitelist_id = _match_whitelist_rule(question, q_fold, as_of, _citation_keys(citations))
    if not whitelist_id:
        return reject("NOT_IN_DETERMINISTIC_WHITELIST")

    return {
        "settlement_eligible": True,
        "policy_version": POLICY_VERSION,
        "policy_hash": POLICY_HASH,
        "whitelist_id": whitelist_id,
        "policy_reason": "WHITELISTED_SOURCE_CHECK_VERIFIED",
    }
