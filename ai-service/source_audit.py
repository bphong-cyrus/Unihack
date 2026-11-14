"""Check downloaded source files against their manifest; does not verify legal status."""
import argparse
import hashlib
import json
from pathlib import Path


def audit_sources(manifest):
    path = Path(manifest).resolve()
    data = json.loads(path.read_text(encoding='utf-8'))
    report = {'documents': len(data['documents']), 'files_ok': 0,
              'documents_without_attachments': [], 'errors': []}
    for document in data['documents']:
        if not document['attachments']:
            report['documents_without_attachments'].append(document['document_id'])
        for attachment in document['attachments']:
            name = attachment['file']
            source = (path.parent / name).resolve()
            if not source.is_relative_to(path.parent):
                report['errors'].append({'file': name, 'reason': 'PATH_OUTSIDE_ROOT'})
                continue
            try:
                digest = hashlib.sha256()
                size = 0
                with source.open('rb') as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        size += len(chunk)
                        digest.update(chunk)
            except OSError:
                report['errors'].append({'file': name, 'reason': 'UNREADABLE'})
                continue
            if size != attachment['bytes'] or digest.hexdigest() != attachment['sha256']:
                report['errors'].append({'file': name, 'reason': 'SIZE_OR_HASH_MISMATCH'})
            else:
                report['files_ok'] += 1
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest')
    args = parser.parse_args()
    try:
        report = audit_sources(args.manifest)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(2, f'Invalid source manifest: {error}\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report['errors'] or report['documents_without_attachments']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
