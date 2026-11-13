"""Conservative lexical retrieval of reviewed provisions; this is not LegalQA."""
from citation_text import normalize_vn_text

_STOPWORDS = frozenset('của và là được các có cho trong với theo khi một những thì nào gì như tôi doanh nghiệp hàng hóa luật quy định về tại từ bị để hay phải không xin hỏi cần biết thời gian'.split())


def retrieve(snapshot, question, as_of, limit):
    terms = {word for word in normalize_vn_text(question).split() if len(word) > 1 and word not in _STOPWORDS}
    if len(terms) < 2:
        return []
    candidates = []
    for item in snapshot.provisions:
        current = snapshot.lookup(item.document_id, item.article, item.clause, item.point, as_of)
        if current is not item:
            continue
        tokens = set(normalize_vn_text(item.text + ' ' + item.document_title).split())
        overlap = len(terms & tokens)
        if overlap >= 2:
            candidates.append((overlap, item))
    candidates.sort(key=lambda pair: (-pair[0], pair[1].document_id, pair[1].article, pair[1].clause, pair[1].point))
    return [item for _, item in candidates[:limit]]
