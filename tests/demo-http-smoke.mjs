// Run after starting demo_api and Next: ASK_BASE_URL=http://127.0.0.1:3017 node tests/demo-http-smoke.mjs
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const base = process.env.ASK_BASE_URL || 'http://127.0.0.1:3017';
async function ask(question, extra={}) {
 const r=await fetch(base+'/api/ask-and-settle',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({questionId:'0x'+randomBytes(32).toString('hex'),question,tier:'quick',mode:'quick',asOf:'2026-11-17',...extra})});
 return {status:r.status,body:await r.json()};
}
const corpus=await (await fetch(base+'/api/legal-corpus')).json();
assert.equal(corpus.total_documents,6);assert.equal(corpus.total_chunks,34);
let r=await ask('Hàng đến cửa khẩu ngày 01/11/2026, hôm nay 17/11/2026, còn bao nhiêu trong 30 ngày?');
assert.equal(r.status,200);assert.match(r.body.answer,/14 ngày/);assert.equal(r.body.onchain.settlementStatus,'NO_ESCROW_DEPOSIT');
r=await ask('Kiểm chứng Điều 999 khoản 9 Luật 54/2014/QH13',{mode:'factcheck'});
assert.equal(r.status,200);assert.equal(r.body.validation.passed,false);assert.equal(r.body.citations[0].article,'999');
r=await ask('Kiểm chứng Điều 25 khoản 1 Luật 54/2014/QH13: Đối với hàng hóa nhập khẩu, nộp trước ngày hàng hóa đến cửa khẩu hoặc trong thời hạn 60 ngày kể từ ngày hàng hóa đến cửa khẩu.',{mode:'factcheck'});
assert.equal(r.status,200);assert.equal(r.body.validation.passed,false);assert.match(r.body.answer,/60/);
r=await ask('Nhập máy tiện cũ từ Nhật để bán lại, chưa biết HS?',{tier:'deep',mode:'deep'});
assert.equal(r.status,200);assert.equal(r.body.answer_status,'NEEDS_CLARIFICATION');assert.equal(r.body.validation.settlement_eligible,false);
r=await ask('128/2020/NĐ-CP còn hiệu lực không?');assert.equal(r.status,200);assert.match(r.body.answer,/169\/2026/);assert.equal(r.body.validation.settlement_eligible,false);
r=await ask('Chủ trọ giữ tiền cọc thì làm gì?');assert.equal(r.status,200);assert.equal(r.body.citations.length,0);
// No funded wallet is involved; this local smoke environment has payment disabled.
r=await ask('Thời hạn tờ khai nhập khẩu?',{requireX402:true});assert.equal(r.status,503);assert.equal(r.body.code,'PAYMENT_NOT_CONFIGURED');
console.log('PASS: corpus, deadline, exact factcheck, altered quote, machinery, repeal, abstention, disabled payment (8 checks).');
