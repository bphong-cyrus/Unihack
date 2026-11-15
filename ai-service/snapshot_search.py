"""Lexical BM25 ranking over date-eligible provisions; this is not LegalQA."""
from collections import Counter
from math import log
from citation_text import normalize_vn_text

_STOPWORDS = frozenset('của và là được các có cho trong với theo khi một những thì nào gì như tôi doanh nghiệp hàng hóa luật quy định về tại từ bị để hay phải không xin hỏi cần biết thời gian'.split())


def retrieve(snapshot, question, as_of, limit):
    terms = {word for word in normalize_vn_text(question).split() if len(word) > 1 and word not in _STOPWORDS}
    if len(terms) < 2 or limit <= 0:
        return []
    documents = []
    for item in snapshot.provisions:
        if snapshot.lookup(item.document_id, item.article, item.clause, item.point, as_of) is not item:
            continue
        tokens = normalize_vn_text(item.text + ' ' + item.document_title).split()
        documents.append((item, Counter(tokens), len(tokens)))
    if not documents:
        return []
    average_length = sum(length for _, _, length in documents) / len(documents)
    if not average_length:
        return []
    frequencies = {term: sum(term in tokens for _, tokens, _ in documents) for term in terms}
    candidates = []
    for item, tokens, length in documents:
        if sum(term in tokens for term in terms) < 2:
            continue
        score = 0.0
        for term in sorted(terms):
            frequency = tokens.get(term, 0)
            if frequency:
                idf = log(1 + (len(documents) - frequencies[term] + 0.5) / (frequencies[term] + 0.5))
                score += idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * length / average_length))
        candidates.append((score, item))
    candidates.sort(key=lambda pair: (-pair[0], pair[1].document_id, pair[1].article, pair[1].clause, pair[1].point))
    return [item for _, item in candidates[:limit]]
