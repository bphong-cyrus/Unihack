import base64
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from x402 import (
    FujiPaymentConfig,
    X402PaymentError,
    build_payment_challenge,
    parse_payment_signature,
    process_paid_ask,
    load_payment_config,
)
from payment_recovery import PaymentJournal, recover_pending


class FakeFacilitator:
    def __init__(self, valid=True, tx_hash='0x' + 'a' * 64):
        self.valid = valid
        self.tx_hash = tx_hash
        self.verify_calls = []
        self.settle_calls = []

    def verify(self, payload, requirements):
        self.verify_calls.append((payload, requirements))
        return {'isValid': self.valid, 'payer': payload['payload']['authorization']['from']}

    def settle(self, payload, requirements):
        self.settle_calls.append((payload, requirements))
        return {'success': True, 'payer': payload['payload']['authorization']['from'],
                'transaction': self.tx_hash, 'network': 'eip155:43113'}


class FakeEscrow:
    def __init__(self, status='RELEASED'):
        self.status = status
        self.registered = False

    def register(self, payload):
        self.registered = True
        return {'status': 'LOCKED', 'tx_hash': '0x' + 'd' * 64}

    def resolve(self, payload):
        return {'status': self.status, 'tx_hash': '0x' + 'b' * 64}


class X402Tests(unittest.TestCase):
    def setUp(self):
        tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(tempdir.cleanup)
        self.db_path = Path(tempdir.name) / 'payments.sqlite3'
        env = patch.dict('os.environ', {'ASKPAY_PAYMENT_DB': str(self.db_path)})
        env.start()
        self.addCleanup(env.stop)
        self.config = FujiPaymentConfig(
            facilitator_url='https://facilitator.example',
            escrow_address='0x' + '1' * 40,
            usdc_address='0x5425890298aed601595a70AB815c96711a31Bc65',
            settlement_url='https://askpay.example/api/internal/escrow/settle',
            settlement_token='internal-test-token',
        )
        self.request = {
            'question_id': '0x' + '2' * 64,
            'question': 'Hồ sơ hải quan cần những chứng từ nào?',
            'tier': 'quick',
        }
        self.challenge = build_payment_challenge(
            self.config, self.request, 'https://api.example.test/api/v1/legal/ask',
        )
        self.resource_url = 'https://api.example.test/api/v1/legal/ask'
        self.requirements = self.challenge['accepts'][0]
        self.signature = self.payment_signature(self.requirements)

    @staticmethod
    def payment_signature(requirements):
        payload = {
            'x402Version': 2,
            'resource': {'url': 'https://api.example.test/api/v1/legal/ask', 'mimeType': 'application/json'},
            'accepted': requirements,
            'payload': {
                'signature': '0x' + 'f' * 130,
                'authorization': {
                    'from': '0x' + '3' * 40,
                    'to': requirements['payTo'],
                    'value': requirements['amount'],
                    'validAfter': '0',
                    'validBefore': '9999999999',
                    'nonce': requirements['extra']['askpayPaymentNonce'],
                },
            },
        }
        return base64.b64encode(json.dumps(payload).encode()).decode()

    def test_challenge_uses_x402_v2_and_fuji_usdc_atomic_tier_prices(self):
        quick = self.challenge['accepts'][0]
        deep = build_payment_challenge(self.config, dict(self.request, tier='deep'), 'https://api.example.test/api/v1/legal/ask')['accepts'][0]
        self.assertEqual(self.challenge['x402Version'], 2)
        self.assertEqual((quick['network'], quick['amount'], quick['asset']),
                         ('eip155:43113', '50000', self.config.usdc_address))
        self.assertEqual(deep['amount'], '200000')
        self.assertEqual(quick['scheme'], 'exact')
        self.assertEqual(quick['payTo'], self.config.escrow_address)

    def test_standard_environment_aliases_configure_fuji_payment(self):
        config = load_payment_config({
            'ASKPAY_X402_ENABLED': 'true',
            'X402_FACILITATOR_URL': 'https://facilitator.example',
            'ESCROW_CONTRACT_ADDRESS': self.config.escrow_address,
            'ASKPAY_ESCROW_SETTLEMENT_URL': 'http://127.0.0.1:3000/internal',
            'ASKPAY_SETTLEMENT_TOKEN': 'test-token',
        })
        self.assertEqual(config.escrow_address, self.config.escrow_address)
        self.assertEqual(config.facilitator_url, 'https://facilitator.example')

    def test_payment_header_must_match_tier_question_and_escrow_recipient(self):
        parsed = parse_payment_signature(self.signature, self.requirements)
        self.assertEqual(parsed['payload']['authorization']['to'], self.config.escrow_address)
        wrong = json.loads(base64.b64decode(self.signature))
        wrong['accepted']['amount'] = '200000'
        with self.assertRaises(X402PaymentError):
            parse_payment_signature(base64.b64encode(json.dumps(wrong).encode()).decode(), self.requirements)

    def test_signature_nonce_is_bound_to_question_and_tier(self):
        changed = json.loads(base64.b64decode(self.signature))
        changed['payload']['authorization']['nonce'] = '0x' + '4' * 64
        with self.assertRaises(X402PaymentError):
            parse_payment_signature(base64.b64encode(json.dumps(changed).encode()).decode(), self.requirements)
        other = build_payment_challenge(self.config, dict(self.request, question='Một câu hỏi khác'), self.resource_url)
        self.assertNotEqual(other['accepts'][0]['extra']['askpayPaymentNonce'], self.requirements['extra']['askpayPaymentNonce'])
        historical = build_payment_challenge(self.config, dict(self.request, as_of='2024-01-01'), self.resource_url)
        self.assertNotEqual(historical['accepts'][0]['extra']['askpayPaymentNonce'], self.requirements['extra']['askpayPaymentNonce'])

    def test_facilitator_cannot_confirm_payment_on_another_network(self):
        facilitator = FakeFacilitator()
        facilitator.settle = lambda payload, requirements: {
            'success': True, 'payer': payload['payload']['authorization']['from'],
            'transaction': '0x' + 'a' * 64, 'network': 'eip155:1',
        }
        calls = []
        result = process_paid_ask(self.signature, self.challenge, self.requirements, self.request,
                                  self.resource_url, lambda: calls.append('answer'), facilitator, FakeEscrow())
        self.assertNotEqual(result['status'], 200)
        self.assertEqual(calls, [])

    def test_unpaid_request_returns_402_without_running_answer_or_chain(self):
        calls = []
        result = process_paid_ask(
            '', self.challenge, self.requirements, self.request, self.resource_url,
            lambda: calls.append('answer'), FakeFacilitator(), lambda data: calls.append('escrow'),
        )
        self.assertEqual(result['status'], 402)
        self.assertIn('PAYMENT-REQUIRED', result['headers'])
        self.assertEqual(calls, [])

    def test_passed_answer_is_released_after_facilitator_settlement(self):
        facilitator = FakeFacilitator()
        escrow = FakeEscrow()
        original_register = escrow.register
        def assert_journaled(payload):
            journal = PaymentJournal(self.db_path)
            self.assertEqual(journal.get(payload['payment_tx_hash'])['status'], 'PENDING_ESCROW')
            return original_register(payload)
        escrow.register = assert_journaled
        result = process_paid_ask(
            self.signature, self.challenge, self.requirements, self.request, self.resource_url,
            lambda: {'question_id': self.request['question_id'], 'validation': {'passed': True, 'settlement_eligible': True, 'overall_score': 100},
                     'citations': [{'doc_id': '54/2014/QH13'}], 'answer': 'ok'},
            facilitator, escrow,
        )
        self.assertEqual(result['status'], 200)
        self.assertEqual(result['body']['onchain']['status'], 'RELEASED')
        self.assertEqual(result['body']['onchain']['payment_tx_hash'], facilitator.tx_hash)
        self.assertIn('PAYMENT-RESPONSE', result['headers'])
        self.assertEqual(PaymentJournal(self.db_path).get(facilitator.tx_hash)['status'], 'RELEASED')

    def test_passed_but_ineligible_answer_never_releases_payment(self):
        result = process_paid_ask(self.signature, self.challenge, self.requirements, self.request, self.resource_url,
            lambda: {'validation': {'passed': True, 'settlement_eligible': False, 'overall_score': 100},
                     'citations': [{'doc_id': 'A'}], 'answer': 'unverified'},
            FakeFacilitator(), FakeEscrow('AUTO-REFUNDED'))
        self.assertEqual(result['body']['onchain']['status'], 'AUTO-REFUNDED')

    def test_failed_validator_refunds_and_invalid_payment_never_runs_answer(self):
        facilitator = FakeFacilitator()
        refunded = process_paid_ask(
            self.signature, self.challenge, self.requirements, self.request, self.resource_url,
            lambda: {'question_id': self.request['question_id'], 'validation': {'passed': False, 'overall_score': 50},
                     'citations': [{'doc_id': '127/2013/NĐ-CP'}], 'answer': 'unverified'},
            facilitator, FakeEscrow('AUTO-REFUNDED'),
        )
        self.assertEqual(refunded['body']['onchain']['status'], 'AUTO-REFUNDED')
        rejected = process_paid_ask(
            self.signature, self.challenge, self.requirements, self.request, self.resource_url,
            lambda: self.fail('answer must not run for invalid payment'),
            FakeFacilitator(valid=False), lambda payload: self.fail('escrow must not run for invalid payment'),
        )
        self.assertEqual(rejected['status'], 402)

    def test_payment_is_locked_before_answer_and_model_failure_refunds(self):
        escrow = FakeEscrow('AUTO-REFUNDED')
        def fail_answer():
            self.assertTrue(escrow.registered)
            raise RuntimeError('model unavailable')
        result = process_paid_ask(self.signature, self.challenge, self.requirements, self.request,
                                  self.resource_url, fail_answer, FakeFacilitator(), escrow)
        self.assertEqual(result['body']['onchain']['status'], 'AUTO-REFUNDED')
        self.assertFalse(result['body']['validation']['passed'])

    def test_crash_after_usdc_transfer_before_register_is_recovered(self):
        escrow = FakeEscrow()
        escrow.register = lambda payload: (_ for _ in ()).throw(SystemExit('simulated crash'))
        with self.assertRaises(SystemExit):
            process_paid_ask(self.signature, self.challenge, self.requirements, self.request,
                             self.resource_url, lambda: self.fail('must not run'), FakeFacilitator(), escrow)
        journal = PaymentJournal(self.db_path)
        self.assertEqual(journal.get('0x' + 'a' * 64)['status'], 'PENDING_ESCROW')
        recovered = FakeEscrow('AUTO-REFUNDED')
        report = recover_pending(journal, recovered)
        self.assertEqual(report['refunded'], 1)
        self.assertEqual(journal.get('0x' + 'a' * 64)['status'], 'REFUNDED')

    def test_database_write_failure_returns_tx_hash_and_never_registers_escrow(self):
        class BrokenJournal:
            def record_initiated(self, payload, owner):
                return True
            def confirm_intent(self, query_id, owner, tx_hash):
                raise OSError('disk error')
            def release_intent(self, query_id, owner):
                pass
        escrow = FakeEscrow()
        result = process_paid_ask(self.signature, self.challenge, self.requirements, self.request,
                                  self.resource_url, lambda: self.fail('must not run'), FakeFacilitator(),
                                  escrow, BrokenJournal())
        self.assertEqual(result['status'], 202)
        self.assertEqual(result['body']['payment_status'], 'JOURNAL_WRITE_FAILED')
        self.assertEqual(result['body']['payment_tx_hash'], '0x' + 'a' * 64)
        self.assertFalse(escrow.registered)

    def test_crash_after_facilitator_confirmation_before_tx_commit_recovers(self):
        journal = PaymentJournal(self.db_path)
        facilitator = FakeFacilitator()
        def crash_before_commit(*args, **kwargs):
            self.assertEqual(journal.get_intent(self.request['question_id'])['status'], 'PAYMENT_INITIATED')
            raise SystemExit('simulated power loss before tx commit')
        journal.confirm_intent = crash_before_commit
        with self.assertRaises(SystemExit):
            process_paid_ask(self.signature, self.challenge, self.requirements, self.request,
                             self.resource_url, lambda: self.fail('must not run'), facilitator, FakeEscrow(), journal)
        restarted = PaymentJournal(self.db_path)
        with restarted._connect() as db:
            db.execute('UPDATE payment_intents SET lease_until=0')
        class Lookup:
            def lookup(self, intent):
                return {**intent, 'status': 'CONFIRMED', 'tx_hash': facilitator.tx_hash}
        escrow = FakeEscrow('AUTO-REFUNDED')
        report = recover_pending(restarted, escrow, Lookup(), intent_timeout_seconds=0)
        self.assertEqual(report['refunded'], 1)
        self.assertEqual(restarted.get(facilitator.tx_hash)['status'], 'REFUNDED')
        self.assertEqual(restarted.get_intent(self.request['question_id'])['status'], 'REFUNDED')
        self.assertEqual(len(facilitator.settle_calls), 1)

    def test_intent_exists_before_settle_and_duplicate_is_never_resubmitted(self):
        journal = PaymentJournal(self.db_path)
        facilitator = FakeFacilitator()
        def pending(payload, requirements):
            self.assertEqual(journal.get_intent(self.request['question_id'])['status'], 'PAYMENT_INITIATED')
            facilitator.settle_calls.append(payload)
            return {'success': False, 'transaction': facilitator.tx_hash, 'errorReason': 'settlement_pending'}
        facilitator.settle = pending
        for _ in range(2):
            result = process_paid_ask(self.signature, self.challenge, self.requirements, self.request,
                                      self.resource_url, lambda: self.fail('must not run'), facilitator, FakeEscrow(), journal)
            self.assertEqual(result['status'], 202)
        self.assertEqual(len(facilitator.settle_calls), 1)
        self.assertEqual(journal.get_intent(self.request['question_id'])['tx_hash'], facilitator.tx_hash)

    def test_definitive_facilitator_failure_marks_intent_failed(self):
        journal = PaymentJournal(self.db_path)
        facilitator = FakeFacilitator()
        facilitator.settle = lambda payload, requirements: {'success': False, 'errorReason': 'invalid_exact_evm_payload_signature'}
        result = process_paid_ask(self.signature, self.challenge, self.requirements, self.request,
                                  self.resource_url, lambda: self.fail('must not run'), facilitator, FakeEscrow(), journal)
        self.assertEqual(result['status'], 402)
        self.assertEqual(journal.get_intent(self.request['question_id'])['status'], 'PAYMENT_FAILED')

    def test_insufficient_funds_is_not_final_while_authorization_may_still_be_used(self):
        journal = PaymentJournal(self.db_path)
        facilitator = FakeFacilitator()
        facilitator.settle = lambda payload, requirements: {'success': False, 'errorReason': 'insufficient_funds'}
        result = process_paid_ask(self.signature, self.challenge, self.requirements, self.request,
                                  self.resource_url, lambda: self.fail('must not run'), facilitator, FakeEscrow(), journal)
        self.assertEqual(result['status'], 202)
        self.assertEqual(journal.get_intent(self.request['question_id'])['status'], 'PAYMENT_INITIATED')

    def test_facilitator_timeout_keeps_intent_for_status_lookup(self):
        journal = PaymentJournal(self.db_path)
        facilitator = FakeFacilitator()
        def timeout(*args):
            raise TimeoutError('response lost')
        facilitator.settle = timeout
        result = process_paid_ask(self.signature, self.challenge, self.requirements, self.request,
                                  self.resource_url, lambda: self.fail('must not run'), facilitator, FakeEscrow(), journal)
        self.assertEqual(result['status'], 202)
        self.assertEqual(journal.get_intent(self.request['question_id'])['status'], 'PAYMENT_INITIATED')
        class Lookup:
            def lookup(self, intent):
                return {**intent, 'status': 'CONFIRMED', 'tx_hash': '0x' + 'a' * 64}
        self.assertEqual(recover_pending(journal, FakeEscrow('AUTO-REFUNDED'), Lookup(), intent_timeout_seconds=0)['refunded'], 1)

    def test_intent_write_failure_prevents_facilitator_settlement(self):
        class BrokenJournal:
            def record_initiated(self, payload, owner):
                raise OSError('disk error')
        facilitator = FakeFacilitator()
        with self.assertRaises(OSError):
            process_paid_ask(self.signature, self.challenge, self.requirements, self.request,
                             self.resource_url, lambda: self.fail('must not run'), facilitator, FakeEscrow(), BrokenJournal())
        self.assertEqual(facilitator.settle_calls, [])


if __name__ == '__main__':
    unittest.main()
