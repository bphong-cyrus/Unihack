/** Do not retry a signed transfer automatically: a timeout can hide a successful payment. */
export async function paidAsk(url, body, sign, fetcher = fetch) {
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const challenge = await fetcher(url, options);
  const encoded = challenge.headers.get('PAYMENT-REQUIRED');
  if (challenge.status !== 402 || !encoded) throw new Error('Dịch vụ thanh toán chưa sẵn sàng hoặc không trả yêu cầu x402 hợp lệ.');
  const signature = await sign(encoded);
  try {
    const result = await fetcher(url, { ...options, headers: { ...options.headers, 'PAYMENT-SIGNATURE': signature } });
    if (result.status >= 500) throw new Error('uncertain upstream response');
    return result;
  } catch {
    throw new Error(`Chưa xác định được kết quả thanh toán; không gửi lại. Mã câu hỏi: ${body.question_id}`);
  }
}
