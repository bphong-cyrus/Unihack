import { NextResponse } from "next/server";
import { forwardLegalQuestion } from "./legal-proxy.mjs";

export const maxDuration = 30;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Dữ liệu yêu cầu không hợp lệ." }, { status: 400 });
  }
  const url = process.env.LEGAL_RAG_API_URL || "http://127.0.0.1:8000/api/v1/legal/ask";
  const result = await forwardLegalQuestion(body, url);
  return NextResponse.json(result.body, { status: result.status });
}
