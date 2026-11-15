import { NextResponse } from "next/server";
import { fetchLegalCorpus } from "../ask-and-settle/legal-proxy.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const askUrl = process.env.LEGAL_RAG_API_URL || "http://127.0.0.1:8000/api/v1/legal/ask";
  const corpusUrl = process.env.LEGAL_CORPUS_API_URL || askUrl.replace(/\/ask\/?$/, "/corpus");
  if (corpusUrl === askUrl) {
    return NextResponse.json({ error: "Chưa cấu hình địa chỉ kho dữ liệu." }, { status: 503 });
  }
  const result = await fetchLegalCorpus(corpusUrl);
  return NextResponse.json(result.body, { status: result.status });
}
