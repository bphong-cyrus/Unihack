"""x402 v2 exact/EIP-3009 challenge and settlement orchestration for Fuji."""
from dataclasses import dataclass, field
import base64
import hashlib
import json
import os
import re
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlparse
from payment_recovery import PaymentJournal


FUJI_NETWORK = 'eip155:43113'
FUJI_USDC = '0x5425890298aed601595a70AB815c96711a31Bc65'
_ADDRESS = re.compile(r'^0x[a-fA-F0-9]{40}$')
_BYTES32 = re.compile(r'^0x[a-fA-F0-9]{64}$')
_SIGNATURE = re.compile(r'^0x[a-fA-F0-9]{130}$')


class X402ConfigurationError(RuntimeError):
    """x402 is not fully configured for real Fuji payments."""


class X402PaymentError(ValueError):
    """The supplied x402 payload does not match this request's challenge."""


@dataclass(frozen=True)
class FujiPaymentConfig:
    facilitator_url: str
    escrow_address: str
    usdc_address: str
    settlement_url: str
    settlement_token: str = field(repr=False)
    facilitator_api_key: str | None = field(default=None, repr=False)


@dataclass(frozen=True)
class RecoveryConfig:
    settlement_url: str
    settlement_token: str = field(repr=False)
    facilitator_status_url: str = ''
    facilitator_api_key: str | None = field(default=None, repr=False)


def _secure_url(value):
    parsed = urlparse(value)
    return bool(parsed.hostname and not parsed.username and not parsed.password and
                (parsed.scheme == 'https' or (parsed.scheme == 'http' and parsed.hostname in {'localhost', '127.0.0.1', '::1'})))


def load_recovery_config(environ=None):
    environment = os.environ if environ is None else environ
    url = environment.get('ASKPAY_ESCROW_SETTLEMENT_URL', '')
    token = environment.get('ASKPAY_SETTLEMENT_TOKEN', '')
    if not _secure_url(url) or not token:
        raise X402ConfigurationError('escrow recovery endpoint and token are required')
    status_url = environment.get('ASKPAY_FACILITATOR_STATUS_URL', '')
    if status_url and not _secure_url(status_url):
        raise X402ConfigurationError('facilitator status URL must use HTTPS or local loopback')
    return RecoveryConfig(url, token, status_url, environment.get('ASKPAY_X402_FACILITATOR_API_KEY'))


def load_payment_config(environ=None, require_enabled=True):
    environment = os.environ if environ is None else environ
    if require_enabled and environment.get('ASKPAY_X402_ENABLED', '').lower() not in {'1', 'true', 'yes'}:
        raise X402ConfigurationError('x402 is disabled')
    required = {
        'ASKPAY_X402_FACILITATOR_URL': environment.get('X402_FACILITATOR_URL') or environment.get('ASKPAY_X402_FACILITATOR_URL'),
        'ASKPAY_ESCROW_ADDRESS': environment.get('ESCROW_CONTRACT_ADDRESS') or environment.get('ASKPAY_ESCROW_ADDRESS'),
        'ASKPAY_ESCROW_SETTLEMENT_URL': environment.get('ASKPAY_ESCROW_SETTLEMENT_URL'),
        'ASKPAY_SETTLEMENT_TOKEN': environment.get('ASKPAY_SETTLEMENT_TOKEN'),
    }
    missing = [key for key, value in required.items() if not value]
    if missing:
        raise X402ConfigurationError('required Fuji payment settings are missing')
    if not _ADDRESS.fullmatch(required['ASKPAY_ESCROW_ADDRESS']):
        raise X402ConfigurationError('ASKPAY_ESCROW_ADDRESS is invalid')
    usdc_address = environment.get('ASKPAY_USDC_ADDRESS', FUJI_USDC)
    if not _ADDRESS.fullmatch(usdc_address) or usdc_address.lower() != FUJI_USDC.lower():
        raise X402ConfigurationError('ASKPAY_USDC_ADDRESS is invalid')
    facilitator_url = required['ASKPAY_X402_FACILITATOR_URL'].rstrip('/')
    settlement_url = required['ASKPAY_ESCROW_SETTLEMENT_URL']
    if not _secure_url(facilitator_url) or not _secure_url(settlement_url):
        raise X402ConfigurationError('facilitator and settlement URLs must use HTTPS or local loopback')
    return FujiPaymentConfig(
        facilitator_url=facilitator_url,
        escrow_address=required['ASKPAY_ESCROW_ADDRESS'],
        usdc_address=usdc_address,
        settlement_url=settlement_url,
        settlement_token=required['ASKPAY_SETTLEMENT_TOKEN'],
        facilitator_api_key=environment.get('ASKPAY_X402_FACILITATOR_API_KEY'),
    )


def _amount_for_tier(tier):
    if tier == 'quick':
        return '50000'
    if tier == 'deep':
        return '200000'
    raise X402PaymentError('unsupported tier')


def build_payment_challenge(config, request_body, resource_url):
    tier = request_body.get('tier')
    question_id = str(request_body.get('question_id') or '')
    question = request_body.get('question')
    if not _BYTES32.fullmatch(question_id) or not isinstance(question, str) or not question.strip():
        raise X402PaymentError('question_id must be bytes32 and question must be non-empty')
    amount = _amount_for_tier(tier)
    question_hash = hashlib.sha256(question.strip().encode('utf-8')).hexdigest()
    request_fingerprint = json.dumps({
        'question_id': question_id.lower(),
        'question_sha256': question_hash,
        'tier': tier,
        'domain': str(request_body.get('domain') or 'import_export_customs'),
        'as_of': str(request_body.get('as_of') or ''),
    }, sort_keys=True, separators=(',', ':'))
    payment_nonce = hashlib.sha256(request_fingerprint.encode('utf-8')).hexdigest()
    requirement = {
        'scheme': 'exact',
        'network': FUJI_NETWORK,
        'amount': amount,
        'asset': config.usdc_address,
        'payTo': config.escrow_address,
        'maxTimeoutSeconds': 120,
        'extra': {
            'name': 'USD Coin',
            'version': '2',
            'assetTransferMethod': 'eip3009',
            'paymentFlow': 'upfront',
            'askpayTier': tier,
            'askpayQueryId': question_id,
            'askpayQuestionHash': '0x' + question_hash,
            'askpayPaymentNonce': '0x' + payment_nonce,
        },
    }
    return {
        'x402Version': 2,
        'resource': {
            'url': resource_url,
            'description': f'AskPay LegalQA {tier.title()} tier',
            'mimeType': 'application/json',
        },
        'accepts': [requirement],
        'error': 'Payment required',
    }


def _encode(value):
    return base64.b64encode(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')).decode('ascii')


def _decode(value):
    if not isinstance(value, str) or not value or len(value) > 16384:
        raise X402PaymentError('PAYMENT-SIGNATURE header is missing or too large')
    try:
        padded = value + '=' * (-len(value) % 4)
        decoded = base64.b64decode(padded, validate=True)
        payload = json.loads(decoded.decode('utf-8'))
    except (ValueError, UnicodeError, json.JSONDecodeError) as error:
        raise X402PaymentError('PAYMENT-SIGNATURE is not valid base64 JSON') from error
    if not isinstance(payload, dict):
        raise X402PaymentError('PAYMENT-SIGNATURE payload must be an object')
    return payload


def parse_payment_signature(header, expected_requirement, expected_resource_url=None):
    payload = _decode(header)
    if payload.get('x402Version') != 2:
        raise X402PaymentError('invalid_x402_version')
    accepted = payload.get('accepted')
    expected_fields = ('scheme', 'network', 'amount', 'asset', 'payTo', 'maxTimeoutSeconds', 'extra')
    if not isinstance(accepted, dict) or any(accepted.get(field) != expected_requirement.get(field) for field in expected_fields):
        raise X402PaymentError('PAYMENT-SIGNATURE does not match the current request requirements')
    resource = payload.get('resource')
    if expected_resource_url and (not isinstance(resource, dict) or resource.get('url') != expected_resource_url):
        raise X402PaymentError('PAYMENT-SIGNATURE resource does not match the requested URL')
    data = payload.get('payload')
    authorization = data.get('authorization') if isinstance(data, dict) else None
    signature = data.get('signature') if isinstance(data, dict) else None
    if not isinstance(authorization, dict) or not isinstance(signature, str) or not _SIGNATURE.fullmatch(signature):
        raise X402PaymentError('invalid_exact_evm_payload_signature')
    required = ('from', 'to', 'value', 'validAfter', 'validBefore', 'nonce')
    if any(not isinstance(authorization.get(field), str) for field in required):
        raise X402PaymentError('invalid_exact_evm_payload_authorization')
    if not _ADDRESS.fullmatch(authorization['from']) or authorization['to'].lower() != expected_requirement['payTo'].lower():
        raise X402PaymentError('invalid_exact_evm_payload_recipient_mismatch')
    if authorization['value'] != expected_requirement['amount']:
        raise X402PaymentError('invalid_exact_evm_payload_authorization_value_mismatch')
    if not _BYTES32.fullmatch(authorization['nonce']):
        raise X402PaymentError('invalid_exact_evm_payload_authorization_nonce')
    if authorization['nonce'].lower() != expected_requirement['extra']['askpayPaymentNonce'].lower():
        raise X402PaymentError('payment_nonce_does_not_match_request')
    for field in ('validAfter', 'validBefore'):
        if not authorization[field].isdigit():
            raise X402PaymentError('invalid_exact_evm_payload_authorization_time')
    if int(authorization['validBefore']) <= int(authorization['validAfter']):
        raise X402PaymentError('invalid_exact_evm_payload_authorization_time')
    return payload


def _post_json(url, payload, headers=None, timeout=20):
    request_headers = {'Content-Type': 'application/json', **(headers or {})}
    request = Request(url, data=json.dumps(payload).encode('utf-8'), headers=request_headers, method='POST')
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


class FacilitatorClient:
    def __init__(self, config, post_json=None):
        self.config = config
        self._post = post_json or _post_json

    def _call(self, method, payload, requirements):
        headers = {}
        if self.config.facilitator_api_key:
            headers['Authorization'] = f'Bearer {self.config.facilitator_api_key}'
        return self._post(
            f'{self.config.facilitator_url}/{method}',
            {'x402Version': 2, 'paymentPayload': payload, 'paymentRequirements': requirements},
            headers,
            30,
        )

    def verify(self, payload, requirements):
        return self._call('verify', payload, requirements)

    def settle(self, payload, requirements):
        return self._call('settle', payload, requirements)


class FacilitatorStatusClient:
    """Adapter for a configured, provider-specific read-only status endpoint."""
    def __init__(self, config, post_json=None):
        self.config = config
        self._post = post_json or _post_json

    def lookup(self, intent):
        headers = {}
        if self.config.facilitator_api_key:
            headers['Authorization'] = f'Bearer {self.config.facilitator_api_key}'
        return self._post(self.config.facilitator_status_url, intent, headers, 30)


def facilitator_status_client(config):
    return FacilitatorStatusClient(config) if getattr(config, 'facilitator_status_url', '') else None


class EscrowSettlementClient:
    def __init__(self, config, post_json=None):
        self.config = config
        self._post = post_json or _post_json

    def _call(self, action, payload):
        return self._post(
            self.config.settlement_url,
            {**payload, 'action': action},
            {'X-AskPay-Settlement-Token': self.config.settlement_token},
            30,
        )

    def register(self, payload):
        return self._call('register', payload)

    def resolve(self, payload):
        return self._call('resolve', payload)

    def status(self, payload):
        return self._call('status', payload)


def _payment_response(success, transaction, payer, error_reason=None):
    result = {
        'success': success,
        'transaction': transaction or '',
        'network': FUJI_NETWORK,
        'payer': payer or '',
    }
    if error_reason:
        result['errorReason'] = error_reason
    return _encode(result)


def payment_journal():
    root = Path(__file__).resolve().parents[1]
    path = Path(os.environ.get('ASKPAY_PAYMENT_DB', 'data/askpay/payments.sqlite3')).expanduser()
    return PaymentJournal(path if path.is_absolute() else root / path)


def process_paid_ask(payment_header, challenge, requirement, body, resource_url, execute_answer, facilitator, escrow, journal=None):
    headers = {'PAYMENT-REQUIRED': _encode(challenge), 'Cache-Control': 'no-store'}
    if not payment_header:
        return {'status': 402, 'headers': headers, 'body': challenge}
    try:
        payload = parse_payment_signature(payment_header, requirement, resource_url)
    except X402PaymentError as error:
        challenge = {**challenge, 'error': str(error)}
        return {'status': 402, 'headers': {**headers, 'PAYMENT-REQUIRED': _encode(challenge)}, 'body': challenge}

    verified = facilitator.verify(payload, requirement)
    if not isinstance(verified, dict) or verified.get('isValid') is not True:
        error_reason = (verified or {}).get('invalidReason', 'invalid_payment') if isinstance(verified, dict) else 'invalid_payment'
        challenge = {**challenge, 'error': str(error_reason)}
        failed = _payment_response(False, '', '', str(error_reason))
        return {'status': 402, 'headers': {**headers, 'PAYMENT-REQUIRED': _encode(challenge), 'PAYMENT-RESPONSE': failed}, 'body': challenge}

    payer = verified.get('payer') or payload['payload']['authorization']['from']
    if payer.lower() != payload['payload']['authorization']['from'].lower():
        challenge = {**challenge, 'error': 'payer_mismatch'}
        failed = _payment_response(False, '', payer, 'payer_mismatch')
        return {'status': 402, 'headers': {**headers, 'PAYMENT-REQUIRED': _encode(challenge), 'PAYMENT-RESPONSE': failed}, 'body': challenge}

    journal = journal or payment_journal()
    authorization = payload['payload']['authorization']
    intent = {'query_id': body['question_id'], 'question_hash': requirement['extra']['askpayQuestionHash'],
              'tier': body['tier'], 'amount': requirement['amount'], 'payer': payer,
              'nonce': authorization['nonce'], 'network': requirement['network'], 'asset': requirement['asset'],
              'pay_to': requirement['payTo'], 'valid_before': authorization['validBefore']}
    owner = uuid.uuid4().hex
    if not journal.record_initiated(intent, owner):
        return {'status': 202, 'headers': headers,
                'body': {'payment_status': 'PAYMENT_INITIATED', 'question_id': body['question_id']}}
    try:
        return _settle_initiated(journal, owner, intent, headers, payer, body, requirement,
                                 payload, execute_answer, facilitator, escrow)
    finally:
        try:
            journal.release_intent(body['question_id'], owner)
        except Exception:
            pass


def _settle_initiated(journal, owner, intent, headers, payer, body, requirement, payload, execute_answer, facilitator, escrow):
    try:
        settled = facilitator.settle(payload, requirement)
    except Exception:
        return {'status': 202, 'headers': headers,
                'body': {'payment_status': 'PAYMENT_INITIATED', 'question_id': body['question_id']}}
    if not isinstance(settled, dict) or settled.get('success') is not True:
        transaction = (settled or {}).get('transaction', '') if isinstance(settled, dict) else ''
        error_reason = (settled or {}).get('errorReason', 'settlement_failed') if isinstance(settled, dict) else 'settlement_failed'
        if isinstance(transaction, str) and _BYTES32.fullmatch(transaction):
            try:
                journal.remember_intent_tx(body['question_id'], owner, transaction)
            except Exception:
                return {'status': 202, 'headers': headers,
                        'body': {'payment_status': 'JOURNAL_WRITE_FAILED', 'payment_tx_hash': transaction}}
        definitive_reasons = {'invalid_exact_evm_payload_signature',
                              'invalid_exact_evm_payload_authorization_value_mismatch',
                              'invalid_exact_evm_payload_recipient_mismatch'}
        definitive = not transaction and error_reason in definitive_reasons
        if definitive:
            journal.fail_intent(body['question_id'], owner)
        body_result = {
            'payment_status': 'PAYMENT_FAILED' if definitive else 'PAYMENT_INITIATED',
            'payment_tx_hash': transaction,
            'settlement_error': error_reason,
        }
        return {
            'status': 402 if definitive else 202,
            'headers': {**headers, 'PAYMENT-RESPONSE': _payment_response(False, transaction, payer, str(error_reason))},
            'body': body_result,
        }
    payment_tx_hash = settled.get('transaction')
    if (settled.get('network') != FUJI_NETWORK or not isinstance(settled.get('payer'), str)
            or settled['payer'].lower() != payer.lower()
            or ('amount' in settled and str(settled['amount']) != requirement['amount'])):
        transaction = payment_tx_hash if isinstance(payment_tx_hash, str) and _BYTES32.fullmatch(payment_tx_hash) else ''
        return {
            'status': 202,
            'headers': {**headers, 'PAYMENT-RESPONSE': _payment_response(False, transaction, payer, 'settlement_verification_failed')},
            'body': {'payment_status': 'SETTLEMENT_PENDING', 'payment_tx_hash': transaction,
                     'settlement_error': 'settlement_verification_failed'},
        }
    if not isinstance(payment_tx_hash, str) or not _BYTES32.fullmatch(payment_tx_hash):
        return {
            'status': 202,
            'headers': {**headers, 'PAYMENT-RESPONSE': _payment_response(False, '', payer, 'settlement_pending')},
            'body': {'payment_status': 'SETTLEMENT_PENDING', 'payment_tx_hash': ''},
        }

    escrow_request = {
        'query_id': body['question_id'],
        'question_hash': requirement['extra']['askpayQuestionHash'],
        'tier': body['tier'],
        'amount': requirement['amount'],
        'payer': payer,
        'payment_tx_hash': payment_tx_hash,
        'passed': False,
        'validator_score': 0,
        'answer_hash': '',
    }
    try:
        journal.confirm_intent(body['question_id'], owner, payment_tx_hash)
    except Exception:
        return {'status': 202, 'headers': {**headers, 'PAYMENT-RESPONSE': _payment_response(True, payment_tx_hash, payer)},
                'body': {'payment_status': 'JOURNAL_WRITE_FAILED', 'payment_tx_hash': payment_tx_hash}}
    try:
        return _fulfill_recorded_payment(journal, owner, escrow_request, headers, payer, body, execute_answer, escrow)
    except Exception:
        return {'status': 202, 'headers': {**headers, 'PAYMENT-RESPONSE': _payment_response(True, payment_tx_hash, payer)},
                'body': {'payment_status': 'ESCROW_RECOVERY_PENDING', 'payment_tx_hash': payment_tx_hash}}
    finally:
        try:
            journal.release(payment_tx_hash, owner)
        except Exception:
            pass


def _fulfill_recorded_payment(journal, owner, escrow_request, headers, payer, body, execute_answer, escrow):
    payment_tx_hash = escrow_request['payment_tx_hash']
    try:
        locked = escrow.register(escrow_request)
    except Exception:
        locked = None
    if not isinstance(locked, dict) or locked.get('status') != 'LOCKED':
        return {
            'status': 202,
            'headers': {**headers, 'PAYMENT-RESPONSE': _payment_response(True, payment_tx_hash, payer)},
            'body': {'payment_status': 'ESCROW_REGISTRATION_PENDING', 'payment_tx_hash': payment_tx_hash},
        }
    journal.transition(payment_tx_hash, owner, 'PENDING_ESCROW', 'ESCROW_RECORDED', locked.get('tx_hash') or None)
    try:
        answer = execute_answer()
    except Exception:
        answer = {'question_id': body['question_id'], 'answer': 'Không thể tạo câu trả lời có căn cứ.',
                  'citations': [], 'validation': {'passed': False, 'verdict': 'UNVERIFIED_REFUND',
                                                 'overall_score': 0.0, 'citation_checks': []}}
    validation = answer.get('validation') or {}
    passed = (validation.get('passed') is True and validation.get('settlement_eligible') is True
              and bool(answer.get('citations')))
    escrow_request.update({
        'passed': passed,
        'validator_score': round(float(validation.get('overall_score') or 0) * 100),
        'answer_hash': answer.get('hashes', {}).get('answer_hash', ''),
    })
    journal.transition(payment_tx_hash, owner, 'ESCROW_RECORDED', 'RESOLUTION_IN_FLIGHT')
    try:
        escrow_result = escrow.resolve(escrow_request)
    except Exception:
        escrow_result = None
    expected_status = 'RELEASED' if passed else 'AUTO-REFUNDED'
    if not isinstance(escrow_result, dict) or escrow_result.get('status') != expected_status:
        body_result = {
            **answer,
            'payment_status': 'ESCROW_SETTLEMENT_PENDING',
            'payment_tx_hash': payment_tx_hash,
            'onchain': {'status': 'PENDING', 'payment_tx_hash': payment_tx_hash, 'tx_hash': ''},
        }
        return {
            'status': 202,
            'headers': {**headers, 'PAYMENT-RESPONSE': _payment_response(True, payment_tx_hash, payer)},
            'body': body_result,
        }
    escrow_tx_hash = escrow_result.get('tx_hash')
    if not isinstance(escrow_tx_hash, str) or not _BYTES32.fullmatch(escrow_tx_hash):
        body_result = {
            **answer,
            'payment_status': 'ESCROW_SETTLEMENT_PENDING',
            'payment_tx_hash': payment_tx_hash,
            'onchain': {'status': 'PENDING', 'payment_tx_hash': payment_tx_hash, 'tx_hash': ''},
        }
        return {
            'status': 202,
            'headers': {**headers, 'PAYMENT-RESPONSE': _payment_response(True, payment_tx_hash, payer)},
            'body': body_result,
        }

    journal.transition(payment_tx_hash, owner, 'RESOLUTION_IN_FLIGHT', 'RELEASED' if passed else 'REFUNDED', escrow_tx_hash)

    result = {
        **answer,
        'payment_status': escrow_result['status'],
        'onchain': {
            'status': escrow_result['status'],
            'payment_tx_hash': payment_tx_hash,
            'tx_hash': escrow_tx_hash,
            'network': FUJI_NETWORK,
        },
    }
    return {
        'status': 200,
        'headers': {**headers, 'PAYMENT-RESPONSE': _payment_response(True, payment_tx_hash, payer)},
        'body': result,
    }
