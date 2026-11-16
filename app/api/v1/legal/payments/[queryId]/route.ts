import { NextResponse } from "next/server";
import { paymentStatusProxy } from "../status-proxy.mjs";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: { queryId: string } }) {
  const payer = new URL(request.url).searchParams.get("payer") || "";
  const service = process.env.LEGAL_RAG_API_URL || "http://127.0.0.1:8000/api/v1/legal/ask";
  const result = await paymentStatusProxy(params.queryId, payer, service);
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
