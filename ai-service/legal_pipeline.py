"""Adapter orchestration for LegalIR -> LegalQA -> Validator.

Does not authorize payments or sign settlements.
"""
from datetime import date
from hashlib import sha256
import importlib
import json
import os
import time

from fastapi import HTTPException
from versioned_validator import validate_snapshot_citations


def identity(item):
    return (
        "".join(item["document"].upper().split()),
        item["article"].strip(),
        item["clause"].strip(),
        item.get("point", "").strip(),
    )


def require_citation(item):
    if not isinstance(item, dict):
        raise ValueError("citation must be an object")
    for field in ("document", "article", "clause", "excerpt"):
        if not isinstance(item.get(field), str) or not item[field].strip():
            raise ValueError(f"invalid citation field: {field}")
    if not isinstance(item.get("point", ""), str):
        raise ValueError("invalid point")


def digest(value):
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return "0x" + sha256(encoded).hexdigest()


def ask_with_adapter(req, snapshot, as_of: date):
    module_name = os.environ.get("ASKPAY_LEGAL_ADAPTER", "").strip()
    if not module_name:
        # Preserve the explicitly labelled extractive path.
        return None

    started = time.monotonic()
    limit = 3 if req.tier == "quick" else 8

    try:
        adapter = importlib.import_module(module_name)

        # The adapter wraps the team's existing retriever/reranker.
        hits = adapter.retrieve(
            question=req.question,
            snapshot=snapshot,
            as_of=as_of.isoformat(),
            top_k=limit,
        )
        if not isinstance(hits, list) or len(hits) > limit:
            raise ValueError("invalid retrieval response")

        evidence = []
        seen = set()

        for hit in hits:
            if not isinstance(hit, dict):
                raise ValueError("invalid retrieval item")
            for field in ("document", "article", "clause"):
                if not isinstance(hit.get(field), str):
                    raise ValueError("invalid retrieval identifier")
            if not isinstance(hit.get("point", ""), str):
                raise ValueError("invalid retrieval point")

            key = identity(hit)
            provision = snapshot.lookup(*key, as_of)
            if provision is None or key in seen:
                continue

            seen.add(key)
            evidence.append({
                "document": provision.document_id,
                "document_title": provision.document_title,
                "article": provision.article,
                "clause": provision.clause,
                "point": provision.point,
                "excerpt": provision.text,
            })

        status = "INSUFFICIENT_EVIDENCE"
        answer = (
            "Chưa có đủ căn cứ đã rà soát cho câu hỏi và ngày áp dụng này."
        )
        citations = []
        assessment = {"relevant": False, "supported": False}

        if evidence:
            draft = adapter.answer(
                question=req.question,
                evidence=evidence,
                tier=req.tier,
                as_of=as_of.isoformat(),
            )
            if not isinstance(draft, dict):
                raise ValueError("invalid QA response")

            status = draft.get("status")
            if status not in {
                "ANSWERED", "NEEDS_CLARIFICATION",
                "INSUFFICIENT_EVIDENCE", "OUT_OF_SCOPE"
            }:
                raise ValueError("invalid answer status")

            answer = draft.get("answer")
            if (
                not isinstance(answer, str)
                or not answer.strip()
                or len(answer) > 20000
            ):
                raise ValueError("invalid answer text")

            if status == "ANSWERED":
                citations = draft.get("citations")
                if (
                    not isinstance(citations, list)
                    or not 1 <= len(citations) <= 3
                ):
                    raise ValueError("answer requires 1–3 citations")

                for citation in citations:
                    require_citation(citation)

                assessment = adapter.assess(
                    question=req.question,
                    answer=answer,
                    evidence=evidence,
                    citations=citations,
                    as_of=as_of.isoformat(),
                )
                if (
                    not isinstance(assessment, dict)
                    or type(assessment.get("relevant")) is not bool
                    or type(assessment.get("supported")) is not bool
                ):
                    raise ValueError("invalid quality assessment")

                if not (assessment["relevant"] and assessment["supported"]):
                    status = "INSUFFICIENT_EVIDENCE"
                    answer = (
                        "Các căn cứ tìm được chưa đủ để trả lời đúng "
                        "tình huống này. Bạn có thể bổ sung loại hàng, "
                        "thời điểm và thủ tục đang thực hiện."
                    )
                    citations = []

        validation = validate_snapshot_citations(citations, snapshot, as_of)

        # Preserve original citation; never substitute another article
        for citation, check in zip(citations, validation["citation_checks"]):
            if identity(citation) not in seen:
                check["status"] = "FAIL"
                check["fail_reason"] = "CITATION_NOT_IN_RETRIEVED_EVIDENCE"

        validation["passed"] = bool(citations) and all(
            check["status"] == "PASS" for check in validation["citation_checks"]
        )
        validation["verdict"] = (
            "CITATIONS_MATCH" if validation["passed"] else "UNVERIFIED"
        )
        validation["settlement_eligible"] = False

        if status == "ANSWERED" and not validation["passed"]:
            status = "UNVERIFIED"

        return {
            "question_id": req.question_id,
            "tier": req.tier,
            "answer": answer,
            "answer_status": status,
            "answer_method": "LEGALIR_LEGALQA",
            "citations": citations,
            "validation": validation,
            "quality_assessment": {
                **assessment,
                "method": "ADAPTER_ASSESSMENT",
                "is_deterministic_legal_proof": False,
            },
            "snapshot_id": snapshot.snapshot_id,
            "snapshot_sha256": snapshot.snapshot_sha256,
            "as_of": as_of.isoformat(),
            "payment_status": "DISABLED",
            "hashes": {
                "question_hash": digest(req.question),
                "answer_hash": digest(answer),
                "citations_hash": digest(citations),
                "validator_hash": digest(validation),
                "corpus_hash": "0x" + snapshot.snapshot_sha256,
            },
            "latency_ms": int((time.monotonic() - started) * 1000),
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail="LegalIR/LegalQA chưa sẵn sàng hoặc trả dữ liệu sai cấu trúc.",
        ) from error
