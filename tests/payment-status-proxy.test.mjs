import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentStatusProxy } from '../app/api/v1/legal/payments/status-proxy.mjs';
const id='0x'+'1'.repeat(64), payer='0x'+'2'.repeat(40);
test('forwards a well-formed question and wallet to the configured service',async()=>{
 let called; const result=await paymentStatusProxy(id,payer,'https://service.test/api/v1/legal/ask',async(url)=>{called=url; return new Response(JSON.stringify({question_id:id,status:'PAYMENT_INITIATED',payment_tx_hash:null,settlement_tx_hash:null}),{status:200})});
 assert.equal(result.status,200); assert.equal(new URL(called).pathname,`/api/v1/legal/payments/${id}`); assert.equal(new URL(called).searchParams.get('payer'),payer);
});
test('refuses invalid identifiers without querying the service',async()=>{
 let called=false; const result=await paymentStatusProxy('bad',payer,'https://service.test/api/v1/legal/ask',async()=>{called=true});
 assert.equal(result.status,400);assert.equal(called,false);
});
