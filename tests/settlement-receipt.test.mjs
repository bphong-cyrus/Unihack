import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedReceipt } from '../app/api/ask-and-settle/settlement-receipt.mjs';

test('accepts only a confirmed successful transaction receipt', async () => {
  const hash = '0x' + 'a'.repeat(64);
  assert.equal((await confirmedReceipt({ waitForTransactionReceipt: async () => ({ status: 'success', transactionHash: hash }) }, hash)).status, 'success');
  await assert.rejects(confirmedReceipt({ waitForTransactionReceipt: async () => ({ status: 'reverted', transactionHash: hash }) }, hash));
  await assert.rejects(confirmedReceipt({ waitForTransactionReceipt: async () => ({ status: 'success', transactionHash: '0x' + 'b'.repeat(64) }) }, hash));
  await assert.rejects(confirmedReceipt({ waitForTransactionReceipt: async () => { throw new Error('RPC unavailable'); } }, hash));
});
