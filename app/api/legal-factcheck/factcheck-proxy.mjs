export async function forwardFactcheck(body, url, fetchImpl = fetch) {
  if (!body || !['document', 'article', 'clause', 'excerpt'].every(key => typeof body[key] === 'string' && body[key].trim()) ||
      (body.point !== undefined && typeof body.point !== 'string')) {
    return { status: 400, body: { error: 'Cần số văn bản, Điều, Khoản và đoạn trích cần kiểm tra.' } };
  }
  const payload = { document: body.document.trim(), article: body.article.trim(), clause: body.clause.trim(),
    point: (body.point || '').trim(), excerpt: body.excerpt.trim(), ...(body.as_of ? { as_of: body.as_of } : {}) };
  let response;
  try {
    response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(15000), cache: 'no-store' });
  } catch {
    return { status: 503, body: { error: 'Dịch vụ kiểm chứng chưa sẵn sàng.' } };
  }
  if (!response.ok) return { status: response.status === 503 ? 503 : 502, body: { error: 'Không có nguồn đã duyệt để kiểm chứng.' } };
  let result;
  try { result = await response.json(); } catch { result = null; }
  if (!result || typeof result.passed !== 'boolean' || !Array.isArray(result.differences) ||
      !result.citation || !['document', 'article', 'clause', 'point', 'excerpt'].every(key => result.citation[key] === payload[key])) {
    return { status: 502, body: { error: 'Kết quả kiểm chứng không khớp yêu cầu.' } };
  }
  return { status: 200, body: result };
}
