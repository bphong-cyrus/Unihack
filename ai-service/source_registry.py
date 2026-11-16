"""Build an auditable SQLite source inventory; imported sources are not legal review."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3

from source_audit import audit_sources


class RegistryError(ValueError):
    """The source manifest cannot be safely imported."""


def import_source_manifest(manifest_path, database_path):
    manifest_path = Path(manifest_path).resolve()
    database_path = Path(database_path).resolve()
    try:
        raw = manifest_path.read_bytes()
        data = json.loads(raw)
        report = audit_sources(manifest_path)
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise RegistryError('Cannot read or audit source manifest') from error
    if report['errors']:
        raise RegistryError('Source audit failed; the existing registry was not modified')
    database_path.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(raw).hexdigest()
    db = sqlite3.connect(database_path)
    try:
        db.execute('PRAGMA foreign_keys=ON')
        db.executescript('''
        CREATE TABLE IF NOT EXISTS source_documents (
          document_id TEXT PRIMARY KEY, metadata_url TEXT, identity_check TEXT NOT NULL,
          retrieved_at TEXT, review_status TEXT NOT NULL DEFAULT 'UNREVIEWED',
          legal_status TEXT NOT NULL DEFAULT 'UNKNOWN', manifest_sha256 TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS source_artifacts (
          document_id TEXT NOT NULL REFERENCES source_documents(document_id),
          relative_path TEXT NOT NULL, source_url TEXT NOT NULL, sha256 TEXT NOT NULL,
          byte_size INTEGER NOT NULL, signature_verified INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(document_id, relative_path)
        );
        CREATE TABLE IF NOT EXISTS provisions (
          document_id TEXT NOT NULL REFERENCES source_documents(document_id), article TEXT NOT NULL,
          clause TEXT NOT NULL, point TEXT NOT NULL DEFAULT '', raw_text TEXT NOT NULL,
          effective_from TEXT NOT NULL, effective_until TEXT, review_status TEXT NOT NULL DEFAULT 'UNREVIEWED',
          legal_status TEXT NOT NULL DEFAULT 'UNKNOWN', reviewer TEXT, reviewed_at TEXT,
          evidence_url TEXT, source_sha256 TEXT NOT NULL,
          PRIMARY KEY(document_id,article,clause,point,effective_from)
        );
        CREATE TABLE IF NOT EXISTS source_imports (
          manifest_sha256 TEXT PRIMARY KEY, document_count INTEGER NOT NULL,
          attachment_count INTEGER NOT NULL, missing_count INTEGER NOT NULL
        );
        ''')
        with db:
            for document in data['documents']:
                db.execute('''INSERT INTO source_documents(document_id,metadata_url,identity_check,retrieved_at,manifest_sha256)
                    VALUES(?,?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET metadata_url=excluded.metadata_url,
                    identity_check=excluded.identity_check,retrieved_at=excluded.retrieved_at,manifest_sha256=excluded.manifest_sha256''',
                    (document['document_id'], document.get('metadata_url'), document['identity_check'],
                     document.get('retrieved_at_utc'), digest))
                for artifact in document['attachments']:
                    db.execute('''INSERT INTO source_artifacts(document_id,relative_path,source_url,sha256,byte_size,signature_verified)
                        VALUES(?,?,?,?,?,?) ON CONFLICT(document_id,relative_path) DO UPDATE SET
                        source_url=excluded.source_url,sha256=excluded.sha256,byte_size=excluded.byte_size,
                        signature_verified=excluded.signature_verified''',
                        (document['document_id'], artifact['file'], artifact['url'], artifact['sha256'],
                         artifact['bytes'], int(artifact.get('signature_verified') is True)))
            db.execute('INSERT OR IGNORE INTO source_imports VALUES(?,?,?,?)',
                       (digest, report['documents'], report['files_ok'], len(report['documents_without_attachments'])))
    except (sqlite3.Error, KeyError, TypeError) as error:
        raise RegistryError('Database import failed') from error
    finally:
        db.close()
    return {'documents': report['documents'], 'attachments': report['files_ok'],
            'missing_documents': len(report['documents_without_attachments']), 'manifest_sha256': digest}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest')
    parser.add_argument('database')
    args = parser.parse_args()
    try:
        print(json.dumps(import_source_manifest(args.manifest, args.database), ensure_ascii=False))
    except RegistryError as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
