import test from 'node:test';
import assert from 'node:assert/strict';
import { paidAsk } from '../app/lib/paid-ask.mjs';
const body = {question_id:'id', question:'test', tier:'quick'};
test('requests challenge before signing and sends signature exactly once', async () => {
 const calls=[]; const fetcher=async (_url, options) => {calls.push(options); return calls.length===1 ? new Response('{}',{status:402,headers:{'PAYMENT-REQUIRED':'challenge'}}) : new Response('{"payment_status":"ESCROW_SETTLEMENT_PENDING"}',{status:202});};
 const result=await paidAsk('/api',body,async challenge=>{assert.equal(challenge,'challenge');return 'signed'},fetcher);
 assert.equal(result.status,202); assert.equal(calls.length,2); assert.equal(calls[1].headers['PAYMENT-SIGNATURE'],'signed');
});
test('never signs if upstream fails or does not provide a challenge', async () => {
 let signed=false;
 for (const response of [new Response('{}',{status:503}),new Response('{}',{status:200}),new Response('{}',{status:402})])
  await assert.rejects(paidAsk('/api',body,async()=>{signed=true},async()=>response));
 assert.equal(signed,false);
});

test('reports the question ID if a signed request has an uncertain result', async () => {
 let count=0; const fetcher=async()=>{count++;return count===1 ? new Response('{}',{status:402,headers:{'PAYMENT-REQUIRED':'challenge'}}) : new Response('{}',{status:502})};
 await assert.rejects(paidAsk('/api',body,async()=> 'signed',fetcher), /Mã câu hỏi: id/);
 assert.equal(count,2);
});
