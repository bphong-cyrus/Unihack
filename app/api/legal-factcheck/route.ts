import { NextResponse } from 'next/server';
import { forwardFactcheck } from './factcheck-proxy.mjs';

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Dữ liệu yêu cầu không hợp lệ.' }, { status: 400 });
  }
  const askUrl = process.env.AI_SERVICE_URL || process.env.LEGAL_RAG_API_URL || 'http://127.0.0.1:8000/api/v1/legal/ask';
  const url = askUrl.replace(/\/ask\/?$/, '/factcheck');
  if (url === askUrl) return NextResponse.json({ error: 'Chưa cấu hình dịch vụ kiểm chứng.' }, { status: 503 });
  const result = await forwardFactcheck(body, url);
  return NextResponse.json(result.body, { status: result.status });
}
