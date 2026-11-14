"""Make unreviewed clause candidates while retaining paragraph provenance."""
from collections import Counter
import re

_CLAUSE = re.compile(r'^\s*(\d+)\.\s+')


def make_review_queue(document):
    candidates = []
    for article in document['articles']:
        paragraphs = article['paragraphs']
        if len(paragraphs) < 2:
            continue
        starts = [(i, m.group(1)) for i, text in enumerate(paragraphs[1:], 1)
                  if (m := _CLAUSE.match(text))]
        segments = []
        if not starts:
            segments.append(('0', 1, len(paragraphs)))
        else:
            if starts[0][0] > 1:
                segments.append(('preamble', 1, starts[0][0]))
            for index, (start, number) in enumerate(starts):
                end = starts[index + 1][0] if index + 1 < len(starts) else len(paragraphs)
                segments.append((number, start, end))
        for label, start, end in segments:
            candidates.append({'article': article['article'], 'clause': label,
                               'paragraphs': paragraphs[start:end],
                               'source_paragraph_indexes': list(range(start, end)),
                               'review_status': 'UNREVIEWED'})
    counts = Counter(f"{item['article']}:{item['clause']}" for item in candidates)
    return {'document_id': document['document_id'], 'docx_sha256': document['docx_sha256'],
            'archive_sha256': document['archive_sha256'], 'review_status': 'UNREVIEWED',
            'candidates': candidates, 'duplicate_labels': sorted(k for k, n in counts.items() if n > 1),
            'limitations': 'Heuristic boundaries; tables, subpoints and amendments require manual review.'}
