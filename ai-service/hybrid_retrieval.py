"""Vietnamese legal tokens and rank fusion for snapshot retrieval."""
from citation_text import normalize_vn_text


def tokenize(text):
    words = normalize_vn_text(text).split()
    return words + [f'{left}__{right}' for left, right in zip(words, words[1:])]


def reciprocal_rank_fusion(rankings, weights, k=60):
    scores = {}
    for ranking, weight in zip(rankings, weights):
        seen = set()
        for rank, item in enumerate(ranking, 1):
            if item not in seen:
                scores[item] = scores.get(item, 0.0) + weight / (k + rank)
                seen.add(item)
    return sorted(scores, key=lambda item: (-scores[item], item))
