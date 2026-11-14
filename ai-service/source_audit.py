"""Check downloaded source files against their manifest; does not verify legal status."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse


_OFFICIAL_DOMAINS = ('chinhphu.vn', 'vbpl.vn', 'moj.gov.vn', 'moit.gov.vn')


def _is_official_https_url(value):
    if not isinstance(value, str):
        return False
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    host = (parsed.hostname or '').lower().rstrip('.')
    return (parsed.scheme == 'https' and host and not parsed.username and not parsed.password
            and any(host == domain or host.endswith('.' + domain) for domain in _OFFICIAL_DOMAINS))


def audit_sources(manifest):
    path = Path(manifest).resolve()
    data = json.loads(path.read_text(encoding='utf-8'))
    documents = data['documents']
    if not isinstance(documents, list) or not documents:
        raise ValueError('documents must be a nonempty list')
    seen = set()
    report = {'documents': len(data['documents']), 'files_ok': 0,
              'documents_without_attachments': [], 'errors': []}
    for document in documents:
        document_id = document['document_id']
        if not isinstance(document_id, str) or not document_id.strip() or document_id in seen:
            raise ValueError('document IDs must be nonempty and unique')
        seen.add(document_id)
        if not isinstance(document['attachments'], list):
            raise ValueError('attachments must be a list')
        if not document['attachments']:
            report['documents_without_attachments'].append(document['document_id'])
        else:
            if not _is_official_https_url(document.get('metadata_url')):
                report['errors'].append({'document_id': document_id, 'reason': 'NON_OFFICIAL_METADATA_URL'})
            if document.get('identity_check') != 'matched_metadata':
                report['errors'].append({'document_id': document_id, 'reason': 'METADATA_IDENTITY_UNVERIFIED'})
        for attachment in document['attachments']:
            name = attachment['file']
            if not _is_official_https_url(attachment.get('url')):
                report['errors'].append({'document_id': document_id, 'file': name,
                                         'reason': 'NON_OFFICIAL_ATTACHMENT_URL'})
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
