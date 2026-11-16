/** A terminal journal state without its settlement hash remains unconfirmed in the UI. */
export function paymentDisplay(result) {
  const tx = /^0x[\da-f]{64}$/i.test(result?.settlement_tx_hash || '') ? result.settlement_tx_hash : '';
  if (result?.status === 'RELEASED' && tx) return { settlementStatus:'RELEASED_TO_TREASURY', mode:'LIVE_AVALANCHE', feeLabel:'Đã giải ngân USDC', tx };
  if (result?.status === 'REFUNDED' && tx) return { settlementStatus:'AUTO_REFUNDED_TO_USER', mode:'LIVE_AVALANCHE', feeLabel:'Đã hoàn cọc 100% (On-chain)', tx };
  if (result?.status === 'PAYMENT_FAILED') return { settlementStatus:'PAYMENT_FAILED', mode:'PENDING_AVALANCHE', feeLabel:'Thanh toán không thành công', tx:'' };
  return { settlementStatus:'PENDING_RECONCILIATION', mode:'PENDING_AVALANCHE', feeLabel:'Chờ đối soát giao dịch', tx:'' };
}
