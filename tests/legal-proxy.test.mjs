import test from 'node:test';
import assert from 'node:assert/strict';
import { forwardLegalQuestion } from '../app/api/ask-and-settle/legal-proxy.mjs';

const request = { questionId: '0x123', question: 'Thời hạn khai hải quan?', tier: 'quick' };

test('forwards the question and returns the service result without claiming settlement', async () => {
  const response = { question_id: '0x123', answer: 'Ví dụ', citations: [], validation: { passed: false, verdict: 'UNVERIFIED_REFUND', overall_score: 0, citation_checks: [] } };
  let sent;
  const result = await forwardLegalQuestion(request, 'http://service/ask', async (url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => response };
  });
  assert.equal(sent.question_id, request.questionId);
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
