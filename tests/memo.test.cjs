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
