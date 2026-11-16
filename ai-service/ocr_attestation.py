"""Record the user's OCR review assertion against exact page and source hashes."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3


class AttestationError(ValueError):
    """OCR page provenance or coverage does not match the audited sources."""


def attest_user_review(ocr_root, database_path, statement):
    root = Path(ocr_root).resolve()
    db_path = Path(database_path).resolve()
    if not root.is_dir() or not db_path.is_file() or not isinstance(statement, str) or not statement.strip():
        raise AttestationError('OCR root, existing registry, and user statement are required')
    paths = sorted(root.glob('ocr-*/page-*.json'))
    if not paths:
        raise AttestationError('No OCR pages found')
    db = sqlite3.connect(db_path)
    try:
        audited = set(db.execute('SELECT document_id,sha256 FROM source_artifacts'))
        rows = []
        sources = {}
        groups = {}
        for page_path in paths:
            raw = page_path.read_bytes()
            page = json.loads(raw.decode('utf-8'))
            source = (page_path.parent / page['source_file']).resolve()
            if not source.is_relative_to(root.parent):
                raise AttestationError('OCR source path escapes research directory')
            if source not in sources:
                sources[source] = hashlib.sha256(source.read_bytes()).hexdigest()
            source_sha = page['source_sha256']
            document_id = page['document_id']
            if sources[source] != source_sha or (document_id, source_sha) not in audited:
                raise AttestationError(f'OCR source differs from audited registry: {page_path}')
            number, total = int(page['page']), int(page['page_count'])
            if number < 1 or total < number or not isinstance(page['lines'], list):
                raise AttestationError(f'Invalid OCR page: {page_path}')
            group = groups.setdefault(page_path.parent, {'source': source_sha, 'total': total, 'pages': set()})
            if group['source'] != source_sha or group['total'] != total or number in group['pages']:
                raise AttestationError(f'Inconsistent or duplicate OCR page: {page_path}')
            group['pages'].add(number)
            rows.append((str(page_path.relative_to(root)), hashlib.sha256(raw).hexdigest(), document_id,
                         source_sha, number, total, str(page['engine'])))
        if any(group['pages'] != set(range(1, group['total'] + 1)) for group in groups.values()):
            raise AttestationError('At least one OCR batch has incomplete page coverage')
        now = datetime.now(timezone.utc).isoformat()
        db.execute('''CREATE TABLE IF NOT EXISTS ocr_review_attestations (
          relative_path TEXT NOT NULL, page_sha256 TEXT NOT NULL, document_id TEXT NOT NULL,
          source_sha256 TEXT NOT NULL, page_number INTEGER NOT NULL, page_count INTEGER NOT NULL,
          engine TEXT NOT NULL, review_status TEXT NOT NULL, reviewer TEXT NOT NULL,
          reviewed_at TEXT NOT NULL, statement TEXT NOT NULL,
          PRIMARY KEY(relative_path, page_sha256)
        )''')
        with db:
            db.executemany('''INSERT OR IGNORE INTO ocr_review_attestations
              (relative_path,page_sha256,document_id,source_sha256,page_number,page_count,engine,review_status,reviewer,reviewed_at,statement)
              VALUES(?,?,?,?,?,?,?,'VERIFIED','user',?,?)''', [(*row, now, statement.strip()) for row in rows])
    except (OSError, KeyError, TypeError, ValueError, sqlite3.Error) as error:
        if isinstance(error, AttestationError):
            raise
        raise AttestationError('Could not validate or record OCR review') from error
    finally:
        db.close()
    return {'batches': len(groups), 'pages': len(rows), 'documents': len({row[2] for row in rows}),
            'reviewer': 'user', 'review_status': 'VERIFIED', 'reviewed_at': now}


def is_attested(database_path, relative_path, page_sha256):
    with sqlite3.connect(f'{Path(database_path).resolve().as_uri()}?mode=ro', uri=True) as db:
        return db.execute("SELECT 1 FROM ocr_review_attestations WHERE relative_path=? AND page_sha256=? AND review_status='VERIFIED'", (relative_path, page_sha256)).fetchone() is not None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ocr_root')
    parser.add_argument('database')
    parser.add_argument('--statement', required=True, help='Exact user assertion authorizing this review decision')
    args = parser.parse_args()
    try:
        print(json.dumps(attest_user_review(args.ocr_root, args.database, args.statement), ensure_ascii=False))
    except AttestationError as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
