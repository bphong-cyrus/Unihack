import sys
import tempfile
import unittest
import sqlite3
from pathlib import Path
from unittest.mock import patch
from starlette.requests import Request
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from payment_recovery import PaymentJournal, PaymentConflict, recover_pending
from x402 import X402ConfigurationError, load_recovery_config, FacilitatorStatusClient
import main


class FakeEscrow:
    def __init__(self):
        self.registrations = 0
        self.refunds = 0

    def register(self, payload):
        self.registrations += 1
        return {'status': 'LOCKED', 'tx_hash': '0x' + 'b' * 64}

    def resolve(self, payload):
        self.refunds += 1
        assert payload['passed'] is False
        return {'status': 'AUTO-REFUNDED', 'tx_hash': '0x' + 'c' * 64}


class PaymentRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'payments.sqlite3'
        self.journal = PaymentJournal(self.path)
        self.payment = {
            'query_id': '0x' + '1' * 64, 'question_hash': '0x' + '2' * 64,
            'tier': 'quick', 'amount': '50000', 'payer': '0x' + '3' * 40,
            'payment_tx_hash': '0x' + 'a' * 64, 'passed': False,
            'validator_score': 0, 'answer_hash': '',
        }

    def test_crash_after_payment_recovers_registration_then_full_refund(self):
        self.journal.record_pending(self.payment)
        restarted = PaymentJournal(self.path)
        escrow = FakeEscrow()
        report = recover_pending(restarted, escrow)
        self.assertEqual(report['refunded'], 1)
        self.assertEqual(restarted.get(self.payment['payment_tx_hash'])['status'], 'REFUNDED')
        self.assertEqual((escrow.registrations, escrow.refunds), (1, 1))
        recover_pending(restarted, escrow)
        self.assertEqual((escrow.registrations, escrow.refunds), (1, 1))

    def test_duplicate_tx_hash_is_idempotent_but_conflicting_metadata_is_rejected(self):
        self.journal.record_pending(self.payment)
        self.journal.record_pending(self.payment)
        with self.assertRaises(PaymentConflict):
            self.journal.record_pending(dict(self.payment, payer='0x' + '4' * 40))

    def test_failed_registration_stays_pending_for_retry(self):
        self.journal.record_pending(self.payment)
        escrow = FakeEscrow()
        escrow.register = lambda payload: {'status': 'PENDING'}
        report = recover_pending(self.journal, escrow)
        self.assertEqual(report['pending'], 1)
        self.assertEqual(self.journal.get(self.payment['payment_tx_hash'])['status'], 'PENDING_ESCROW')
        self.assertEqual(escrow.refunds, 0)

    def test_claim_prevents_concurrent_recovery(self):
        self.journal.record_pending(self.payment)
        self.assertTrue(self.journal.claim(self.payment['payment_tx_hash'], 'worker-1', 120))
        self.assertFalse(self.journal.claim(self.payment['payment_tx_hash'], 'worker-2', 120))
        self.assertEqual(recover_pending(self.journal, FakeEscrow())['claimed'], 0)

    def test_expired_crashed_worker_lease_is_recovered_after_restart(self):
        self.assertTrue(self.journal.record_pending(self.payment, 'crashed-worker', 300))
        self.assertEqual(recover_pending(PaymentJournal(self.path), FakeEscrow())['claimed'], 0)
        with self.journal._connect() as db:
            db.execute('UPDATE payments SET lease_until=0 WHERE tx_hash=?', (self.payment['payment_tx_hash'],))
        restarted = PaymentJournal(self.path)
        self.assertEqual(recover_pending(restarted, FakeEscrow())['refunded'], 1)

    def test_uncertain_refund_is_polled_without_rebroadcast(self):
        self.journal.record_pending(self.payment)
        self.assertTrue(self.journal.claim(self.payment['payment_tx_hash'], 'owner'))
        self.journal.transition(self.payment['payment_tx_hash'], 'owner', 'PENDING_ESCROW', 'ESCROW_RECORDED')
        self.journal.transition(self.payment['payment_tx_hash'], 'owner', 'ESCROW_RECORDED', 'REFUND_IN_FLIGHT')
        self.journal.release(self.payment['payment_tx_hash'], 'owner')
        escrow = FakeEscrow()
        escrow.status = lambda payload: {'status': 'LOCKED'}
        self.assertEqual(recover_pending(self.journal, escrow)['pending'], 1)
        self.assertEqual(escrow.refunds, 0)
        escrow.status = lambda payload: {'status': 'AUTO-REFUNDED'}
        self.assertEqual(recover_pending(self.journal, escrow)['refunded'], 1)
        self.assertEqual(escrow.refunds, 0)

    def test_recovery_endpoint_authenticates_and_recovers_pending_payment(self):
        self.journal.record_pending(self.payment)
        good = Request({'type': 'http', 'headers': [(b'x-askpay-recovery-token', b'test-token')]})
        bad = Request({'type': 'http', 'headers': []})
        with patch.dict('os.environ', {'ASKPAY_RECOVERY_TOKEN': 'test-token'}), \
             patch('main.payment_journal', return_value=self.journal), \
             patch('main.load_recovery_config', return_value=object()), \
             patch('main.EscrowSettlementClient', return_value=FakeEscrow()):
            with self.assertRaises(HTTPException) as error:
                main.legal_recover_endpoint(bad)
            self.assertEqual(error.exception.status_code, 401)
            self.assertEqual(main.legal_recover_endpoint(good)['refunded'], 1)

    def test_recovery_configuration_does_not_require_new_payment_facilitator(self):
        config = load_recovery_config({'ASKPAY_X402_ENABLED': 'false',
            'ASKPAY_ESCROW_SETTLEMENT_URL': 'https://oracle.example/internal',
            'ASKPAY_SETTLEMENT_TOKEN': 'test-token'})
        self.assertEqual(config.settlement_url, 'https://oracle.example/internal')
        local = load_recovery_config({'ASKPAY_ESCROW_SETTLEMENT_URL': 'http://127.0.0.1:3000/internal',
                                      'ASKPAY_SETTLEMENT_TOKEN': 'test-token'})
        self.assertEqual(local.settlement_url, 'http://127.0.0.1:3000/internal')
        with self.assertRaises(X402ConfigurationError):
            load_recovery_config({'ASKPAY_ESCROW_SETTLEMENT_URL': 'http://127.0.0.1.attacker.example/internal',
                                  'ASKPAY_SETTLEMENT_TOKEN': 'test-token'})

    def test_initiated_not_found_and_mismatched_status_remain_pending(self):
        intent = {**self.payment, 'nonce': '0x' + '5' * 64, 'network': 'eip155:43113',
                  'asset': '0x' + '6' * 40, 'pay_to': '0x' + '7' * 40, 'valid_before': '2000000000'}
        intent.pop('payment_tx_hash')
        self.journal.record_initiated(intent)
        class Lookup:
            def lookup(self, value):
                return {**value, 'payer': '0x' + '8' * 40, 'status': 'CONFIRMED', 'tx_hash': '0x' + 'a' * 64}
        escrow = FakeEscrow()
        recover_pending(self.journal, escrow, Lookup(), intent_timeout_seconds=0)
        self.assertEqual(self.journal.get_intent(intent['query_id'])['status'], 'PAYMENT_INITIATED')
        self.assertEqual(escrow.registrations, 0)
        class WrongNonce:
            def lookup(self, value):
                return {**value, 'nonce': '0x' + '9' * 64, 'status': 'CONFIRMED', 'tx_hash': '0x' + 'a' * 64}
        recover_pending(self.journal, escrow, WrongNonce(), intent_timeout_seconds=0)
        self.assertEqual(self.journal.get_intent(intent['query_id'])['status'], 'PAYMENT_INITIATED')
        self.assertEqual(escrow.registrations, 0)
        class NotFound:
            def lookup(self, value):
                return {**value, 'status': 'NOT_FOUND'}
        recover_pending(self.journal, escrow, NotFound(), intent_timeout_seconds=0)
        self.assertEqual(self.journal.get_intent(intent['query_id'])['status'], 'PAYMENT_INITIATED')

    def test_duplicate_query_id_with_different_payment_is_rejected(self):
        intent = {**self.payment, 'nonce': '0x' + '5' * 64, 'network': 'eip155:43113',
                  'asset': '0x' + '6' * 40, 'pay_to': '0x' + '7' * 40, 'valid_before': '2000000000'}
        intent.pop('payment_tx_hash')
        self.assertTrue(self.journal.record_initiated(intent, 'first'))
        self.assertFalse(self.journal.record_initiated(intent, 'second'))
        with self.assertRaises(PaymentConflict):
            self.journal.record_initiated(dict(intent, amount='200000'), 'other')

    def test_not_found_is_final_only_after_expiry_and_authoritative_negative(self):
        intent = {**self.payment, 'nonce': '0x' + '5' * 64, 'network': 'eip155:43113',
                  'asset': '0x' + '6' * 40, 'pay_to': '0x' + '7' * 40, 'valid_before': '1'}
        intent.pop('payment_tx_hash')
        self.journal.record_initiated(intent)
        class FinalNotFound:
            def lookup(self, value):
                return {**value, 'status': 'NOT_FOUND', 'definitive': True}
        report = recover_pending(self.journal, FakeEscrow(), FinalNotFound(), intent_timeout_seconds=0)
        self.assertEqual(report['intents_failed'], 1)
        self.assertEqual(self.journal.get_intent(intent['query_id'])['status'], 'PAYMENT_FAILED')

    def test_status_adapter_sends_only_reference_data_to_configured_endpoint(self):
        calls = []
        config = load_recovery_config({'ASKPAY_ESCROW_SETTLEMENT_URL': 'https://oracle.example/settle',
                                       'ASKPAY_SETTLEMENT_TOKEN': 'token',
                                       'ASKPAY_FACILITATOR_STATUS_URL': 'https://facilitator.example/status'})
        client = FacilitatorStatusClient(config, lambda url, payload, headers, timeout: calls.append((url, payload)) or {'status': 'PENDING'})
        reference = {'query_id': 'query', 'nonce': 'nonce', 'payer': 'payer'}
        self.assertEqual(client.lookup(reference)['status'], 'PENDING')
        self.assertEqual(calls, [('https://facilitator.example/status', reference)])
        self.assertNotIn('signature', calls[0][1])

    def test_existing_database_migrates_without_losing_escrow_records(self):
        old_path = self.path.with_name('old.sqlite3')
        with sqlite3.connect(old_path) as db:
            db.execute('''CREATE TABLE payments (tx_hash TEXT PRIMARY KEY, payload TEXT NOT NULL,
                status TEXT NOT NULL, lease_owner TEXT, lease_until REAL NOT NULL DEFAULT 0,
                settlement_tx_hash TEXT, updated_at REAL NOT NULL)''')
            db.execute('INSERT INTO payments (tx_hash,payload,status,updated_at) VALUES (?,?,?,?)',
                       ('0x' + 'a' * 64, '{}', 'PENDING_ESCROW', 1))
        upgraded = PaymentJournal(old_path)
        self.assertEqual(upgraded.get('0x' + 'a' * 64)['status'], 'PENDING_ESCROW')
        self.assertIsNone(upgraded.get_intent('0x' + '1' * 64))

    def test_confirming_transaction_already_bound_to_other_payment_fails_atomically(self):
        self.journal.record_pending(self.payment)
        intent = {**self.payment, 'query_id': '0x' + '9' * 64, 'nonce': '0x' + '5' * 64,
                  'network': 'eip155:43113', 'asset': '0x' + '6' * 40,
                  'pay_to': '0x' + '7' * 40, 'valid_before': '2000000000'}
        intent.pop('payment_tx_hash')
        self.journal.record_initiated(intent, 'owner')
        with self.assertRaises(PaymentConflict):
            self.journal.confirm_intent(intent['query_id'], 'owner', self.payment['payment_tx_hash'])
        self.assertEqual(self.journal.get_intent(intent['query_id'])['status'], 'PAYMENT_INITIATED')

    def test_existing_legacy_payment_prevents_a_second_intent_for_query(self):
        self.journal.record_pending(self.payment)
        intent = {**self.payment, 'nonce': '0x' + '5' * 64, 'network': 'eip155:43113',
                  'asset': '0x' + '6' * 40, 'pay_to': '0x' + '7' * 40, 'valid_before': '2000000000'}
        intent.pop('payment_tx_hash')
        with self.assertRaises(PaymentConflict):
            self.journal.record_initiated(intent, 'owner')


if __name__ == '__main__':
    unittest.main()
