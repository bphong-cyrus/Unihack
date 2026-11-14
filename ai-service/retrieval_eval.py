"""Evaluate lexical retrieval against explicitly labeled question/provision pairs."""
import argparse
from datetime import date
import json
from pathlib import Path
from legal_corpus import CorpusError, load_snapshot
from snapshot_search import retrieve


class EvaluationError(ValueError):
    """The evaluation set is malformed."""


def _key(label):
    try:
        fields = [str(label[name]).strip() for name in ('document', 'article', 'clause')]
        if not all(fields):
            raise ValueError('empty label')
        return (''.join(fields[0].upper().split()), fields[1], fields[2], str(label.get('point', '')).strip())
    except (KeyError, TypeError, ValueError) as error:
        raise EvaluationError('invalid relevant provision') from error


def evaluate(snapshot, cases, k):
    if not isinstance(cases, list) or not cases or not isinstance(k, int) or k < 1:
        raise EvaluationError('expected nonempty cases and positive k')
    seen = set()
    rows = []
    for case in cases:
        try:
            case_id = case['id'].strip()
            question = case['question'].strip()
            as_of = date.fromisoformat(case['as_of'])
            labels = case['relevant']
            if not case_id or case_id in seen or not question or not isinstance(labels, list) or not labels:
                raise EvaluationError('invalid case or duplicate id')
            relevant = {_key(label) for label in labels}
            if len(relevant) != len(labels):
                raise EvaluationError('duplicate relevant provision')
        except (KeyError, AttributeError, TypeError, ValueError) as error:
            raise EvaluationError('invalid evaluation case') from error
        seen.add(case_id)
        items = retrieve(snapshot, question, as_of, k)
        found = [(item.document_id, item.article, item.clause, item.point) for item in items]
        matches = [index for index, key in enumerate(found, 1) if key in relevant]
        rows.append({'id': case_id, 'retrieved': [list(key) for key in found],
                     'recall': len(set(found) & relevant) / len(relevant),
                     'reciprocal_rank': 1 / matches[0] if matches else 0.0})
    return {'snapshot_id': snapshot.snapshot_id, 'k': k, 'case_count': len(rows),
            'recall_at_k': sum(row['recall'] for row in rows) / len(rows),
            'mrr_at_k': sum(row['reciprocal_rank'] for row in rows) / len(rows), 'cases': rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest')
    parser.add_argument('cases')
    parser.add_argument('--k', type=int, default=3)
    args = parser.parse_args()
    try:
        snapshot = load_snapshot(args.manifest)
        cases = json.loads(Path(args.cases).read_text(encoding='utf-8'))
        result = evaluate(snapshot, cases, args.k)
    except (OSError, json.JSONDecodeError, CorpusError, EvaluationError) as error:
        parser.exit(1, f'{error}\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
