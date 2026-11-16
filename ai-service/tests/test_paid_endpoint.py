import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from x402 import FujiPaymentConfig

class PaidEndpointTests(unittest.TestCase):
    def test_missing_payment_returns_402_without_running_answer(self):
        config = FujiPaymentConfig('https://facilitator.test', '0x'+'1'*40,
                                   '0x5425890298aed601595a70AB815c96711a31Bc65',
                                   'https://internal.test/settle', 'secret')
        with patch.dict(os.environ, {'ASKPAY_X402_ENABLED':'true'}), \
             patch('main.configured_snapshot', return_value=object()), \
             patch('main.load_payment_config', return_value=config), \
             patch('main.ask_legal_question') as answer:
            result = TestClient(main.app).post('/api/v1/legal/ask', json={
                'question_id':'0x'+'2'*64, 'question':'Hồ sơ hải quan gồm những gì?', 'tier':'quick'})
        self.assertEqual(result.status_code, 402)
        self.assertEqual(result.json()['accepts'][0]['amount'], '50000')
        self.assertIn('payment-required', result.headers)
        answer.assert_not_called()

    def test_recover_rejects_unauthorized_request(self):
        with patch.dict(os.environ, {'ASKPAY_RECOVERY_TOKEN':'secret'}):
            result = TestClient(main.app).post('/api/v1/legal/recover')
        self.assertEqual(result.status_code, 401)

class PaymentStatusTests(unittest.TestCase):
    def test_payment_status_omits_private_payload_and_checks_payer(self):
        from tempfile import TemporaryDirectory
        from payment_recovery import PaymentJournal
        with TemporaryDirectory() as tmp:
            journal=PaymentJournal(Path(tmp)/'payments.sqlite3')
            query='0x'+'1'*64; payer='0x'+'2'*40; tx='0x'+'3'*64
            intent={'query_id':query,'question_hash':'0x'+'4'*64,'tier':'quick','amount':'50000','payer':payer,
                    'nonce':'0x'+'5'*64,'network':'eip155:43113','asset':'0x'+'6'*40,
                    'pay_to':'0x'+'7'*40,'valid_before':'9999999999'}
            journal.record_initiated(intent, 'owner')
            with patch('main.payment_journal', return_value=journal):
                client=TestClient(main.app)
                wrong=client.get(f'/api/v1/legal/payments/{query}',params={'payer':'0x'+'8'*40})
                pending=client.get(f'/api/v1/legal/payments/{query}',params={'payer':payer})
                self.assertEqual(wrong.status_code,404)
                self.assertEqual(pending.json()['status'],'PAYMENT_INITIATED')
                self.assertNotIn('nonce',pending.text)
                journal.confirm_intent(query,'owner',tx)
                result=client.get(f'/api/v1/legal/payments/{query}',params={'payer':payer})
                self.assertEqual(result.json()['status'],'PENDING_ESCROW')
                self.assertEqual(result.json()['payment_tx_hash'],tx)
