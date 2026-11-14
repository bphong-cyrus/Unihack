const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync('app/data/legalWorkspaceData.ts', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleObject = { exports: {} };
vm.runInNewContext(code, { exports: moduleObject.exports, module: moduleObject });
const { buildFormalMemoHtml } = moduleObject.exports;

test('memo displays untrusted question, answer and citations as text', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const html = buildFormalMemoHtml(payload, { content: payload, questionId: payload,
    citations: [{ document: payload, document_title: payload, article: payload, clause: payload, excerpt: payload }] });
  assert.ok(!html.includes(payload));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('memo does not imply legal approval or settlement', () => {
  const html = buildFormalMemoHtml('Câu hỏi', { content: 'Trả lời', citations: [] });
  assert.match(html, /chưa chứng minh/i);
  assert.doesNotMatch(html, /Căn cứ pháp lý đã đối chiếu nguyên văn/);
});

test('memo includes the cited point when present', () => {
  const html = buildFormalMemoHtml('Câu hỏi', { content: 'Trả lời', citations: [
    { document: 'A', article: '1', clause: '2', point: 'b', excerpt: 'Văn bản trích dẫn' }
  ] });
  assert.match(html, /Điểm b/);
});

test('memo retains declared source and date for verification', () => {
  const html = buildFormalMemoHtml('Câu hỏi', { content: 'Trả lời', citations: [
    { document: 'A', article: '1', clause: '2', excerpt: 'Trích dẫn' }
  ], validation: { as_of: '2023-01-01', snapshot_id: 'snapshot-1', snapshot_sha256: 'abc123', citation_checks: [
    { source_url: 'https://example.gov.vn/source?a=1&b=2', source_sha256: 'def456' }
  ] } });
  assert.match(html, /2023-01-01/);
  assert.match(html, /snapshot-1/);
  assert.match(html, /abc123/);
  assert.match(html, /def456/);
  assert.match(html, /https:\/\/example.gov.vn\/source\?a=1&amp;b=2/);
});
