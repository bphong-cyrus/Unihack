"""Durable transaction journal and serialized escrow recovery."""
import json
import os
from pathlib import Path
import sqlite3
import time
import uuid
import re
from contextlib import contextmanager


class PaymentConflict(ValueError):
    """A transaction hash was reused with different payment details."""


class PaymentJournal:
    def __init__(self, path):
        self.path = Path(path).expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('''CREATE TABLE IF NOT EXISTS payments (
                tx_hash TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL,
                lease_owner TEXT, lease_until REAL NOT NULL DEFAULT 0,
                settlement_tx_hash TEXT, updated_at REAL NOT NULL
            )''')
            db.execute('''CREATE TABLE IF NOT EXISTS payment_intents (
                query_id TEXT PRIMARY KEY, payer_address TEXT NOT NULL, amount TEXT NOT NULL,
                nonce TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, status TEXT NOT NULL,
                created_at REAL NOT NULL, updated_at REAL NOT NULL, tx_hash TEXT UNIQUE,
                lease_owner TEXT, lease_until REAL NOT NULL DEFAULT 0
            )''')
        os.chmod(self.path, 0o600)

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA synchronous=FULL')
        try:
            with db:
                yield db
        finally:
            db.close()

    def record_pending(self, payload, owner=None, seconds=300):
        tx_hash = payload['payment_tx_hash'].lower()
        immutable = {key: payload[key] for key in ('query_id', 'question_hash', 'tier', 'amount', 'payer', 'payment_tx_hash')}
        immutable['payment_tx_hash'] = tx_hash
        immutable['payer'] = immutable['payer'].lower()
        encoded = json.dumps(immutable, sort_keys=True, separators=(',', ':'))
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            old = db.execute('SELECT payload FROM payments WHERE tx_hash = ?', (tx_hash,)).fetchone()
            if old and old['payload'] != encoded:
                raise PaymentConflict('payment transaction already has different metadata')
            if not old:
                db.execute('INSERT INTO payments (tx_hash,payload,status,updated_at) VALUES (?,?,?,?)',
                           (tx_hash, encoded, 'PENDING_ESCROW', time.time()))
            if owner:
                now = time.time()
                cursor = db.execute("""UPDATE payments SET lease_owner=?, lease_until=?, updated_at=?
                    WHERE tx_hash=? AND status='PENDING_ESCROW' AND (lease_owner IS NULL OR lease_until < ?)""",
                    (owner, now + seconds, now, tx_hash, now))
                return cursor.rowcount == 1
            return True

    def record_initiated(self, payload, owner=None, seconds=300):
        keys = ('query_id', 'question_hash', 'tier', 'amount', 'payer', 'nonce', 'network', 'asset', 'pay_to', 'valid_before')
        immutable = {key: str(payload[key]) for key in keys}
        for key in ('query_id', 'question_hash', 'payer', 'nonce', 'asset', 'pay_to'):
            immutable[key] = immutable[key].lower()
        encoded = json.dumps(immutable, sort_keys=True, separators=(',', ':'))
        now = time.time()
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            old = db.execute('SELECT payload FROM payment_intents WHERE query_id=?', (immutable['query_id'],)).fetchone()
            if old:
                if old['payload'] != encoded:
                    raise PaymentConflict('query ID already belongs to a different payment')
                return False
            for previous in db.execute('SELECT payload FROM payments'):
                try:
                    previous_query = json.loads(previous['payload']).get('query_id', '')
                except (json.JSONDecodeError, AttributeError) as error:
                    raise PaymentConflict('existing payment metadata is invalid') from error
                if str(previous_query).lower() == immutable['query_id']:
                    raise PaymentConflict('query ID already has a recorded payment')
            try:
                db.execute('''INSERT INTO payment_intents
                    (query_id,payer_address,amount,nonce,payload,status,created_at,updated_at,lease_owner,lease_until)
                    VALUES (?,?,?,?,?,?,?,?,?,?)''',
                    (immutable['query_id'], immutable['payer'], immutable['amount'], immutable['nonce'], encoded,
                     'PAYMENT_INITIATED', now, now, owner, now + seconds if owner else 0))
            except sqlite3.IntegrityError as error:
                raise PaymentConflict('payment nonce already belongs to another intent') from error
            return True

    def get_intent(self, query_id):
        with self._connect() as db:
            row = db.execute('SELECT * FROM payment_intents WHERE query_id=?', (query_id.lower(),)).fetchone()
            return dict(row) if row else None

    def initiated_ids(self, timeout_seconds):
        with self._connect() as db:
            return [row[0] for row in db.execute("SELECT query_id FROM payment_intents WHERE status='PAYMENT_INITIATED' AND created_at<=? ORDER BY created_at", (time.time() - timeout_seconds,))]

    def claim_intent(self, query_id, owner, seconds=300):
        now = time.time()
        with self._connect() as db:
            cursor = db.execute("""UPDATE payment_intents SET lease_owner=?, lease_until=?, updated_at=?
                WHERE query_id=? AND status='PAYMENT_INITIATED' AND (lease_owner IS NULL OR lease_until < ?)""",
                (owner, now + seconds, now, query_id.lower(), now))
            return cursor.rowcount == 1

    def release_intent(self, query_id, owner):
        with self._connect() as db:
            db.execute('UPDATE payment_intents SET lease_owner=NULL, lease_until=0 WHERE query_id=? AND lease_owner=?', (query_id.lower(), owner))

    def fail_intent(self, query_id, owner):
        with self._connect() as db:
            result = db.execute("UPDATE payment_intents SET status='PAYMENT_FAILED', updated_at=? WHERE query_id=? AND status='PAYMENT_INITIATED' AND lease_owner=?", (time.time(), query_id.lower(), owner))
            if result.rowcount != 1:
                raise PaymentConflict('intent state or lease has changed')

    def remember_intent_tx(self, query_id, owner, tx_hash):
        if not re.fullmatch(r'0x[0-9a-fA-F]{64}', str(tx_hash)):
            raise ValueError('invalid transaction hash')
        with self._connect() as db:
            try:
                result = db.execute("UPDATE payment_intents SET tx_hash=?, updated_at=? WHERE query_id=? AND status='PAYMENT_INITIATED' AND lease_owner=? AND (tx_hash IS NULL OR tx_hash=?)",
                                    (tx_hash.lower(), time.time(), query_id.lower(), owner, tx_hash.lower()))
            except sqlite3.IntegrityError as error:
                raise PaymentConflict('transaction already belongs to another intent') from error
            if result.rowcount != 1:
                raise PaymentConflict('intent state, transaction, or lease has changed')

    def confirm_intent(self, query_id, owner, tx_hash, transfer_lease=True):
        if not re.fullmatch(r'0x[0-9a-fA-F]{64}', str(tx_hash)):
            raise ValueError('invalid transaction hash')
        tx_hash = tx_hash.lower()
        now = time.time()
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute("SELECT * FROM payment_intents WHERE query_id=? AND status='PAYMENT_INITIATED' AND lease_owner=?", (query_id.lower(), owner)).fetchone()
            if not row:
                raise PaymentConflict('intent state or lease has changed')
            if row['tx_hash'] and row['tx_hash'] != tx_hash:
                raise PaymentConflict('confirmed transaction conflicts with pending transaction')
            intent = json.loads(row['payload'])
            immutable = {key: intent[key] for key in ('query_id', 'question_hash', 'tier', 'amount', 'payer')}
            immutable['payment_tx_hash'] = tx_hash
            encoded = json.dumps(immutable, sort_keys=True, separators=(',', ':'))
            previous = db.execute('SELECT payload FROM payments WHERE tx_hash=?', (tx_hash,)).fetchone()
            if previous and previous['payload'] != encoded:
                raise PaymentConflict('transaction already belongs to another payment')
            if not previous:
                db.execute('''INSERT INTO payments (tx_hash,payload,status,lease_owner,lease_until,updated_at)
                    VALUES (?,?,?,?,?,?)''', (tx_hash, encoded, 'PENDING_ESCROW', owner if transfer_lease else None,
                                              row['lease_until'] if transfer_lease else 0, now))
            try:
                db.execute("UPDATE payment_intents SET status='PENDING_ESCROW', tx_hash=?, updated_at=?, lease_owner=NULL, lease_until=0 WHERE query_id=?", (tx_hash, now, query_id.lower()))
            except sqlite3.IntegrityError as error:
                raise PaymentConflict('transaction already belongs to another intent') from error

    def get(self, tx_hash):
        with self._connect() as db:
            row = db.execute('SELECT * FROM payments WHERE tx_hash = ?', (tx_hash.lower(),)).fetchone()
            return dict(row) if row else None

    def pending_hashes(self):
        with self._connect() as db:
            return [row[0] for row in db.execute(
                "SELECT tx_hash FROM payments WHERE status IN ('PENDING_ESCROW','ESCROW_RECORDED','RESOLUTION_IN_FLIGHT','REFUND_IN_FLIGHT') ORDER BY updated_at")]

    def claim(self, tx_hash, owner, seconds=300):
        now = time.time()
        with self._connect() as db:
            cursor = db.execute("""UPDATE payments SET lease_owner=?, lease_until=?, updated_at=?
                WHERE tx_hash=? AND status IN ('PENDING_ESCROW','ESCROW_RECORDED','RESOLUTION_IN_FLIGHT','REFUND_IN_FLIGHT')
                AND (lease_owner IS NULL OR lease_until < ?)""",
                (owner, now + seconds, now, tx_hash.lower(), now))
            return cursor.rowcount == 1

    def transition(self, tx_hash, owner, expected, status, settlement_tx_hash=None):
        allowed = {'PENDING_ESCROW': {'ESCROW_RECORDED', 'RELEASED', 'REFUNDED'},
                   'ESCROW_RECORDED': {'RESOLUTION_IN_FLIGHT', 'REFUND_IN_FLIGHT', 'RELEASED', 'REFUNDED'},
                   'RESOLUTION_IN_FLIGHT': {'RELEASED', 'REFUNDED'},
                   'REFUND_IN_FLIGHT': {'RELEASED', 'REFUNDED'}}
        if status not in allowed.get(expected, set()):
            raise ValueError('invalid payment state transition')
        with self._connect() as db:
            cursor = db.execute('''UPDATE payments SET status=?, settlement_tx_hash=?, updated_at=?
                WHERE tx_hash=? AND status=? AND lease_owner=?''',
                (status, settlement_tx_hash, time.time(), tx_hash.lower(), expected, owner))
            if cursor.rowcount != 1:
                raise PaymentConflict('payment state or lease has changed')
            db.execute('UPDATE payment_intents SET status=?, updated_at=? WHERE tx_hash=?', (status, time.time(), tx_hash.lower()))

    def release(self, tx_hash, owner):
        with self._connect() as db:
            db.execute('UPDATE payments SET lease_owner=NULL, lease_until=0 WHERE tx_hash=? AND lease_owner=?',
                       (tx_hash.lower(), owner))



def get_public_payment_status(journal, query_id, payer):
    if not re.fullmatch(r'0x[0-9a-fA-F]{64}', query_id or '') or not re.fullmatch(r'0x[0-9a-fA-F]{40}', payer or ''):
        return None
    with journal._connect() as db:
        row = db.execute("""SELECT i.query_id, i.status, i.tx_hash, p.settlement_tx_hash
                            FROM payment_intents i LEFT JOIN payments p ON p.tx_hash=i.tx_hash
                            WHERE i.query_id=? AND i.payer_address=?""", (query_id.lower(), payer.lower())).fetchone()
        if row is None:
            return None
        return {'question_id': row['query_id'], 'status': row['status'], 'payment_tx_hash': row['tx_hash'],
                'settlement_tx_hash': row['settlement_tx_hash'] if row['status'] in {'RELEASED', 'REFUNDED'} else None}

def recover_pending(journal, escrow, facilitator=None, intent_timeout_seconds=120):
    report = {'claimed': 0, 'refunded': 0, 'released': 0, 'pending': 0, 'intents_confirmed': 0, 'intents_failed': 0, 'intents_pending': 0}
    for query_id in journal.initiated_ids(intent_timeout_seconds):
        owner = uuid.uuid4().hex
        if not journal.claim_intent(query_id, owner):
            continue
        try:
            row = journal.get_intent(query_id)
            intent = json.loads(row['payload'])
            result = facilitator.lookup({**intent, 'known_tx_hash': row['tx_hash'] or ''}) if facilitator else None
            matching = isinstance(result, dict) and all(
                str(result.get(key, '')).lower() == str(intent[key]).lower()
                for key in ('query_id', 'payer', 'nonce', 'network', 'asset', 'pay_to', 'amount'))
            if matching and result.get('status') == 'CONFIRMED':
                journal.confirm_intent(query_id, owner, result.get('tx_hash'), transfer_lease=False)
                report['intents_confirmed'] += 1
            elif (matching and result.get('status') in {'FAILED', 'NOT_FOUND'}
                  and int(intent['valid_before']) < time.time()
                  and result.get('definitive') is True
                  and not result.get('tx_hash') and not row['tx_hash']):
                journal.fail_intent(query_id, owner)
                report['intents_failed'] += 1
            else:
                report['intents_pending'] += 1
        except Exception:
            report['intents_pending'] += 1
        finally:
            journal.release_intent(query_id, owner)
    for tx_hash in journal.pending_hashes():
        owner = uuid.uuid4().hex
        if not journal.claim(tx_hash, owner):
            continue
        report['claimed'] += 1
        try:
            row = journal.get(tx_hash)
            payload = {**json.loads(row['payload']), 'passed': False, 'validator_score': 0, 'answer_hash': ''}
            if row['status'] in {'RESOLUTION_IN_FLIGHT', 'REFUND_IN_FLIGHT'}:
                result = escrow.status(payload)
                state = result.get('status') if isinstance(result, dict) else None
                if state in {'RELEASED', 'AUTO-REFUNDED'}:
                    final = 'RELEASED' if state == 'RELEASED' else 'REFUNDED'
                    journal.transition(tx_hash, owner, row['status'], final, result.get('tx_hash') or None)
                    report[final.lower()] += 1
                else:
                    report['pending'] += 1
                continue
            if row['status'] == 'PENDING_ESCROW':
                result = escrow.register(payload)
                state = result.get('status') if isinstance(result, dict) else None
                if state in {'RELEASED', 'AUTO-REFUNDED'}:
                    final = 'RELEASED' if state == 'RELEASED' else 'REFUNDED'
                    journal.transition(tx_hash, owner, 'PENDING_ESCROW', final, result.get('tx_hash') or None)
                    report[final.lower()] += 1
                    continue
                if state != 'LOCKED':
                    report['pending'] += 1
                    continue
                journal.transition(tx_hash, owner, 'PENDING_ESCROW', 'ESCROW_RECORDED', result.get('tx_hash') or None)
            journal.transition(tx_hash, owner, 'ESCROW_RECORDED', 'REFUND_IN_FLIGHT')
            result = escrow.resolve(payload)
            state = result.get('status') if isinstance(result, dict) else None
            if state in {'RELEASED', 'AUTO-REFUNDED'}:
                final = 'RELEASED' if state == 'RELEASED' else 'REFUNDED'
                journal.transition(tx_hash, owner, 'REFUND_IN_FLIGHT', final, result.get('tx_hash') or None)
                report[final.lower()] += 1
            else:
                report['pending'] += 1
        except Exception:
            report['pending'] += 1
        finally:
            journal.release(tx_hash, owner)
    return report
