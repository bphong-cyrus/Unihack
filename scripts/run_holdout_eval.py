"""Reproducible 30-question holdout evaluation script for Lorx rule-based demo + source-check-v1 policy."""

from __future__ import annotations

import json
import statistics
import subprocess
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AI_SERVICE_DIR = ROOT / "ai-service"
sys.path.insert(0, str(AI_SERVICE_DIR))

from demo_api import Ask, MANIFEST, SNAPSHOT, ask  # noqa: E402
from release_policy import POLICY_HASH, POLICY_VERSION  # noqa: E402

UI_SITUATION_PREFILLS = {
    "Hàng đến cửa khẩu ngày 01/11/2026, hôm nay 17/11/2026, theo mốc 30 ngày còn bao nhiêu ngày để nộp tờ khai nhập khẩu?",
    "Nhập máy tiện cũ từ Nhật năm 2012 để bán lại, chưa có mã HS hay giám định thì có đủ điều kiện nhập khẩu không?",
    "Nghị định 128/2020/NĐ-CP về xử phạt vi phạm hành chính hải quan còn hiệu lực tại ngày 17/11/2026 không?",
    "Kiểm chứng Điều 25 Khoản 1 Điểm b Luật 54/2014/QH13: Đối với hàng hóa nhập khẩu, nộp trước ngày hàng hóa đến cửa khẩu hoặc trong thời hạn 60 ngày kể từ ngày hàng hóa đến cửa khẩu;",
}


def build_holdout_cases():
    p_54_25_1_b = SNAPSHOT.lookup("54/2014/QH13", "25", "1", "b", date(2026, 11, 17)).text
    p_18_6_1 = SNAPSHOT.lookup("18/2019/QĐ-TTg", "6", "1", "", date(2026, 11, 17)).text

    return [
        # Group A: Whitelist positive cases (settlement_eligible=True)
        {
            "id": "WL-1a",
            "category": "whitelist_positive",
            "question": "Tàu cập cảng Hải Phòng ngày 05/10/2026, kiểm tra tại ngày 25/10/2026 thì theo mốc 30 ngày còn bao nhiêu ngày để nộp tờ khai nhập khẩu?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "ANSWERED",
            "expected_passed": True,
            "expected_settlement_eligible": True,
            "expected_whitelist_id": "WL-1-CUSTOMS-DEADLINE-30D",
            "expected_docs": ["54/2014/QH13"],
            "expected_substrings": ["còn 10 ngày", "đã qua 20 ngày"],
        },
        {
            "id": "WL-1b",
            "category": "whitelist_positive",
            "question": "Lô hàng nhập về cửa khẩu ngày 01/10/2026, đến ngày 05/11/2026 theo mốc 30 ngày đã quá hạn nộp tờ khai mấy ngày?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "ANSWERED",
            "expected_passed": True,
            "expected_settlement_eligible": True,
            "expected_whitelist_id": "WL-1-CUSTOMS-DEADLINE-30D",
            "expected_docs": ["54/2014/QH13"],
            "expected_substrings": ["vượt mốc 30 ngày 5 ngày"],
        },
        {
            "id": "WL-2a",
            "category": "whitelist_positive",
            "question": "Theo Khoản 2 Điều 25 Luật 54/2014/QH13, tờ khai hải quan có giá trị làm thủ tục bao nhiêu ngày kể từ ngày đăng ký?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "ANSWERED",
            "expected_passed": True,
            "expected_settlement_eligible": True,
            "expected_whitelist_id": "WL-2-DECLARATION-VALIDITY-15D",
            "expected_docs": ["54/2014/QH13"],
            "expected_substrings": ["15 ngày"],
        },
        {
            "id": "WL-3a",
            "category": "whitelist_positive",
            "question": "Theo Điều 38 Nghị định 169/2026/NĐ-CP thì Nghị định 128/2020/NĐ-CP chấm dứt hiệu lực từ ngày nào?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "ANSWERED",
            "expected_passed": True,
            "expected_settlement_eligible": True,
            "expected_whitelist_id": "WL-3-PENALTY-REPEAL-169-2026",
            "expected_docs": ["169/2026/NĐ-CP"],
            "expected_substrings": ["01/07/2026"],
        },
        {
            "id": "WL-4a",
            "category": "whitelist_positive",
            "question": "Theo Khoản 1 Điều 6 Quyết định 18/2019/QĐ-TTg, ngưỡng tuổi thiết bị tiêu chuẩn đối với máy móc đã qua sử dụng là bao nhiêu năm?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "ANSWERED",
            "expected_passed": True,
            "expected_settlement_eligible": True,
            "expected_whitelist_id": "WL-4-MACHINERY-AGE-RULE-10Y",
            "expected_docs": ["18/2019/QĐ-TTg"],
            "expected_substrings": ["10 năm"],
        },
        {
            "id": "WL-5a",
            "category": "whitelist_positive",
            "question": "Theo Điểm b Khoản 3 Điều 8 Quyết định 18/2019/QĐ-TTg, người nhập khẩu phải nộp chứng thư giám định trong thời hạn bao nhiêu ngày?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "ANSWERED",
            "expected_passed": True,
            "expected_settlement_eligible": True,
            "expected_whitelist_id": "WL-5-MACHINERY-INSPECTION-30D",
            "expected_docs": ["18/2019/QĐ-TTg"],
            "expected_substrings": ["30 ngày"],
        },
        # Group B: Date / horizon / non-whitelist effective-date cases (settlement_eligible=False)
        {
            "id": "HORIZON-1",
            "category": "temporal_boundary",
            "question": "Theo Điều 38 Nghị định 169/2026/NĐ-CP, Nghị định 128/2020/NĐ-CP hết hiệu lực từ ngày nào?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-11-18",
            "expected_status": "INSUFFICIENT_EVIDENCE",
            "expected_passed": False,
            "expected_settlement_eligible": False,
            "expected_docs": [],
        },
        {
            "id": "HIST-1",
            "category": "temporal_boundary",
            "question": "Điều 38 Nghị định 169/2026/NĐ-CP đã có hiệu lực thay thế Nghị định 128/2020/NĐ-CP chưa?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-06-30",
            "expected_status": "NEEDS_CLARIFICATION",
            "expected_passed": False,
            "expected_settlement_eligible": False,
            "expected_docs": [],
        },
        {
            "id": "HIST-2",
            "category": "temporal_boundary",
            "question": "Nghị định 128/2020/NĐ-CP về xử phạt vi phạm hành chính hải quan có còn áp dụng không?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-05-15",
            "expected_status": "NEEDS_CLARIFICATION",
            "expected_passed": False,
            "expected_settlement_eligible": False,
            "expected_docs": [],
        },
        {
            "id": "DATE-SWAP",
            "category": "temporal_boundary",
            "question": "Ngày đến cửa khẩu là 20/11/2026 nhưng ngày kiểm tra là 10/11/2026, còn bao nhiêu ngày nộp tờ khai theo mốc 30 ngày?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "NEEDS_CLARIFICATION",
            "expected_passed": True,
            "expected_settlement_eligible": False,
            "expected_docs": ["54/2014/QH13"],
        },
        {
            "id": "DATE-MISSING",
            "category": "temporal_boundary",
            "question": "Thời hạn nộp tờ khai hải quan đối với hàng nhập khẩu từ Nhật Bản được tính ra sao?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "ANSWERED",
            "expected_passed": True,
            "expected_settlement_eligible": False,
            "expected_docs": ["54/2014/QH13"],
        },
        # Group C: Machinery ambiguous / under-specified cases (NEEDS_CLARIFICATION, settlement_eligible=False)
        {
            "id": "MACH-1",
            "category": "clarification_required",
            "question": "Doanh nghiệp thương mại định nhập máy tiện cũ theo Quyết định 18/2019 từ Hàn Quốc về bán lại cho đối tác trong nước có được không?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "NEEDS_CLARIFICATION",
            "expected_passed": True,
            "expected_settlement_eligible": False,
            "expected_docs": ["18/2019/QĐ-TTG"],
        },
        {
            "id": "MACH-2",
            "category": "clarification_required",
            "question": "Công ty sản xuất muốn nhập máy tiện CNC kim loại sản xuất năm 2010 theo Quyết định 18/2019 và 28/2022 nhưng chưa có mã HS thì cần lưu ý gì?",
            "mode": "deep",
            "tier": "deep",
            "as_of": "2026-11-17",
            "expected_status": "NEEDS_CLARIFICATION",
            "expected_passed": True,
            "expected_settlement_eligible": False,
            "expected_docs": ["18/2019/QĐ-TTG", "28/2022/QĐ-TTG"],
        },
        {
            "id": "MACH-3",
            "category": "clarification_required",
            "question": "Tôi cần nhập một dây chuyền máy tiện cũ sản xuất năm 2014 theo Quyết định 18/2019 từ Thái Lan về phục vụ trực tiếp sản xuất.",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "NEEDS_CLARIFICATION",
            "expected_passed": True,
            "expected_settlement_eligible": False,
            "expected_docs": ["18/2019/QĐ-TTG"],
        },
        {
            "id": "MACH-4",
            "category": "clarification_required",
            "question": "Nếu máy tiện cũ vượt ngưỡng 20 năm nhưng muốn xin nhập về xưởng thì nộp hồ sơ theo Quyết định 02/2026 hay Quyết định 18/2019?",
            "mode": "deep",
            "tier": "deep",
            "as_of": "2026-11-17",
            "expected_status": "NEEDS_CLARIFICATION",
            "expected_passed": True,
            "expected_settlement_eligible": False,
            "expected_docs": ["18/2019/QĐ-TTG", "28/2022/QĐ-TTG", "54/2014/QH13"],
        },
        {
            "id": "MACH-5",
            "category": "clarification_required",
            "question": "Máy tiện cũ nhóm HS 84.58 sản xuất tại Nhật Bản theo Quyết định 18/2019 cần điều kiện tuổi và chứng thư giám định như thế nào?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "NEEDS_CLARIFICATION",
            "expected_passed": True,
            "expected_settlement_eligible": False,
            "expected_docs": ["18/2019/QĐ-TTG"],
        },
        # Group D: Factcheck exact match & adversarial mutations (settlement_eligible=False)
        {
            "id": "FC-PASS-54",
            "category": "factcheck_pass",
            "question": "Kiểm chứng nguyên văn Điểm b Khoản 1 Điều 25 Luật 54/2014/QH13",
            "mode": "factcheck",
            "tier": "quick",
            "as_of": "2026-11-17",
            "factcheck_payload": {
                "document": "54/2014/QH13",
                "article": "25",
                "clause": "1",
                "point": "b",
                "excerpt": p_54_25_1_b,
            },
            "expected_status": "FACTCHECK",
            "expected_passed": True,
            "expected_settlement_eligible": False,
            "expected_docs": ["54/2014/QH13"],
        },
        {
            "id": "FC-PASS-18",
            "category": "factcheck_pass",
            "question": "Kiểm chứng nguyên văn Khoản 1 Điều 6 Quyết định 18/2019/QĐ-TTg",
            "mode": "factcheck",
            "tier": "quick",
            "as_of": "2026-11-17",
            "factcheck_payload": {
                "document": "18/2019/QĐ-TTg",
                "article": "6",
                "clause": "1",
                "point": "",
                "excerpt": p_18_6_1,
            },
            "expected_status": "FACTCHECK",
            "expected_passed": True,
            "expected_settlement_eligible": False,
            "expected_docs": ["18/2019/QĐ-TTg"],
        },
        {
            "id": "FC-FAIL-NUM-30-45",
            "category": "adversarial_factcheck_fail",
            "question": "Kiểm chứng đoạn sửa sai số ngày 30 thành 45",
            "mode": "factcheck",
            "tier": "quick",
            "as_of": "2026-11-17",
            "factcheck_payload": {
                "document": "54/2014/QH13",
                "article": "25",
                "clause": "1",
                "point": "b",
                "excerpt": p_54_25_1_b.replace("30", "45"),
            },
            "expected_status": "FACTCHECK",
            "expected_passed": False,
            "expected_settlement_eligible": False,
            "expected_docs": ["54/2014/QH13"],
        },
        {
            "id": "FC-FAIL-NUM-10-15",
            "category": "adversarial_factcheck_fail",
            "question": "Kiểm chứng đoạn sửa tuổi thiết bị 10 năm thành 15 năm",
            "mode": "factcheck",
            "tier": "quick",
            "as_of": "2026-11-17",
            "factcheck_payload": {
                "document": "18/2019/QĐ-TTg",
                "article": "6",
                "clause": "1",
                "point": "",
                "excerpt": p_18_6_1.replace("10", "15"),
            },
            "expected_status": "FACTCHECK",
            "expected_passed": False,
            "expected_settlement_eligible": False,
            "expected_docs": ["18/2019/QĐ-TTg"],
        },
        {
            "id": "FC-FAIL-NEGATION",
            "category": "adversarial_factcheck_fail",
            "question": "Kiểm chứng đoạn đảo nghĩa bỏ chữ không vượt quá",
            "mode": "factcheck",
            "tier": "quick",
            "as_of": "2026-11-17",
            "factcheck_payload": {
                "document": "18/2019/QĐ-TTg",
                "article": "6",
                "clause": "1",
                "point": "",
                "excerpt": p_18_6_1.replace("không vượt quá", "được vượt quá"),
            },
            "expected_status": "FACTCHECK",
            "expected_passed": False,
            "expected_settlement_eligible": False,
            "expected_docs": ["18/2019/QĐ-TTg"],
        },
        {
            "id": "FC-FAIL-ART999",
            "category": "adversarial_factcheck_fail",
            "question": "Kiểm chứng Điều 999 Khoản 2 Luật 54/2014/QH13",
            "mode": "factcheck",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "FACTCHECK",
            "expected_passed": False,
            "expected_settlement_eligible": False,
            "expected_docs": ["54/2014/QH13"],
        },
        {
            "id": "FC-FAIL-BAD-DOC",
            "category": "adversarial_factcheck_fail",
            "question": "Kiểm chứng Điều 25 Khoản 1 Luật 88/2025/QH15",
            "mode": "factcheck",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "FACTCHECK",
            "expected_passed": False,
            "expected_settlement_eligible": False,
            "expected_docs": ["88/2025/QH15"],
        },
        {
            "id": "FC-UNSTRUCTURED-BAD",
            "category": "adversarial_factcheck_fail",
            "question": "Kiểm chứng Điều 25 Khoản 2 Luật 54/2014/QH13: Tờ khai hải quan có giá trị làm thủ tục hải quan trong thời hạn 90 ngày kể từ ngày đăng ký.",
            "mode": "factcheck",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "FACTCHECK",
            "expected_passed": False,
            "expected_settlement_eligible": False,
            "expected_docs": ["54/2014/QH13"],
        },
        # Group E: Out-of-scope abstention cases (INSUFFICIENT_EVIDENCE, passed=False, settlement_eligible=False)
        {
            "id": "OOS-1",
            "category": "out_of_scope_abstention",
            "question": "Thủ tục thành lập công ty trách nhiệm hữu hạn một thành viên cần nộp hồ sơ ở đâu?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "INSUFFICIENT_EVIDENCE",
            "expected_passed": False,
            "expected_settlement_eligible": False,
            "expected_docs": [],
        },
        {
            "id": "OOS-2",
            "category": "out_of_scope_abstention",
            "question": "Mức thuế giá trị gia tăng đối với phần mềm gia công nước ngoài hiện nay là bao nhiêu phần trăm?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "INSUFFICIENT_EVIDENCE",
            "expected_passed": False,
            "expected_settlement_eligible": False,
            "expected_docs": [],
        },
        {
            "id": "OOS-3",
            "category": "out_of_scope_abstention",
            "question": "Người lao động thử việc nghỉ ngang có được nhận đủ lương những ngày đã làm không?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "INSUFFICIENT_EVIDENCE",
            "expected_passed": False,
            "expected_settlement_eligible": False,
            "expected_docs": [],
        },
        {
            "id": "OOS-4",
            "category": "out_of_scope_abstention",
            "question": "Hợp đồng thuê kho bãi nội địa bị bên cho thuê đơn phương chấm dứt trước hạn thì phạt vi phạm ra sao?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "INSUFFICIENT_EVIDENCE",
            "expected_passed": False,
            "expected_settlement_eligible": False,
            "expected_docs": [],
        },
        {
            "id": "OOS-5",
            "category": "out_of_scope_abstention",
            "question": "Xin cấp giấy chứng nhận xuất xứ hàng hóa mẫu EUR.1 theo hiệp định EVFTA nộp qua cổng nào?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "INSUFFICIENT_EVIDENCE",
            "expected_passed": False,
            "expected_settlement_eligible": False,
            "expected_docs": [],
        },
        {
            "id": "OOS-6",
            "category": "out_of_scope_abstention",
            "question": "Thẩm quyền xử phạt vượt đèn đỏ khi lái xe container ngoài khu vực cảng thuộc cơ quan nào?",
            "mode": "quick",
            "tier": "quick",
            "as_of": "2026-11-17",
            "expected_status": "INSUFFICIENT_EVIDENCE",
            "expected_passed": False,
            "expected_settlement_eligible": False,
            "expected_docs": [],
        },
    ]


def get_git_commit_sha() -> str:
    try:
        out = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        return out
    except Exception:
        return "UNKNOWN"


def main() -> int:
    cases = build_holdout_cases()
    assert len(cases) == 30, f"Expected 30 holdout cases, got {len(cases)}"
    for case in cases:
        assert case["question"] not in UI_SITUATION_PREFILLS, (
            f"Holdout case {case['id']} overlaps UI situation prefill!"
        )

    latencies_ms = []
    results = []
    exact_matches = 0
    citation_hits = 0
    false_accepts = 0
    false_settlement_releases = 0
    abstention_expected = 0
    abstention_correct = 0

    for case in cases:
        t0 = time.perf_counter()
        res = ask(
            Ask(
                question_id=f"holdout-{case['id']}",
                question=case["question"],
                mode=case["mode"],
                tier=case["tier"],
                as_of=date.fromisoformat(case["as_of"]),
                factcheck_payload=case.get("factcheck_payload"),
            )
        )
        dt_ms = round((time.perf_counter() - t0) * 1000.0, 3)
        latencies_ms.append(dt_ms)

        got_status = res["answer_status"]
        got_passed = bool(res["validation"]["passed"])
        got_eligible = bool(res["validation"]["settlement_eligible"])
        got_docs = [c["document"] for c in res.get("citations", [])]
        got_docs_upper = {d.upper() for d in got_docs}

        docs_ok = all(d.upper() in got_docs_upper for d in case["expected_docs"])
        if not case["expected_docs"]:
            docs_ok = len(got_docs) == 0
        if docs_ok:
            citation_hits += 1

        substrings_ok = all(s.lower() in res["answer"].lower() for s in case.get("expected_substrings", []))
        whitelist_ok = (
            res["validation"].get("whitelist_id") == case["expected_whitelist_id"]
            if "expected_whitelist_id" in case
            else True
        )

        case_passed = (
            got_status == case["expected_status"]
            and got_passed == case["expected_passed"]
            and got_eligible == case["expected_settlement_eligible"]
            and docs_ok
            and substrings_ok
            and whitelist_ok
        )
        if case_passed:
            exact_matches += 1

        if not case["expected_passed"] and got_passed:
            false_accepts += 1
        if not case["expected_settlement_eligible"] and got_eligible:
            false_settlement_releases += 1

        if case["expected_status"] in ("NEEDS_CLARIFICATION", "INSUFFICIENT_EVIDENCE") or (
            case["mode"] == "factcheck" and not case["expected_passed"]
        ):
            abstention_expected += 1
            if got_status == case["expected_status"] and got_passed == case["expected_passed"]:
                abstention_correct += 1

        results.append(
            {
                "id": case["id"],
                "category": case["category"],
                "as_of": case["as_of"],
                "mode": case["mode"],
                "tier": case["tier"],
                "expected": {
                    "answer_status": case["expected_status"],
                    "passed": case["expected_passed"],
                    "settlement_eligible": case["expected_settlement_eligible"],
                    "docs": case["expected_docs"],
                },
                "actual": {
                    "answer_status": got_status,
                    "passed": got_passed,
                    "settlement_eligible": got_eligible,
                    "whitelist_id": res["validation"].get("whitelist_id"),
                    "docs": got_docs,
                    "answer_method": res["answer_method"],
                    "policy_version": res["policy_version"],
                },
                "matched": case_passed,
                "latency_ms": dt_ms,
            }
        )

    sorted_lat = sorted(latencies_ms)
    p50 = round(statistics.median(sorted_lat), 3)
    p95_idx = min(len(sorted_lat) - 1, max(0, int(round(0.95 * (len(sorted_lat) - 1)))))
    p95 = round(sorted_lat[p95_idx], 3)

    manifest_data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    summary = {
        "evaluated_at_utc": datetime.now(timezone.utc).isoformat(),
        "git_commit_sha": get_git_commit_sha(),
        "snapshot_id": SNAPSHOT.snapshot_id,
        "snapshot_sha256": SNAPSHOT.snapshot_sha256,
        "verified_through": manifest_data.get("verified_through", "2026-11-17"),
        "answer_method": "RULE_BASED_DEMO",
        "policy_version": POLICY_VERSION,
        "policy_hash": POLICY_HASH,
        "dataset": {
            "name": "lorx-holdout-30-v1",
            "total_queries": len(cases),
            "ui_prefill_overlap_count": 0,
            "by_category": {
                "whitelist_positive": 6,
                "temporal_boundary": 5,
                "clarification_required": 5,
                "factcheck_pass": 2,
                "adversarial_factcheck_fail": 6,
                "out_of_scope_abstention": 6,
            },
        },
        "metrics": {
            "exact_match_count": exact_matches,
            "exact_match_rate": round(exact_matches / len(cases), 4),
            "citation_match_count": citation_hits,
            "citation_match_rate": round(citation_hits / len(cases), 4),
            "abstention_and_refusal_expected": abstention_expected,
            "abstention_and_refusal_correct": abstention_correct,
            "abstention_and_refusal_rate": round(abstention_correct / abstention_expected, 4),
            "false_accepts": false_accepts,
            "false_settlement_releases": false_settlement_releases,
            "latency_p50_ms": p50,
            "latency_p95_ms": p95,
        },
        "cases": results,
    }

    evidence_dir = ROOT / "evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    holdout_path = evidence_dir / "holdout-eval.json"
    holdout_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Compact public demo run report referencing manifest + holdout + policy
    demo_results = {
        "generated_at_utc": summary["evaluated_at_utc"],
        "git_commit_sha": summary["git_commit_sha"],
        "product": "Lorx",
        "live_demo_url": "https://lorx-xnk.vercel.app/",
        "answer_method": "RULE_BASED_DEMO",
        "scope_note": "Kiểm chứng nguyên văn & hiệu lực trong snapshot đã rà soát; không phải mô hình RAG tổng quát hay chứng nhận tư vấn pháp lý.",
        "corpus": {
            "snapshot_id": SNAPSHOT.snapshot_id,
            "snapshot_sha256": SNAPSHOT.snapshot_sha256,
            "verified_through": manifest_data.get("verified_through", "2026-11-17"),
            "documents": len(manifest_data.get("documents", [])),
            "provisions": sum(len(d.get("provisions", [])) for d in manifest_data.get("documents", [])),
        },
        "release_policy": {
            "policy_version": POLICY_VERSION,
            "policy_hash": POLICY_HASH,
            "whitelist_count": 5,
        },
        "holdout_summary": summary["metrics"],
    }
    demo_results_path = evidence_dir / "demo-results.json"
    demo_results_path.write_text(
        json.dumps(demo_results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(
        json.dumps(
            {
                "holdout_eval": str(holdout_path),
                "demo_results": str(demo_results_path),
                "metrics": summary["metrics"],
            },
            ensure_ascii=False,
        )
    )
    assert exact_matches == len(cases), f"Only {exact_matches}/{len(cases)} holdout cases matched!"
    assert false_accepts == 0, f"Unexpected false_accepts={false_accepts}"
    assert false_settlement_releases == 0, f"Unexpected false_settlement_releases={false_settlement_releases}"
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
