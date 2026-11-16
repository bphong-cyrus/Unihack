"""Persist reviewed snapshot provisions without promoting unreviewed source text."""
from dataclasses import asdict, replace
from datetime import date
import json
import os
from pathlib import Path
import sqlite3

from legal_corpus import CorpusError, CorpusSnapshot, Provision, load_snapshot


class DatabaseError(ValueError):
    """A corpus database or its reviewed snapshot cannot be trusted."""


def _serialized(provision):
    values = asdict(provision)
    for key in ('effective_from', 'effective_until', 'verified_through'):
        values[key] = values[key].isoformat() if values[key] else None
    return json.dumps(values, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def _snapshot_rows(path):
    try:
        snapshot = load_snapshot(path)
        manifest = json.loads(Path(path).read_text(encoding='utf-8'))
        rows = []
        for document in manifest['documents']:
            doc_id = ''.join(document['document_id'].upper().split())
            for record in document['provisions']:
                review = record.get('review_status')
                legal = record.get('legal_status')
                if review not in {'VERIFIED', 'UNREVIEWED'} or legal not in {'ACTIVE', 'EXPIRED', 'UNKNOWN'}:
                    raise DatabaseError('Every provision needs explicit review_status and legal_status')
                match = next((item for item in snapshot.provisions if item.document_id == doc_id
                    and item.article == str(record['article']).strip() and item.clause == str(record['clause']).strip()
                    and item.point == str(record.get('point', '')).strip()
                    and item.effective_from.isoformat() == record['effective_from']), None)
                if match is None or (review == 'VERIFIED' and (not match.reviewed or not match.verified_through)):
                    raise DatabaseError('Verified provision is missing provenance or review evidence')
                rows.append((match, review, legal))
        return snapshot, rows
    except (CorpusError, OSError, ValueError, KeyError, TypeError) as error:
        if isinstance(error, DatabaseError):
            raise
        raise DatabaseError('Snapshot or source artifacts failed validation') from error


def import_reviewed_snapshot(database_path, manifest_path):
    db_path = Path(database_path).resolve()
    manifest_path = Path(manifest_path).resolve()
    if not db_path.is_file():
        raise DatabaseError('Import the official source registry before importing provisions')
    snapshot, rows = _snapshot_rows(manifest_path)
    db = sqlite3.connect(db_path)
    try:
        db.execute('PRAGMA foreign_keys=ON')
        db.executescript('''
          CREATE TABLE IF NOT EXISTS corpus_snapshots (
            snapshot_id TEXT PRIMARY KEY, snapshot_sha256 TEXT NOT NULL, manifest_path TEXT NOT NULL,
            document_count INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS corpus_snapshot_provisions (
            snapshot_id TEXT NOT NULL REFERENCES corpus_snapshots(snapshot_id), document_id TEXT NOT NULL,
            article TEXT NOT NULL, clause TEXT NOT NULL, point TEXT NOT NULL, effective_from TEXT NOT NULL,
            review_status TEXT NOT NULL, legal_status TEXT NOT NULL, provision_json TEXT NOT NULL,
            PRIMARY KEY(snapshot_id, document_id, article, clause, point, effective_from)
          );
          CREATE INDEX IF NOT EXISTS corpus_provision_lookup ON corpus_snapshot_provisions(snapshot_id, document_id, article, clause);
        ''')
        with db:
            existing = db.execute('SELECT snapshot_sha256 FROM corpus_snapshots WHERE snapshot_id=?', (snapshot.snapshot_id,)).fetchone()
            if existing and existing[0] != snapshot.snapshot_sha256:
                raise DatabaseError('Snapshot ID already belongs to different source bytes')
            for item, _, _ in rows:
                source = db.execute('SELECT 1 FROM source_artifacts WHERE document_id=? AND sha256=?',
                                    (item.document_id, item.source_sha256)).fetchone()
                if not source:
                    raise DatabaseError(f'Source artifact is not in the audited registry: {item.document_id}')
            if not existing:
                db.execute('INSERT INTO corpus_snapshots VALUES(?,?,?,?)',
                           (snapshot.snapshot_id, snapshot.snapshot_sha256,
                            os.path.relpath(manifest_path, db_path.parent), snapshot.document_count))
                db.executemany('INSERT INTO corpus_snapshot_provisions VALUES(?,?,?,?,?,?,?,?,?)', [
                    (snapshot.snapshot_id, item.document_id, item.article, item.clause, item.point,
                     item.effective_from.isoformat(), review, legal, _serialized(item)) for item, review, legal in rows])
    except sqlite3.Error as error:
        raise DatabaseError('Corpus database import failed') from error
    finally:
        db.close()
    return {'snapshot_id': snapshot.snapshot_id, 'snapshot_sha256': snapshot.snapshot_sha256,
            'provisions': len(rows), 'reviewed_provisions': sum(review == 'VERIFIED' for _, review, _ in rows)}


def load_database_snapshot(database_path, snapshot_id):
    path = Path(database_path).resolve()
    if not path.is_file():
        raise DatabaseError('Corpus database does not exist')
    try:
        db = sqlite3.connect(f'{path.as_uri()}?mode=ro', uri=True)
        db.row_factory = sqlite3.Row
        try:
            metadata = db.execute('SELECT * FROM corpus_snapshots WHERE snapshot_id=?', (snapshot_id,)).fetchone()
            if metadata is None:
                raise DatabaseError('Reviewed snapshot is not present in the database')
            stored = db.execute('SELECT * FROM corpus_snapshot_provisions WHERE snapshot_id=? ORDER BY document_id,article,clause,point,effective_from', (snapshot_id,)).fetchall()
            for row in stored:
                value = json.loads(row['provision_json'])
                if not db.execute('SELECT 1 FROM source_artifacts WHERE document_id=? AND sha256=?',
                                  (row['document_id'], value['source_sha256'])).fetchone():
                    raise DatabaseError('A reviewed provision no longer matches an audited source artifact')
        finally:
            db.close()
        original, expected = _snapshot_rows((path.parent / metadata['manifest_path']).resolve())
        if original.snapshot_id != snapshot_id or original.snapshot_sha256 != metadata['snapshot_sha256']:
            raise DatabaseError('Source snapshot manifest changed after import')
        expected_rows = sorted((item.document_id, item.article, item.clause, item.point, item.effective_from.isoformat(),
                                review, legal, _serialized(item)) for item, review, legal in expected)
        actual_rows = [(row['document_id'], row['article'], row['clause'], row['point'], row['effective_from'],
                        row['review_status'], row['legal_status'], row['provision_json']) for row in stored]
        if actual_rows != expected_rows or metadata['document_count'] != original.document_count:
            raise DatabaseError('Database provisions differ from the reviewed snapshot')
        provisions = []
        for row in stored:
            value = json.loads(row['provision_json'])
            for key in ('effective_from', 'effective_until', 'verified_through'):
                value[key] = date.fromisoformat(value[key]) if value[key] else None
            item = Provision(**value)
            if row['review_status'] != 'VERIFIED' or row['legal_status'] != 'ACTIVE':
                item = replace(item, reviewed_by=None, reviewed_at=None, status_evidence_url=None, verified_through=None)
            provisions.append(item)
        return CorpusSnapshot(snapshot_id, metadata['document_count'], tuple(provisions), metadata['snapshot_sha256'])
    except (sqlite3.Error, OSError, ValueError, TypeError, KeyError) as error:
        if isinstance(error, DatabaseError):
            raise
        raise DatabaseError('Cannot read the reviewed corpus database') from error
