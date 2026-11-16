"""Load locally reviewed, versioned legal provisions without inferring legal status.

A review is an assertion recorded by the operator, not proof of reviewer identity,
authority, current law, or agreement between extracted text and source bytes.
"""
from dataclasses import dataclass, field
from datetime import date, datetime
from hashlib import sha256
import json
from pathlib import Path
from urllib.parse import urlparse
import unicodedata
from zoneinfo import ZoneInfo
from types import MappingProxyType


class CorpusError(ValueError):
    """The snapshot is incomplete, inconsistent, or fails an integrity check."""


def _required_string(data, key):
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise CorpusError(f'{key} is required')
    return value.strip()


def _https(value):
    parsed = urlparse(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise CorpusError('source and evidence URLs must use HTTPS')
    return value


def _date(value):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError) as error:
        raise CorpusError('invalid ISO date') from error


def _timestamp(value):
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError('timezone required')
        return parsed
    except (TypeError, ValueError) as error:
        raise CorpusError('invalid timestamp or missing timezone') from error


def _doc_id(value):
    return ''.join(value.upper().split())


@dataclass(frozen=True)
class Provision:
    document_id: str
    document_title: str
    article: str
    clause: str
    point: str
    text: str
    effective_from: date
    effective_until: date | None
    reviewed_by: str | None
    reviewed_at: str | None
    status_evidence_url: str | None
    verified_through: date | None
    source_url: str
    source_sha256: str
    status: str = "UNKNOWN"

    @property
    def reviewed(self):
        return bool(self.reviewed_by and self.reviewed_at and self.status_evidence_url)


@dataclass(frozen=True)
class CorpusSnapshot:
    snapshot_id: str
    document_count: int
    provisions: tuple[Provision, ...]
    snapshot_sha256: str
    _index: object = field(init=False, repr=False, compare=False)

    def __post_init__(self):
        index = {}
        for item in self.provisions:
            key = (item.document_id, item.article, item.clause, item.point)
            index.setdefault(key, []).append(item)
        object.__setattr__(self, '_index', MappingProxyType({key: tuple(value) for key, value in index.items()}))

    @property
    def provision_count(self):
        return len(self.provisions)

    @property
    def reviewed_count(self):
        return sum(item.reviewed for item in self.provisions)

    def lookup(self, document_id, article, clause, point, as_of):
        key = (_doc_id(document_id), str(article).strip(), str(clause).strip(), str(point).strip())
        for item in self._index.get(key, ()):
            if (item.status == 'ACTIVE' and item.reviewed and item.verified_through is not None and as_of <= item.verified_through
                    and item.effective_from <= as_of
                    and (item.effective_until is None or as_of < item.effective_until)):
                return item
        return None


def _read_document(document, root):
    document_id = _doc_id(_required_string(document, 'document_id'))
    title = _required_string(document, 'title')
    source_url = _https(_required_string(document, 'source_url'))
    _timestamp(_required_string(document, 'retrieved_at'))
    relative = Path(_required_string(document, 'source_file'))
    if relative.is_absolute() or '..' in relative.parts:
        raise CorpusError('source_file must be within the snapshot directory')
    source_path = (root / relative).resolve()
    if not source_path.is_relative_to(root):
        raise CorpusError('source_file escapes the snapshot directory')
    expected = _required_string(document, 'source_sha256').lower()
    try:
        digest = sha256(source_path.read_bytes()).hexdigest()
    except OSError as error:
        raise CorpusError('source_file cannot be read') from error
    if digest != expected:
        raise CorpusError('source SHA-256 mismatch')
    provisions = document.get('provisions')
    if not isinstance(provisions, list) or not provisions:
        raise CorpusError('document must contain provisions')
    return document_id, title, source_url, digest, provisions


def _read_provision(record, document_id, title, source_url, digest):
    article = _required_string(record, 'article')
    clause = _required_string(record, 'clause')
    point = record.get('point', '')
    if not isinstance(point, str):
        raise CorpusError('point must be a string')
    status = record.get('legal_status', record.get('status', 'UNKNOWN'))
    if status not in {'ACTIVE', 'EXPIRED', 'UNKNOWN'}:
        raise CorpusError('invalid legal status')
    review_status = record.get('review_status', 'UNREVIEWED')
    if review_status not in {'VERIFIED', 'UNREVIEWED'}:
        raise CorpusError('invalid review status')
    start = _date(record.get('effective_from'))
    end = _date(record['effective_until']) if record.get('effective_until') is not None else None
    if end is not None and end <= start:
        raise CorpusError('effective_until must be later than effective_from')
    review = [record.get('reviewed_by'), record.get('reviewed_at'), record.get('status_evidence_url'), record.get('verified_through')]
    if any(value is not None for value in review) and not all(review):
        raise CorpusError('review evidence must be complete')
    if review_status == 'VERIFIED' and not all(review):
        raise CorpusError('VERIFIED requires complete review evidence')
    if review_status == 'UNREVIEWED':
        review = [None] * 4
    if any(value is not None for value in review):
        reviewer = _required_string(record, 'reviewed_by')
        reviewed_at = _required_string(record, 'reviewed_at')
        review_time = _timestamp(reviewed_at)
        verified_through = _date(record.get('verified_through'))
        if verified_through > review_time.astimezone(ZoneInfo('Asia/Ho_Chi_Minh')).date():
            raise CorpusError('verified_through cannot be later than review date')
        evidence = _https(_required_string(record, 'status_evidence_url'))
    else:
        reviewer = reviewed_at = evidence = verified_through = None
    return Provision(document_id, title, article, clause, point.strip(), unicodedata.normalize('NFC', _required_string(record, 'text')),
                     start, end, reviewer, reviewed_at, evidence, verified_through, source_url, digest, status)



def _parse_jsonl(raw, snapshot_id):
    documents = {}
    for number, line in enumerate(raw.decode('utf-8').splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        if not isinstance(row, dict):
            raise CorpusError(f'JSONL line {number} must be an object')
        doc_id = _required_string(row, 'doc_id')
        if _required_string(row, 'review_status') not in {'VERIFIED', 'UNREVIEWED'}:
            raise CorpusError(f'JSONL line {number} has invalid review_status')
        if _required_string(row, 'status') not in {'ACTIVE', 'EXPIRED', 'UNKNOWN'}:
            raise CorpusError(f'JSONL line {number} has invalid status')
        doc = {key: _required_string(row, key) for key in ('source_url', 'source_file', 'source_sha256', 'retrieved_at')}
        doc.update({'document_id': doc_id, 'title': _required_string(row, 'doc_title'), 'provisions': []})
        if doc_id not in documents:
            documents[doc_id] = doc
        elif any(documents[doc_id][key] != doc[key] for key in ('source_url', 'source_file', 'source_sha256', 'retrieved_at', 'title')):
            raise CorpusError(f'JSONL line {number} has inconsistent document metadata')
        record = dict(row)
        record['text'] = _required_string(row, 'raw_text')
        documents[doc_id]['provisions'].append(record)
    return {'snapshot_id': snapshot_id, 'documents': list(documents.values())}

def load_snapshot(manifest_path):
    path = Path(manifest_path).resolve()
    try:
        manifest_bytes = path.read_bytes()
        data = (_parse_jsonl(manifest_bytes, path.stem) if path.suffix.lower() == '.jsonl'
                else json.loads(manifest_bytes.decode('utf-8')))
        if not isinstance(data, dict):
            raise CorpusError('manifest must be an object')
        snapshot_id = _required_string(data, 'snapshot_id')
        documents = data.get('documents')
        if not isinstance(documents, list) or not documents:
            raise CorpusError('documents must be a nonempty list')
        seen = set()
        groups = {}
        items = []
        for document in documents:
            doc_id, title, url, digest, records = _read_document(document, path.parent)
            if doc_id in seen:
                raise CorpusError('duplicate document ID')
            seen.add(doc_id)
            for record in records:
                item = _read_provision(record, doc_id, title, url, digest)
                key = (doc_id, item.article, item.clause, item.point)
                groups.setdefault(key, []).append(item)
                items.append(item)
        for versions in groups.values():
            versions.sort(key=lambda item: item.effective_from)
            for left, right in zip(versions, versions[1:]):
                if left.effective_until is None or left.effective_until > right.effective_from:
                    raise CorpusError('overlapping provision versions')
        return CorpusSnapshot(snapshot_id, len(seen), tuple(items), sha256(manifest_bytes).hexdigest())
    except (OSError, UnicodeError, json.JSONDecodeError, AttributeError, TypeError) as error:
        raise CorpusError('invalid snapshot manifest') from error
