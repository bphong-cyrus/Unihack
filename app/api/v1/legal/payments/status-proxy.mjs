const hash = value => /^0x[\da-f]{64}$/i.test(value || '');
const address = value => /^0x[\da-f]{40}$/i.test(value || '');
const statuses = new Set(['PAYMENT_INITIATED','PAYMENT_FAILED','PENDING_ESCROW','ESCROW_RECORDED','RESOLUTION_IN_FLIGHT','REFUND_IN_FLIGHT','RELEASED','REFUNDED']);
export async function paymentStatusProxy(queryId, payer, serviceUrl, fetcher = fetch) {
  if (!hash(queryId) || !address(payer)) return { status: 400, body: { error: 'Mã câu hỏi hoặc địa chỉ ví không hợp lệ.' } };
  try {
    const url = new URL(serviceUrl);
    if (!url.pathname.endsWith('/api/v1/legal/ask')) throw new Error('Invalid service URL');
    url.pathname = url.pathname.slice(0, -3) + `payments/${queryId}`;
    url.search = new URLSearchParams({ payer }).toString();
    const res = await fetcher(url.toString(), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { status: res.status === 404 ? 404 : 503, body: { error: 'Chưa thể tra trạng thái thanh toán.' } };
    const body = await res.json();
    if (body.question_id?.toLowerCase() !== queryId.toLowerCase() || !statuses.has(body.status) ||
        (body.payment_tx_hash != null && !hash(body.payment_tx_hash)) ||
        (body.settlement_tx_hash != null && !hash(body.settlement_tx_hash))) throw new Error('Invalid status');
    return { status: 200, body };
  } catch { return { status: 503, body: { error: 'Chưa thể tra trạng thái thanh toán.' } }; }
}
