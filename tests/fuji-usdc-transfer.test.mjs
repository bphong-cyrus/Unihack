import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';
import { hasFujiUsdcTransfer } from '../app/api/internal/escrow/settle/fuji-usdc-transfer.mjs';
const token = '0x5425890298aed601595a70AB815c96711a31Bc65';
const payer = '0x' + '1'.repeat(40);
const escrow = '0x' + '2'.repeat(40);
const event = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const log = { address: token, topics: encodeEventTopics({abi:[event],eventName:'Transfer',args:{from:payer,to:escrow}}),
  data: encodeAbiParameters([{type:'uint256'}],[50000n]) };
test('matches confirmed Fuji USDC transfer without address case sensitivity', () => {
  assert.equal(hasFujiUsdcTransfer({status:'success', logs:[log]}, payer, escrow, '50000'), true);
  assert.equal(hasFujiUsdcTransfer({status:'reverted', logs:[log]}, payer, escrow, '50000'), false);
  assert.equal(hasFujiUsdcTransfer({status:'success', logs:[log]}, payer, escrow, '200000'), false);
  assert.equal(hasFujiUsdcTransfer({status:'success', logs:[{...log,address:escrow}]}, payer, escrow, '50000'), false);
});
