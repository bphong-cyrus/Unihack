import { readFileSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { fetchLegalCorpus } from "../ask-and-settle/legal-proxy.mjs";
import demoManifest from "../../../corpus/demo-v1/manifest.json";

export const dynamic = "force-dynamic";

const DEFAULT_DEMO_V1_SHA256 =
  "38f84d5d593a86142b23bb6d79187192a847be52f56f2befa9f0c0fabdd2bec3";

function resolveDemoSnapshotSha256(): string {
  try {
    const shaPath = path.join(process.cwd(), "corpus", "demo-v1", "manifest.sha256");
    const raw = readFileSync(shaPath, "utf8").trim();
    if (/^[a-f0-9]{64}$/i.test(raw)) return raw.toLowerCase();
  } catch {
    // Fallback to pinned demo-v1 SHA-256 in serverless bundles
  }
  return DEFAULT_DEMO_V1_SHA256;
}

function buildBuiltinDemoV1Inventory() {
  const docs: any[] = Array.isArray((demoManifest as any)?.documents)
    ? (demoManifest as any).documents
    : [];

  let totalChunks = 0;
  let reviewedChunks = 0;

  const records = docs.map((doc) => {
    const provisions: any[] = Array.isArray(doc.provisions) ? doc.provisions : [];
    totalChunks += provisions.length;
    const reviewedCount = provisions.filter(
      (p) => Boolean(p?.reviewed_by && p?.reviewed_at && p?.status_evidence_url)
    ).length;
    reviewedChunks += reviewedCount;
    return {
      doc_id: String(doc.document_id || "").toUpperCase().replace(/\s+/g, ""),
      doc_title: String(doc.title || ""),
      source_url: String(doc.source_url || ""),
      total_versions: provisions.length,
      reviewed_versions: reviewedCount
    };
  });

  return {
    snapshot_id: String((demoManifest as any)?.snapshot_id || "askpay-demo-source-checked-2026-11-17"),
    snapshot_sha256: resolveDemoSnapshotSha256(),
    corpus_status: "REVIEW_ASSERTED",
    review_level: "AI_ASSISTED_SOURCE_CHECK_ONLY",
    coverage: "SELECTED_DEMO_PROVISIONS",
    settlement_eligible: false,
    total_documents: records.length,
    total_chunks: totalChunks,
    reviewed_chunks: reviewedChunks,
    domain: "Import-Export & Vietnam Customs Law",
    records
  };
}

const BUILTIN_DEMO_V1_INVENTORY = buildBuiltinDemoV1Inventory();

export async function GET() {
  const askUrl = (
    process.env.AI_SERVICE_URL ||
    process.env.LEGAL_RAG_API_URL ||
    "http://127.0.0.1:8000/api/v1/legal/ask"
  ).trim();
  const corpusUrl = (
    process.env.LEGAL_CORPUS_API_URL || askUrl.replace(/\/ask\/?$/, "/corpus")
  ).trim();

  if (corpusUrl === askUrl) {
    return NextResponse.json(BUILTIN_DEMO_V1_INVENTORY, { status: 200 });
  }

  const result = await fetchLegalCorpus(corpusUrl);
  if (result.status === 503) {
    if (process.env.ASKPAY_ENABLE_BUILTIN_DEMO === "false") {
      return NextResponse.json(result.body, { status: 503 });
    }
    return NextResponse.json(BUILTIN_DEMO_V1_INVENTORY, { status: 200 });
  }
  return NextResponse.json(result.body, { status: result.status });
}
