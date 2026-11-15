import hashlib
import json
import time
from datetime import date
from typing import Annotated, List, Literal, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, StringConstraints

from citation_text import normalize_vn_text, compute_excerpt_similarity
from snapshot_api import ask_snapshot, configured_snapshot, corpus_response, query_date
from versioned_validator import validate_snapshot_citations

app = FastAPI(
    title="AskPay XNK — LegalIR / LegalQA & Citation Validator API",
    version="1.0.0",
    description="API tra cứu pháp luật Hải quan & Xuất nhập khẩu với Deterministic Citation Validator (>=90%)"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==============================================================================
# 1. CORPUS MẪU NGÀNH XUẤT NHẬP KHẨU & HẢI QUAN (Chunked theo Điều & Khoản)
#    Khi bạn của bạn ghép LegalIR vào, chỉ cần thay dict này bằng DB thực tế
# ==============================================================================
CORPUS_RECORDS = [
    {
        "doc_id": "128/2020/NĐ-CP",
        "doc_title": "Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan",
        "article": "9",
        "clause": "1",
        "status": "ACTIVE",
        "effective_date": "2020-12-10",
        "raw_text": (
            "Phạt 20% tính trên số tiền thuế khai thiếu hoặc số tiền thuế được miễn, giảm, hoàn, "
            "không thu cao hơn so với quy định của pháp luật về thuế đối với hành vi khai sai mã số "
            "hàng hóa, thuế suất, mức thuế đối với hàng hóa xuất khẩu, nhập khẩu dẫn đến thiếu số tiền "
            "thuế phải nộp mà bị cơ quan hải quan phát hiện trong quá trình kiểm tra sau thông quan."
        ),
    },
    {
        "doc_id": "38/2015/TT-BTC",
        "doc_title": "Thông tư quy định về thủ tục hải quan; kiểm tra, giám sát hải quan; thuế xuất khẩu, thuế nhập khẩu",
        "article": "18",
        "clause": "1",
        "status": "ACTIVE",
        "effective_date": "2015-04-01",
        "raw_text": (
            "Người khai hải quan phải khai đầy đủ các thông tin trên tờ khai hải quan theo các chỉ tiêu "
            "thông tin quy định tại mẫu số 01 hoặc mẫu số 02 Phụ lục II ban hành kèm theo Thông tư này "
            "và gửi các chứng từ thuộc hồ sơ hải quan cho cơ quan hải quan qua hệ thống xử lý dữ liệu điện tử hải quan."
        ),
    },
    {
        "doc_id": "39/2018/TT-BTC",
        "doc_title": "Thông tư sửa đổi, bổ sung một số điều tại Thông tư 38/2015/TT-BTC về thủ tục hải quan",
        "article": "1",
        "clause": "7",
        "status": "ACTIVE",
        "effective_date": "2018-06-05",
        "raw_text": (
            "Người khai hải quan được khai bổ sung hồ sơ hải quan sau khi Hệ thống phân luồng tờ khai "
            "nhưng trước thời điểm cơ quan hải quan thông báo việc kiểm tra trực tiếp hồ sơ hải quan "
            "hoặc kiểm tra thực tế hàng hóa."
        ),
    },
    {
        "doc_id": "31/2018/NĐ-CP",
        "doc_title": "Nghị định quy định chi tiết Luật Quản lý ngoại thương về xuất xứ hàng hóa (C/O)",
        "article": "15",
        "clause": "1",
        "status": "ACTIVE",
        "effective_date": "2018-03-08",
        "raw_text": (
            "Thương nhân đề nghị cấp Giấy chứng nhận xuất xứ hàng hóa (C/O) lần đầu phải đăng ký "
            "Hồ sơ thương nhân với cơ quan, tổ chức cấp Giấy chứng nhận xuất xứ hàng hóa thông qua "
            "Hệ thống quản lý và cấp chứng nhận xuất xứ điện tử."
        ),
    },
    {
        "doc_id": "107/2016/QH13",
        "doc_title": "Luật Thuế xuất khẩu, thuế nhập khẩu năm 2016",
        "article": "19",
        "clause": "1",
        "status": "ACTIVE",
        "effective_date": "2016-09-01",
        "raw_text": (
            "Người nộp thuế đã nộp thuế nhập khẩu nhưng hàng hóa nhập khẩu phải tái xuất "
            "được hoàn thuế nhập khẩu và không phải nộp thuế xuất khẩu khi hàng hóa chưa qua "
            "sử dụng, gia công, chế biến tại Việt Nam."
        ),
    },
    {
        "doc_id": "54/2014/QH13",
        "doc_title": "Luật Hải quan năm 2014",
        "article": "25",
        "clause": "1",
        "status": "ACTIVE",
        "effective_date": "2015-01-01",
        "raw_text": (
            "Đối với hàng hóa nhập khẩu, nộp trước ngày hàng hóa đến cửa khẩu hoặc trong "
            "thời hạn 30 ngày kể từ ngày hàng hóa đến cửa khẩu."
        ),
    },
    {
        "doc_id": "127/2013/NĐ-CP",
        "doc_title": "Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan (ĐÃ HẾT HIỆU LỰC)",
        "article": "8",
        "clause": "1",
        "status": "EXPIRED",
        "effective_date": "2014-01-01",
        "raw_text": (
            "Phạt tiền từ 1.000.000 đồng đến 3.000.000 đồng đối với hành vi không khai hoặc khai sai "
            "so với thực tế về tên hàng, chủng loại, số lượng hàng hóa xuất khẩu, nhập khẩu."
        ),
    },
]

CORPUS_INDEX = {
    (r["doc_id"].upper(), str(r["article"]), str(r["clause"])): r
    for r in CORPUS_RECORDS
}


# ==============================================================================
# 2. DETERMINISTIC CITATION VALIDATOR (Chuẩn >= 90% Excerpt Match)
# ==============================================================================


def validate_citations(citations: list[dict]) -> dict:
    if not citations:
        return {
            "passed": False,
            "verdict": "UNVERIFIED_REFUND",
            "settlement_eligible": False,
            "corpus_status": "DEMO_UNVERIFIED",
            "overall_score": 0.0,
            "citation_checks": [],
            "fail_reason": "NO_CITATION_PROVIDED",
        }

    checks = []
    all_passed = True
    total_scores = []

    for c in citations:
        doc_id = ''.join(str(c.get("document", "")).upper().split())
        article = str(c.get("article", "")).strip()
        clause = str(c.get("clause", "")).strip()
        point = str(c.get("point", "")).strip()
        excerpt = str(c.get("excerpt", "")).strip()

        doc_exists = any(k[0] == doc_id for k in CORPUS_INDEX.keys())
        # The demo corpus records clauses only; it cannot verify a named point.
        record = CORPUS_INDEX.get((doc_id, article, clause)) if not point else None
        art_clause_exists = record is not None
        is_in_force = bool(record and record.get("status") == "ACTIVE")
        similarity = (
            compute_excerpt_similarity(excerpt, record["raw_text"])
            if record
            else 0.0
        )

        fail_reason = None
        if not doc_exists:
            fail_reason = "DOCUMENT_NOT_IN_CORPUS"
        elif not art_clause_exists:
            fail_reason = "ARTICLE_OR_CLAUSE_NOT_FOUND"
        elif not is_in_force:
            fail_reason = "DOCUMENT_EXPIRED_OR_REPLACED"
        elif similarity < 0.90:
            fail_reason = f"EXCERPT_SIMILARITY_TOO_LOW ({similarity * 100:.1f}% < 90%)"

        passed_this = fail_reason is None
        if not passed_this:
            all_passed = False

        item_score = (
            (25.0 if doc_exists else 0.0)
            + (25.0 if art_clause_exists else 0.0)
            + (20.0 if is_in_force else 0.0)
            + (30.0 * similarity)
        )
        total_scores.append(item_score)

        checks.append(
            {
                "document": doc_id,
                "article": article,
                "clause": clause,
                "point": point,
                "doc_exists": doc_exists,
                "article_clause_exists": art_clause_exists,
                "is_in_force": is_in_force,
                "excerpt_similarity": similarity,
                "threshold_required": 0.90,
                "raw_text": record["raw_text"] if record else "",
                "status": "PASS" if passed_this else "FAIL",
                "fail_reason": fail_reason,
            }
        )

    return {
        "passed": all_passed,
        "verdict": "VERIFIED_RELEASE" if all_passed else "UNVERIFIED_REFUND",
        "settlement_eligible": False,
        "corpus_status": "DEMO_UNVERIFIED",
        "overall_score": round(sum(total_scores) / len(total_scores), 2),
        "citation_checks": checks,
    }


def sha256_hex(data: str) -> str:
    return "0x" + hashlib.sha256(data.encode("utf-8")).hexdigest()


# ==============================================================================
# 3. API MODELS & ENDPOINTS
# ==============================================================================
class ValidateRequest(BaseModel):
    citations: list[dict]
    as_of: Optional[date] = None


class AskRequest(BaseModel):
    question_id: Optional[str] = "0x00"
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    tier: Literal["quick", "deep"] = "quick"
    domain: Literal["import_export_customs"] = "import_export_customs"
    simulate_hallucination: bool = False
    simulate_expired_law: bool = False
    as_of: Optional[date] = None


@app.get("/api/v1/legal/corpus")
def get_corpus():
    snapshot = configured_snapshot()
    if snapshot is not None:
        return corpus_response(snapshot)
    return {
        "total_documents": len({r["doc_id"] for r in CORPUS_RECORDS}),
        "total_chunks": len(CORPUS_RECORDS),
        "corpus_status": "DEMO_UNVERIFIED",
        "domain": "Import-Export & Vietnam Customs Law",
        "records": CORPUS_RECORDS,
    }


@app.post("/api/v1/legal/validate")
def validate_endpoint(req: ValidateRequest):
    snapshot = configured_snapshot()
    if snapshot is not None:
        return validate_snapshot_citations(req.citations, snapshot, query_date(req.as_of))
    if req.as_of is not None:
        raise HTTPException(status_code=400, detail="Dữ liệu demo không hỗ trợ tra cứu theo ngày.")
    return validate_citations(req.citations)


@app.post("/api/v1/legal/ask")
def ask_legal_question(req: AskRequest):
    snapshot = configured_snapshot()
    if snapshot is not None:
        return ask_snapshot(req, snapshot)
    if req.as_of is not None:
        raise HTTPException(status_code=400, detail="Dữ liệu demo không hỗ trợ tra cứu theo ngày.")
    start_time = time.time()

    # Trường hợp 1: Giả lập AI trích dẫn văn bản đã hết hiệu lực (để demo Auto-Refund)
    if req.simulate_expired_law:
        answer = (
            "Theo Khoản 1 Điều 8 Nghị định 127/2013/NĐ-CP, hành vi khai sai tên hàng, số lượng "
            "hàng hóa xuất nhập khẩu bị phạt từ 1.000.000 đồng đến 3.000.000 đồng."
        )
        citations = [
            {
                "document": "127/2013/NĐ-CP",
                "document_title": "Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan",
                "article": "8",
                "clause": "1",
                "excerpt": (
                    "Phạt tiền từ 1.000.000 đồng đến 3.000.000 đồng đối với hành vi không khai hoặc khai sai "
                    "so với thực tế về tên hàng, chủng loại, số lượng hàng hóa xuất khẩu, nhập khẩu."
                ),
            }
        ]
    # Trường hợp 2: Giả lập AI bịa nội dung điều khoản (< 90% Excerpt Similarity -> Auto-Refund)
    elif req.simulate_hallucination:
        answer = (
            "Theo Khoản 1 Điều 9 Nghị định 128/2020/NĐ-CP, doanh nghiệp nhập khẩu khai sai mã HS lần đầu "
            "được miễn phạt 100% và được thông quan luồng xanh tự động tại mọi chi cục hải quan."
        )
        citations = [
            {
                "document": "128/2020/NĐ-CP",
                "document_title": "Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan",
                "article": "9",
                "clause": "1",
                "excerpt": (
                    "Doanh nghiệp nhập khẩu khai sai mã HS lần đầu được miễn phạt hoàn toàn 100% "
                    "và được ưu tiên thông quan luồng xanh tự động tại cửa khẩu."
                ),
            }
        ]
    # Trường hợp 3: Câu trả lời chuẩn xác từ Corpus XNK (PASS >= 90% -> Giải ngân)
    else:
        q_lower = req.question.lower()
        if (any(term in q_lower for term in ("c/o", "chứng nhận xuất xứ"))
                and "thương nhân" in q_lower and any(term in q_lower for term in ("đăng ký", "hồ sơ"))):
            answer = (
                "Theo quy định tại Khoản 1 Điều 15 Nghị định 31/2018/NĐ-CP, doanh nghiệp xuất nhập khẩu "
                "đề nghị cấp Giấy chứng nhận xuất xứ hàng hóa (C/O) lần đầu bắt buộc phải đăng ký Hồ sơ thương nhân "
                "thông qua Hệ thống quản lý và cấp chứng nhận xuất xứ điện tử trước khi nộp bộ hồ sơ C/O."
            )
            citations = [
                {
                    "document": "31/2018/NĐ-CP",
                    "document_title": "Nghị định quy định chi tiết Luật Quản lý ngoại thương về xuất xứ hàng hóa (C/O)",
                    "article": "15",
                    "clause": "1",
                    "excerpt": (
                        "Thương nhân đề nghị cấp Giấy chứng nhận xuất xứ hàng hóa (C/O) lần đầu phải đăng ký "
                        "Hồ sơ thương nhân với cơ quan, tổ chức cấp Giấy chứng nhận xuất xứ hàng hóa thông qua "
                        "Hệ thống quản lý và cấp chứng nhận xuất xứ điện tử."
                    ),
                }
            ]
        elif "hoàn thuế" in q_lower and "nhập khẩu" in q_lower and "tái xuất" in q_lower:
            answer = (
                "Theo Khoản 1 Điều 19 Luật Thuế xuất khẩu, thuế nhập khẩu 2016 (Luật số 107/2016/QH13), "
                "doanh nghiệp đã nộp thuế nhập khẩu nhưng hàng hóa nhập khẩu phải tái xuất sẽ được hoàn thuế "
                "nhập khẩu và không phải nộp thuế xuất khẩu với điều kiện hàng hóa đó chưa qua sử dụng, "
                "gia công, chế biến tại Việt Nam."
            )
            citations = [
                {
                    "document": "107/2016/QH13",
                    "document_title": "Luật Thuế xuất khẩu, thuế nhập khẩu năm 2016",
                    "article": "19",
                    "clause": "1",
                    "excerpt": (
                        "Người nộp thuế đã nộp thuế nhập khẩu nhưng hàng hóa nhập khẩu phải tái xuất "
                        "được hoàn thuế nhập khẩu và không phải nộp thuế xuất khẩu khi hàng hóa chưa qua "
                        "sử dụng, gia công, chế biến tại Việt Nam."
                    ),
                }
            ]
        elif "thời hạn" in q_lower and "tờ khai" in q_lower and "nhập khẩu" in q_lower:
            answer = (
                "Theo Điểm b Khoản 1 Điều 25 Luật Hải quan 2014 (Luật số 54/2014/QH13), đối với hàng hóa "
                "nhập khẩu, người khai hải quan phải nộp tờ khai hải quan trước ngày hàng hóa đến cửa khẩu "
                "hoặc trong thời hạn 30 ngày kể từ ngày hàng hóa đến cửa khẩu."
            )
            citations = [
                {
                    "document": "54/2014/QH13",
                    "document_title": "Luật Hải quan năm 2014",
                    "article": "25",
                    "clause": "1",
                    "excerpt": (
                        "Đối với hàng hóa nhập khẩu, nộp trước ngày hàng hóa đến cửa khẩu hoặc trong "
                        "thời hạn 30 ngày kể từ ngày hàng hóa đến cửa khẩu."
                    ),
                }
            ]
        elif "khai bổ sung" in q_lower and "phân luồng" in q_lower:
            answer = (
                "Theo Khoản 7 Điều 1 Thông tư 39/2018/TT-BTC, người khai hải quan được phép khai bổ sung "
                "hồ sơ hải quan sau khi Hệ thống phân luồng tờ khai nhưng trước thời điểm cơ quan hải quan "
                "thông báo kiểm tra trực tiếp hồ sơ hoặc kiểm tra thực tế hàng hóa."
            )
            citations = [
                {
                    "document": "39/2018/TT-BTC",
                    "document_title": "Thông tư sửa đổi, bổ sung một số điều tại Thông tư 38/2015/TT-BTC về thủ tục hải quan",
                    "article": "1",
                    "clause": "7",
                    "excerpt": (
                        "Người khai hải quan được khai bổ sung hồ sơ hải quan sau khi Hệ thống phân luồng tờ khai "
                        "nhưng trước thời điểm cơ quan hải quan thông báo việc kiểm tra trực tiếp hồ sơ hải quan "
                        "hoặc kiểm tra thực tế hàng hóa."
                    ),
                }
            ]
        elif not (any(term in q_lower for term in ("mã hs", "mã số hàng"))
                  and any(term in q_lower for term in ("sai", "nhầm"))
                  and any(term in q_lower for term in ("phạt", "xử lý"))):
            answer = (
                "Hiện chưa tìm thấy điều khoản pháp luật Hải quan và Xuất nhập khẩu phù hợp trong kho văn bản "
                "để đối chiếu câu hỏi này. Đây là dữ liệu thử nghiệm, không có giao dịch thanh toán."
            )
            citations = []
        else:
            answer = (
                "Theo quy định tại Khoản 1 Điều 9 Nghị định 128/2020/NĐ-CP, trường hợp doanh nghiệp xuất nhập khẩu "
                "khai sai mã số hàng hóa (mã HS), thuế suất dẫn đến thiếu số tiền thuế phải nộp mà bị cơ quan hải quan "
                "phát hiện trong quá trình kiểm tra sau thông quan thì bị phạt 20% tính trên số tiền thuế khai thiếu."
            )
            citations = [
                {
                    "document": "128/2020/NĐ-CP",
                    "document_title": "Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan",
                    "article": "9",
                    "clause": "1",
                    "excerpt": (
                        "Phạt 20% tính trên số tiền thuế khai thiếu hoặc số tiền thuế được miễn, giảm, hoàn, "
                        "không thu cao hơn so với quy định của pháp luật về thuế đối với hành vi khai sai mã số "
                        "hàng hóa, thuế suất, mức thuế đối với hàng hóa xuất khẩu, nhập khẩu"
                    ),
                }
            ]

    validation = validate_citations(citations)
    latency_ms = int((time.time() - start_time) * 1000)

    return {
        "question_id": req.question_id,
        "tier": req.tier,
        "answer": answer,
        "citations": citations,
        "validation": validation,
        "hashes": {
            "question_hash": sha256_hex(req.question),
            "answer_hash": sha256_hex(answer),
            "citations_hash": sha256_hex(json.dumps(citations, ensure_ascii=False)),
            "validator_hash": sha256_hex(json.dumps(validation, ensure_ascii=False)),
        },
        "latency_ms": latency_ms,
    }
