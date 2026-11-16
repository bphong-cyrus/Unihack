"""Stage OCR article candidates with immutable page/line provenance, not legal validation."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import unicodedata

ARTICLE = re.compile(r'^\s*Điều\s+(\d+[a-zA-Z]?)\s*[.:]', re.IGNORECASE)


class CandidateError(ValueError):
    pass


def ingest_candidates(ocr_root, database_path):
    root, db_path = Path(ocr_root).resolve(), Path(database_path).resolve()
    if not root.is_dir() or not db_path.is_file():
        raise CandidateError('OCR directory and existing database are required')
    paths = sorted(root.glob('ocr-*/page-*.json'))
    if not paths:
        raise CandidateError('No OCR pages found')
    db = sqlite3.connect(db_path)
    try:
        attestations = set(db.execute("SELECT relative_path,page_sha256,document_id,source_sha256 FROM ocr_review_attestations WHERE review_status='VERIFIED'"))
        groups, source_hashes, page_count = {}, {}, 0
        for path in paths:
            raw = path.read_bytes()
            page = json.loads(raw)
            relative = path.relative_to(root).as_posix()
            sha = hashlib.sha256(raw).hexdigest()
            if (relative, sha, page['document_id'], page['source_sha256']) not in attestations:
                raise CandidateError(f'OCR page lacks matching user attestation: {relative}')
            source = (path.parent / page['source_file']).resolve()
            if not source.is_relative_to(root.parent):
                raise CandidateError('OCR source escapes research directory')
            if source not in source_hashes:
                source_hashes[source] = hashlib.sha256(source.read_bytes()).hexdigest()
            if source_hashes[source] != page['source_sha256']:
                raise CandidateError('OCR source bytes changed')
            group = groups.setdefault(path.parent.name, [])
            group.append((int(page['page']), int(page['page_count']), page, relative, sha))
            page_count += 1
        rows = []
        for batch, pages in sorted(groups.items()):
            pages.sort(key=lambda row: row[0])
            if [p[0] for p in pages] != list(range(1, len(pages)+1)) or any(p[1] != len(pages) for p in pages):
                raise CandidateError(f'Incomplete OCR pages: {batch}')
            if len({(p[2]['document_id'],p[2]['source_sha256']) for p in pages}) != 1:
                raise CandidateError('OCR batch contains multiple sources')
            current = None
            ordinal = 0
            for _, _, page, relative, sha in pages:
                for index, line in enumerate(page['lines']):
                    text = unicodedata.normalize('NFC', str(line['text']).strip())
                    match = ARTICLE.match(text)
                    if match:
                        if current:
                            rows.append(current)
                        ordinal += 1
                        current = [batch, ordinal, page['document_id'], page['source_sha256'], match.group(1), [], []]
                    if current and text:
                        current[5].append(text)
                        current[6].append({'page': relative, 'page_sha256': sha, 'line_index': index})
            if current:
                rows.append(current)
        duplicates = sum(n for n in Counter((r[0],r[4]) for r in rows).values() if n > 1)
        db.execute('''CREATE TABLE IF NOT EXISTS ocr_article_candidates (
          batch TEXT NOT NULL, ordinal INTEGER NOT NULL, document_id TEXT NOT NULL, source_sha256 TEXT NOT NULL,
          article TEXT NOT NULL, text TEXT NOT NULL, source_lines TEXT NOT NULL,
          structure_status TEXT NOT NULL, legal_status TEXT NOT NULL, PRIMARY KEY(batch, ordinal))''')
        with db:
            if db.execute("SELECT 1 FROM ocr_article_candidates WHERE structure_status != 'UNREVIEWED' OR legal_status != 'UNKNOWN' LIMIT 1").fetchone():
                raise CandidateError('Cannot replace candidates with existing review decisions')
            db.execute('DELETE FROM ocr_article_candidates')
            db.executemany('INSERT INTO ocr_article_candidates VALUES(?,?,?,?,?,?,?,?,?)', [
                (*row[:5], '\n'.join(row[5]), json.dumps(row[6], ensure_ascii=False, separators=(',', ':')),
                 'UNREVIEWED', 'UNKNOWN') for row in rows])
    except (OSError, ValueError, TypeError, KeyError, sqlite3.Error) as error:
        if isinstance(error, CandidateError):
            raise
        raise CandidateError('Could not validate or import OCR candidates') from error
    finally:
        db.close()
    return {'pages': page_count, 'batches': len(groups), 'candidates': len(rows), 'duplicate_article_candidates': duplicates,
            'structure_status': 'UNREVIEWED', 'legal_status': 'UNKNOWN'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ocr_root'); parser.add_argument('database')
    args = parser.parse_args()
    try:
        print(json.dumps(ingest_candidates(args.ocr_root, args.database), ensure_ascii=False))
    except CandidateError as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
