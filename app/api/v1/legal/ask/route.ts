import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Dữ liệu yêu cầu không hợp lệ." }, { status: 400 });
  }

  const serviceUrl = process.env.LEGAL_RAG_API_URL || "http://127.0.0.1:8000/api/v1/legal/ask";
  const paymentSignature = request.headers.get("PAYMENT-SIGNATURE");
  try {
    const upstream = await fetch(serviceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(paymentSignature ? { "PAYMENT-SIGNATURE": paymentSignature } : {})
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(55000)
    });
    const responseBody = await upstream.arrayBuffer();
    const headers = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-store"
    });
    for (const name of ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(responseBody, { status: upstream.status, headers });
  } catch {
    return NextResponse.json({ error: "Dịch vụ LegalQA hoặc x402 chưa sẵn sàng." }, { status: 503 });
  }
}
