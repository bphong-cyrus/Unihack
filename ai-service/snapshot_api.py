"""Adapt a local snapshot to the existing API without a generative model."""
from datetime import datetime
from zoneinfo import ZoneInfo
import hashlib
import json
import os
import time
from fastapi import HTTPException
from legal_corpus import CorpusError, load_snapshot
from legal_pipeline import ask_with_adapter
from snapshot_search import retrieve
from versioned_validator import validate_snapshot_citations


def configured_snapshot():
    path = os.environ.get('ASKPAY_CORPUS_MANIFEST')
    if not path:
        return None
    try:
        return load_snapshot(path)
    except CorpusError as error:
        raise HTTPException(status_code=503, detail='Kho dữ liệu không hợp lệ hoặc không thể đọc.') from error


def query_date(as_of):
    return as_of or datetime.now(ZoneInfo('Asia/Ho_Chi_Minh')).date()


def corpus_response(snapshot):
    docs = {}
    for item in snapshot.provisions:
        doc = docs.setdefault(item.document_id, {'doc_id': item.document_id, 'doc_title': item.document_title,
                                                'source_url': item.source_url, 'total_versions': 0,
                                                'reviewed_versions': 0})
        doc['total_versions'] += 1
        doc['reviewed_versions'] += int(item.reviewed)
    return {'snapshot_id': snapshot.snapshot_id, 'snapshot_sha256': snapshot.snapshot_sha256, 'corpus_status': 'REVIEW_ASSERTED',
            'total_documents': snapshot.document_count, 'total_chunks': snapshot.provision_count,
            'reviewed_chunks': snapshot.reviewed_count, 'records': list(docs.values()),
            'domain': 'Import-Export & Vietnam Customs Law'}


def ask_snapshot(req, snapshot):
    if req.simulate_hallucination or req.simulate_expired_law:
        raise HTTPException(status_code=400, detail='Tình huống giả lập chỉ hỗ trợ trong chế độ demo.')
    start = time.monotonic()
    as_of = query_date(req.as_of)
    generated = ask_with_adapter(req, snapshot, as_of)
    if generated is not None:
        return generated
    candidates = retrieve(snapshot, req.question, as_of, 3 if req.tier == 'quick' else 8)
    items = candidates[:3 if req.tier == 'quick' else 8]
    citations = [{'document': p.document_id, 'document_title': p.document_title,
                  'article': p.article, 'clause': p.clause, 'point': p.point, 'excerpt': p.text}
                 for p in items]
    validation = validate_snapshot_citations(citations, snapshot, as_of)
    if items:
        answer = 'Các đoạn có từ khóa liên quan (cần chuyên gia đối chiếu bối cảnh và hiệu lực):\n\n' + '\n\n'.join(
            f'{p.document_id}, Điều {p.article}, Khoản {p.clause}' +
            (f', Điểm {p.point}' if p.point else '') + f': {p.text}' for p in items)
    else:
        answer = 'Chưa tìm thấy đoạn phù hợp đã được ghi nhận rà soát cho ngày này. Vui lòng kiểm tra với chuyên gia.'
    def digest(value):
        return '0x' + hashlib.sha256(value.encode('utf-8')).hexdigest()
    return {'question_id': req.question_id, 'tier': req.tier, 'answer': answer, 'citations': citations,
            'validation': validation, 'snapshot_id': snapshot.snapshot_id, 'snapshot_sha256': snapshot.snapshot_sha256, 'as_of': as_of.isoformat(),
            'answer_method': 'EXTRACTIVE', 'payment_status': 'DISABLED',
            'hashes': {'question_hash': digest(req.question), 'answer_hash': digest(answer),
                       'citations_hash': digest(json.dumps(citations, ensure_ascii=False)),
                       'validator_hash': digest(json.dumps(validation, ensure_ascii=False)),
                       'corpus_hash': '0x' + snapshot.snapshot_sha256},
            'latency_ms': int((time.monotonic() - start) * 1000)}
