import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyX402PaymentHeader } from '../app/api/ask-and-settle/x402-protocol.mjs';

test('rejects empty authorization even with correct amount', () => {
  const result = verifyX402PaymentHeader({
    paymentProof: { payload: { amount: '50000', authorization: {} } },
    expectedQuestionId: '0x' + '1'.repeat(64),
    expectedQuestionHash: '0x' + '2'.repeat(64), expectedTier: 'quick'
  });
  assert.equal(result.ok, false);
});

test('rejects malformed transaction identifier and absent request binding', () => {
  const result = verifyX402PaymentHeader({
    paymentProof: { payload: { amount: '50000', txHash: '0x123' } },
    expectedQuestionId: '0x' + '1'.repeat(64),
    expectedQuestionHash: '0x' + '2'.repeat(64), expectedTier: 'quick'
  });
  assert.equal(result.ok, false);
});
