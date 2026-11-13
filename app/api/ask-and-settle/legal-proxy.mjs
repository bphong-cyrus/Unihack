export async function forwardLegalQuestion(body, url, fetchImpl = fetch) {
  if (!body || typeof body.question !== 'string' || !body.question.trim() ||
      typeof body.questionId !== 'string' || !body.questionId ||
      !['quick', 'deep'].includes(body.tier)) {
    return { status: 400, body: { error: 'Câu hỏi, mã câu hỏi hoặc gói tra cứu không hợp lệ.' } };
  }
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question_id: body.questionId, question: body.question.trim(), tier: body.tier,
        domain: 'import_export_customs',
        ...(body.asOf ? { as_of: body.asOf } : {}),
        simulate_hallucination: body.simulateHallucination === true,
        simulate_expired_law: body.simulateExpiredLaw === true
      }),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    return { status: 503, body: { error: 'Dịch vụ tra cứu chưa sẵn sàng. Vui lòng thử lại sau.' } };
  }
  if (!response.ok) return { status: 502, body: { error: 'Dịch vụ tra cứu trả về lỗi.' } };
  let result;
  try { result = await response.json(); } catch { result = null; }
  if (!result || result.question_id !== body.questionId || typeof result.answer !== 'string' ||
      !Array.isArray(result.citations) || typeof result.validation?.passed !== 'boolean' ||
      !Array.isArray(result.validation?.citation_checks)) {
    return { status: 502, body: { error: 'Dữ liệu từ dịch vụ tra cứu không hợp lệ.' } };
  }
  const { onchain, ...answer } = result;
  return { status: 200, body: { ...answer, demo: true } };
}

export async function fetchLegalCorpus(url, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  } catch {
    return { status: 503, body: { error: 'Không thể kết nối kho dữ liệu.' } };
  }
  if (!response.ok) return { status: 502, body: { error: 'Kho dữ liệu trả về lỗi.' } };
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!data || !Number.isInteger(data.total_documents) || !Number.isInteger(data.total_chunks) ||
      typeof data.corpus_status !== 'string' || !Array.isArray(data.records)) {
    return { status: 502, body: { error: 'Thông tin kho dữ liệu không hợp lệ.' } };
  }
  return { status: 200, body: data };
}
