"""Index possible article headings from a complete, unreviewed OCR batch."""
import argparse
import hashlib
import json
import re
import unicodedata
from pathlib import Path

HEADING = re.compile(r'^\s*dieu\s+(\d+)(?:,(?!\s*\d)|[.:_]|\s*$)\s*', re.IGNORECASE)


def find_headings(directory):
    root = Path(directory).resolve()
    files = sorted(root.glob('page-*.json'))
    if not files:
        raise ValueError('no OCR records')
    records = [json.loads(path.read_text(encoding='utf-8')) for path in files]
    first = records[0]
    source = (root / first['source_file']).resolve()
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    total = first['page_count']
    if len(records) != total or digest != first['source_sha256']:
        raise ValueError('incomplete pages or source mismatch')
    candidates = []
    for page, (path, record) in enumerate(zip(files, records), 1):
        if (path.name != f'page-{page:03}.json' or record['page'] != page or record['page_count'] != total
                or record['source_sha256'] != digest or record['document_id'] != first['document_id']
                or (root / record['source_file']).resolve() != source or record['review_status'] != 'UNREVIEWED'):
            raise ValueError('inconsistent OCR records')
        for index, line in enumerate(record['lines']):
            normalized = ''.join(char for char in unicodedata.normalize('NFD', line['text'].lower().replace('đ', 'd'))
                                 if not unicodedata.combining(char))
            match = HEADING.match(normalized)
            if match:
                candidates.append({'article': match.group(1), 'page': page, 'line_index': index,
                                   'text': line['text'], 'confidence': line['confidence'],
                                   'record_file': path.name})
    return {'document_id': first['document_id'], 'source_sha256': digest, 'page_count': total,
            'review_status': 'UNREVIEWED', 'candidates': candidates,
            'limitations': 'Heuristic headings may be missing or refer to amendments; verify against original pages.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    try:
        result = find_headings(args.directory)
        with Path(args.out).open('x', encoding='utf-8') as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
