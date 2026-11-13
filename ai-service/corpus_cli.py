"""Inspect a local corpus snapshot without publishing it or changing review state."""
import argparse
import json
import sys
from legal_corpus import CorpusError, load_snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['check'])
    parser.add_argument('manifest')
    args = parser.parse_args()
    try:
        snapshot = load_snapshot(args.manifest)
    except CorpusError as error:
        print(f'Invalid snapshot: {error}', file=sys.stderr)
        return 1
    print(json.dumps({
        'snapshot_id': snapshot.snapshot_id,
        'documents': snapshot.document_count,
        'provisions': snapshot.provision_count,
        'reviewed_provisions': snapshot.reviewed_count,
        'unreviewed_provisions': snapshot.provision_count - snapshot.reviewed_count,
    }, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
