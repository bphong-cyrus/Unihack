"""Record sourced document-level expiry observations without promoting partial laws."""
import argparse
from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
from urllib.parse import urlparse


class EvidenceError(ValueError):
    pass


def import_observations(database_path, observations_path):
    database, path = Path(database_path).resolve(), Path(observations_path).resolve()
    if not database.is_file():
        raise EvidenceError('Corpus database does not exist')
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(data, list) or not data:
            raise EvidenceError('A nonempty list of observations is required')
        rows = []
        for item in data:
            status, until = item['status'], item.get('effective_until')
            parsed = urlparse(item['source_url'])
            if (status not in {'EXPIRED','PARTIALLY_EXPIRED'} or parsed.scheme != 'https' or
                parsed.hostname not in {'vbpl.vn','vbpl.moj.gov.vn','vanban.chinhphu.vn'} or
                parsed.username or parsed.password or item.get('source_access') != 'indexed_search_cache'):
                raise EvidenceError('Unsupported observation or source')
            if status == 'EXPIRED':
                if not until or date.fromisoformat(until) > date.today():
                    raise EvidenceError('Expired observations require a nonfuture end date')
            elif until is not None:
                raise EvidenceError('Partial expiry must not assign a document-wide end date')
            canonical = json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
            rows.append((hashlib.sha256(canonical.encode()).hexdigest(), item['document_id'], status,
                         until, item['source_url'], item['source_access'], canonical))
        db = sqlite3.connect(database)
        try:
            db.execute('''CREATE TABLE IF NOT EXISTS source_status_observations (
                observation_sha256 TEXT PRIMARY KEY, document_id TEXT NOT NULL, status TEXT NOT NULL,
                effective_until TEXT, source_url TEXT NOT NULL, source_access TEXT NOT NULL,
                observation_json TEXT NOT NULL, recorded_at TEXT NOT NULL)''')
            now = datetime.now(timezone.utc).isoformat()
            with db:
                for row in rows:
                    if not db.execute('SELECT 1 FROM source_documents WHERE document_id=?', (row[1],)).fetchone():
                        raise EvidenceError('Observation does not match a registered document')
                    db.execute('INSERT OR IGNORE INTO source_status_observations VALUES (?,?,?,?,?,?,?,?)', (*row, now))
                    if row[2] == 'EXPIRED':
                        db.execute("UPDATE source_documents SET legal_status='EXPIRED' WHERE document_id=?", (row[1],))
        finally:
            db.close()
    except (OSError, ValueError, TypeError, KeyError, sqlite3.Error) as error:
        if isinstance(error, EvidenceError):
            raise
        raise EvidenceError('Cannot validate or import status observations') from error
    return {'observations': len(rows), 'expired': sum(row[2] == 'EXPIRED' for row in rows),
            'partially_expired': sum(row[2] == 'PARTIALLY_EXPIRED' for row in rows)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database'); parser.add_argument('observations')
    args = parser.parse_args()
    try:
        print(json.dumps(import_observations(args.database, args.observations), ensure_ascii=False))
    except EvidenceError as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
