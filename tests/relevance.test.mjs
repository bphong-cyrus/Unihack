import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceRelevant } from '../app/api/ask-and-settle/relevance.mjs';

test('rejects unrelated tax refund evidence for a used machine import question', () => {
  assert.equal(evidenceRelevant('Nhập máy tiện cũ từ Nhật cần điều kiện gì?', '19', 'Thuế xuất khẩu nhập khẩu', 'Hoàn thuế nhập khẩu khi hàng hóa tái xuất.'), false);
});

test('keeps the exact article specified by the user', () => {
  assert.equal(evidenceRelevant('Điều 999 khoản 9 có tồn tại không?', '25', 'Luật Hải quan', 'Thời hạn nộp tờ khai.'), false);
});
