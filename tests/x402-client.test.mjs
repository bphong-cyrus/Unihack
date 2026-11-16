import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256, toBytes } from 'viem';
import { signFujiPayment } from '../app/lib/x402.mjs';
const question = 'Hồ sơ hải quan gồm những gì?';
const query = '0x' + '2'.repeat(64), payer = '0x' + '3'.repeat(40), contract = '0x' + '1'.repeat(40);
const url = 'https://example.test/api/v1/legal/ask';
const requirement = {scheme:'exact',network:'eip155:43113',amount:'50000',asset:'0x5425890298aed601595a70AB815c96711a31Bc65',payTo:contract,maxTimeoutSeconds:120,
 extra:{name:'USD Coin',version:'2',assetTransferMethod:'eip3009',paymentFlow:'upfront',askpayPaymentNonce:'0x'+'4'.repeat(64),askpayQueryId:query,askpayTier:'quick',askpayQuestionHash:sha256(toBytes(question))}};
const challenge = (item, resource=url) => btoa(JSON.stringify({x402Version:2,resource:{url:resource},accepts:[item]}));
const args = [ 'quick', query, question, payer, contract, url ];
test('signs only a matching USDC challenge, payer, question and contract', async () => {
 let typed; const provider={request:async input => {typed=JSON.parse(input.params[1]);return '0x'+'f'.repeat(130)}};
 const payload=JSON.parse(atob(await signFujiPayment(challenge(requirement), ...args, provider)));
 assert.equal(typed.domain.chainId,43113); assert.equal(payload.payload.authorization.value,'50000'); assert.equal(payload.payload.authorization.from,payer);
});
test('rejects altered price, contract, hash and resource before wallet prompt', async () => {
 let called=false; const provider={request:async()=>{called=true}};
 for (const encoded of [challenge({...requirement, amount:'200000'}),challenge({...requirement,payTo:payer}),challenge({...requirement,extra:{...requirement.extra,askpayQuestionHash:'0x'+'5'.repeat(64)}}),challenge(requirement,'https://other.test/')]) {
  await assert.rejects(signFujiPayment(encoded,...args,provider));
 }
 assert.equal(called,false);
});
