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
