"""Inspect a local corpus snapshot without publishing it or changing review state."""
import argparse
import json
import sys
from legal_corpus import CorpusError, load_snapshot
from corpus_database import DatabaseError, import_reviewed_snapshot, load_database_snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['check', 'import-db', 'check-db'])
    parser.add_argument('manifest')
    parser.add_argument('value', nargs='?')
    args = parser.parse_args()
    if args.command == 'import-db':
        if not args.value:
            parser.error('import-db requires manifest and database paths')
        try:
            print(json.dumps(import_reviewed_snapshot(args.value, args.manifest), ensure_ascii=False))
            return 0
        except DatabaseError as error:
            print(f'Invalid database import: {error}', file=sys.stderr)
            return 1
    try:
        if args.command == 'check-db':
            if not args.value:
                parser.error('check-db requires database path and snapshot ID')
            snapshot = load_database_snapshot(args.manifest, args.value)
        else:
            snapshot = load_snapshot(args.manifest)
    except (CorpusError, DatabaseError) as error:
        print(f'Invalid snapshot: {error}', file=sys.stderr)
        return 1
    print(json.dumps({
        'snapshot_id': snapshot.snapshot_id,
        'snapshot_sha256': snapshot.snapshot_sha256,
        'documents': snapshot.document_count,
        'provisions': snapshot.provision_count,
        'reviewed_provisions': snapshot.reviewed_count,
        'unreviewed_provisions': snapshot.provision_count - snapshot.reviewed_count,
    }, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
