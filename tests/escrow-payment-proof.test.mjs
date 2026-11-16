import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';
import { verifyEscrowPayment } from '../app/api/ask-and-settle/escrow-payment-proof.mjs';

const questionId = '0x' + '1'.repeat(64);
const questionHash = '0x' + '2'.repeat(64);
const payer = '0x' + '3'.repeat(40);
const escrow = '0x' + '4'.repeat(40);
const usdc = '0x5425890298aed601595a70AB815c96711a31Bc65';
const txHash = '0x' + 'a'.repeat(64);
const event = parseAbiItem('event QuestionAsked(bytes32 indexed questionId, address indexed asker, uint8 tier, uint256 amount, bytes32 questionHash, bool isUsdc, uint256 timestamp)');
const log = { address: escrow, topics: encodeEventTopics({ abi: [event], eventName: 'QuestionAsked', args: { questionId, asker: payer } }),
  data: encodeAbiParameters([{type:'uint8'},{type:'uint256'},{type:'bytes32'},{type:'bool'},{type:'uint256'}], [0,50000n,questionHash,true,1n]) };
const proof = { txHash, payer, questionId, questionHash, amount: '50000' };
const expected = { questionId, questionHash, tier: 'quick', payer, escrowAddress: escrow, usdcAddress: usdc };
const client = { getChainId: async () => 43113, getTransactionReceipt: async () => ({ status: 'success', from: payer, to: escrow, logs: [log] }),
  readContract: async ({functionName}) => functionName === 'usdcToken' ? usdc : [payer,50000n,0,1,1n,questionHash,'0x'+'0'.repeat(64),0,true] };

test('accepts confirmed matching USDC escrow lock and pending state', async () => {
  assert.equal((await verifyEscrowPayment(proof, expected, client)).ok, true);
});

test('rejects forged receipt, wrong chain, wrong payer and changed question', async () => {
  for (const fake of [
    { ...client, getChainId: async () => 1 },
    { ...client, getTransactionReceipt: async () => ({status:'success',from:payer,to:escrow,logs:[]}) },
    { ...client, getTransactionReceipt: async () => ({status:'reverted',from:payer,to:escrow,logs:[log]}) },
    { ...client, readContract: async ({functionName}) => functionName === 'usdcToken' ? usdc : [payer,50000n,0,2,1n,questionHash,'0x'+'0'.repeat(64),0,true] }
  ]) assert.equal((await verifyEscrowPayment(proof, expected, fake)).ok, false);
  assert.equal((await verifyEscrowPayment({ ...proof, payer: '0x'+'5'.repeat(40) }, expected, client)).ok, false);
  assert.equal((await verifyEscrowPayment(proof, { ...expected, questionHash: '0x'+'9'.repeat(64) }, client)).ok, false);
});
