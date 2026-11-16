import test from 'node:test';
import assert from 'node:assert/strict';
import { forwardFactcheck } from '../app/api/legal-factcheck/factcheck-proxy.mjs';

const request = { document: '54/2014/QH13', article: '999', clause: '9', point: '', excerpt: 'Đoạn văn cần kiểm tra.' };

test('forwards the exact provision and preserves not-found result', async () => {
  const result = await forwardFactcheck(request, 'http://service/factcheck', async (url, init) => {
    assert.equal(JSON.parse(init.body).article, '999');
    return { ok: true, json: async () => ({ citation: request, passed: false, fail_reason: 'ARTICLE_OR_CLAUSE_NOT_FOUND', differences: [] }) };
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.citation.article, '999');
});

test('rejects a service response that silently changes the provision', async () => {
  const result = await forwardFactcheck(request, 'http://service/factcheck', async () => ({
    ok: true, json: async () => ({ citation: { ...request, article: '25' }, passed: true, differences: [] })
  }));
  assert.equal(result.status, 502);
});
