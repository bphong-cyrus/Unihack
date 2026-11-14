"""Validate citation quotations against reviewed versions of a local snapshot."""
from citation_text import compute_excerpt_similarity


def validate_snapshot_citations(citations, snapshot, as_of):
    if not citations:
        return {'passed': False, 'verdict': 'UNVERIFIED_REFUND', 'settlement_eligible': False,
                'corpus_status': 'REVIEW_ASSERTED', 'overall_score': 0.0,
                'citation_checks': [], 'fail_reason': 'NO_CITATION_PROVIDED',
                'snapshot_id': snapshot.snapshot_id, 'as_of': as_of.isoformat()}

    checks = []
    scores = []
    for citation in citations:
        document = ''.join(str(citation.get('document', '')).upper().split())
        article = str(citation.get('article', '')).strip()
        clause = str(citation.get('clause', '')).strip()
        point = str(citation.get('point', '')).strip()
        doc_exists = any(item.document_id == document for item in snapshot.provisions)
        provision_exists = any((item.document_id, item.article, item.clause, item.point)
                               == (document, article, clause, point) for item in snapshot.provisions)
        version = snapshot.lookup(document, article, clause, point, as_of)
        in_force = version is not None
        similarity = compute_excerpt_similarity(str(citation.get('excerpt', '')), version.text) if version else 0.0
        reason = (None if doc_exists else 'DOCUMENT_NOT_IN_CORPUS')
        if reason is None and not provision_exists:
            reason = 'ARTICLE_OR_CLAUSE_NOT_FOUND'
        if reason is None and not in_force:
            reason = 'NO_REVIEWED_VERSION_FOR_DATE'
        if reason is None and similarity < 0.90:
            reason = 'EXCERPT_MISMATCH_BELOW_90_PERCENT'
        scores.append(25 * doc_exists + 25 * provision_exists + 20 * in_force + 30 * similarity)
        checks.append({
            'document': document, 'article': article, 'clause': clause, 'point': point,
            'doc_exists': doc_exists, 'article_clause_exists': provision_exists,
            'is_in_force': in_force, 'excerpt_similarity': similarity,
            'threshold_required': 0.90, 'raw_text': version.text if version else '',
            'source_url': version.source_url if version else None,
            'source_sha256': version.source_sha256 if version else None,
            'status': 'FAIL' if reason else 'PASS', 'fail_reason': reason,
        })
    passed = all(check['status'] == 'PASS' for check in checks)
    return {'passed': passed, 'verdict': 'VERIFIED_RELEASE' if passed else 'UNVERIFIED_REFUND',
            'settlement_eligible': False, 'corpus_status': 'REVIEW_ASSERTED',
            'overall_score': round(sum(scores) / len(scores), 2), 'citation_checks': checks,
            'snapshot_id': snapshot.snapshot_id, 'as_of': as_of.isoformat()}
