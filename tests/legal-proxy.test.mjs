import test from 'node:test';
import assert from 'node:assert/strict';
import { forwardLegalQuestion } from '../app/api/ask-and-settle/legal-proxy.mjs';

const request = { questionId: '0x123', question: 'Thời hạn khai hải quan?', tier: 'quick', asOf: '2023-01-01' };

test('forwards the question and returns the service result without claiming settlement', async () => {
  const response = { question_id: '0x123', answer: 'Ví dụ', citations: [], validation: { passed: false, verdict: 'UNVERIFIED_REFUND', overall_score: 0, citation_checks: [] } };
  let sent;
  const result = await forwardLegalQuestion(request, 'http://service/ask', async (url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => response };
  });
  assert.equal(sent.question_id, request.questionId);
  assert.equal(sent.as_of, request.asOf);
  assert.equal(result.body.answer, 'Ví dụ');
  assert.equal(result.body.onchain, undefined);
  assert.equal(result.body.demo, true);
});

test('service failure never generates an answer or settlement', async () => {
  const result = await forwardLegalQuestion(request, 'http://service/ask', async () => { throw new Error('offline'); });
  assert.equal(result.status, 503);
  assert.equal(result.body.answer, undefined);
  assert.equal(result.body.onchain, undefined);
});

test('rejects empty question and invalid tier', async () => {
  for (const input of [{ ...request, question: ' ' }, { ...request, tier: 'other' }]) {
    const result = await forwardLegalQuestion(input, 'http://service/ask', async () => { throw new Error('must not call'); });
    assert.equal(result.status, 400);
  }
});

test('rejects malformed service result', async () => {
  const result = await forwardLegalQuestion(request, 'http://service/ask', async () => ({ ok: true, json: async () => ({ answer: 'not validated' }) }));
  assert.equal(result.status, 502);
  assert.equal(result.body.onchain, undefined);
});

test('corpus proxy returns the actual service inventory without fabricated records', async () => {
  const { fetchLegalCorpus } = await import('../app/api/ask-and-settle/legal-proxy.mjs');
  const result = await fetchLegalCorpus('http://service/corpus', async () => ({ ok: true, json: async () => ({ total_documents: 1, total_chunks: 2, corpus_status: 'REVIEW_ASSERTED', records: [{ doc_id: 'TEST' }] }) }));
  assert.equal(result.status, 200);
  assert.equal(result.body.records[0].doc_id, 'TEST');
  assert.equal(result.body.total_documents, 1);
});

test('corpus proxy reports unavailable and malformed inventory', async () => {
  const { fetchLegalCorpus } = await import('../app/api/ask-and-settle/legal-proxy.mjs');
  const unavailable = await fetchLegalCorpus('http://service/corpus', async () => { throw new Error('offline'); });
  assert.equal(unavailable.status, 503);
  const invalid = await fetchLegalCorpus('http://service/corpus', async () => ({ ok: true, json: async () => ({ records: [] }) }));
  assert.equal(invalid.status, 502);
});
