import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentDisplay } from '../app/lib/payment-status.mjs';
const tx='0x'+'a'.repeat(64);
test('only shows resolved payment when a terminal status has a transaction hash',()=>{
 assert.equal(paymentDisplay({status:'REFUNDED',settlement_tx_hash:tx}).settlementStatus,'AUTO_REFUNDED_TO_USER');
 assert.equal(paymentDisplay({status:'RELEASED',settlement_tx_hash:null}).settlementStatus,'PENDING_RECONCILIATION');
 assert.equal(paymentDisplay({status:'PENDING_ESCROW',settlement_tx_hash:tx}).settlementStatus,'PENDING_RECONCILIATION');
 assert.equal(paymentDisplay({status:'PAYMENT_FAILED'}).settlementStatus,'PAYMENT_FAILED');
});
