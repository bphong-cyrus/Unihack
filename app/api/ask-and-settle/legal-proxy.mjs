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
        mode: body.mode || body.tier,
        ...(body.factcheckPayload ? { factcheck_payload: body.factcheckPayload } : {}),
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
  const validCitation = item => item && ['document', 'article', 'clause', 'excerpt'].every(key => typeof item[key] === 'string') &&
    (item.point === undefined || typeof item.point === 'string') &&
    (item.document_title === undefined || typeof item.document_title === 'string');
  const validCheck = item => item && ['document', 'article', 'clause'].every(key => typeof item[key] === 'string') &&
    (item.point === undefined || typeof item.point === 'string') &&
    ['doc_exists', 'article_clause_exists', 'is_in_force'].every(key => typeof item[key] === 'boolean') &&
    typeof item.excerpt_similarity === 'number' && Number.isFinite(item.excerpt_similarity) &&
    item.excerpt_similarity >= 0 && item.excerpt_similarity <= 1 &&
    (item.source_url == null || typeof item.source_url === 'string') &&
    (item.source_sha256 == null || typeof item.source_sha256 === 'string') &&
    (item.raw_text == null || typeof item.raw_text === 'string') &&
    ['PASS', 'FAIL'].includes(item.status);
  if (!result || result.question_id !== body.questionId || typeof result.answer !== 'string' ||
      !Array.isArray(result.citations) || typeof result.validation?.passed !== 'boolean' ||
      !result.citations.every(validCitation) ||
      !Number.isFinite(result.validation?.overall_score) || result.validation.overall_score < 0 || result.validation.overall_score > 100 ||
      (result.validation.snapshot_sha256 !== undefined && typeof result.validation.snapshot_sha256 !== 'string') ||
      !Array.isArray(result.validation?.citation_checks) || !result.validation.citation_checks.every(validCheck) ||
      result.citations.length !== result.validation.citation_checks.length ||
      !result.citations.every((citation, index) => {
        const check = result.validation.citation_checks[index];
        const normalizeDocument = value => value.toUpperCase().replace(/\s/g, '');
        return normalizeDocument(citation.document) === normalizeDocument(check.document) &&
          citation.article.trim() === check.article.trim() && citation.clause.trim() === check.clause.trim() &&
          (citation.point || '').trim() === (check.point || '').trim();
      }) ||
      result.validation.passed !== (result.citations.length > 0 && result.validation.citation_checks.every(check => check.status === 'PASS'))) {
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
  const validRecord = item => item && typeof item.doc_id === 'string' && item.doc_id.trim() &&
    (item.doc_title == null || typeof item.doc_title === 'string') &&
    (item.source_url == null || typeof item.source_url === 'string') &&
    (item.total_versions === undefined || (Number.isInteger(item.total_versions) && item.total_versions >= 0)) &&
    (item.reviewed_versions === undefined || (Number.isInteger(item.reviewed_versions) && item.reviewed_versions >= 0 &&
      Number.isInteger(item.total_versions) && item.reviewed_versions <= item.total_versions));
  if (!data || !Number.isInteger(data.total_documents) || data.total_documents < 0 ||
      !Number.isInteger(data.total_chunks) || data.total_chunks < 0 ||
      typeof data.corpus_status !== 'string' || !Array.isArray(data.records) || !data.records.every(validRecord)) {
    return { status: 502, body: { error: 'Thông tin kho dữ liệu không hợp lệ.' } };
  }
  return { status: 200, body: data };
}
