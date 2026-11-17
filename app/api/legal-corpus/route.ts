import { NextResponse } from "next/server";
import { fetchLegalCorpus } from "../ask-and-settle/legal-proxy.mjs";
import corpusBundle from "../../../data/legal-corpus.json";
import sourceManifest from "../../../research/legal-sources/manifest.json";

export const dynamic = "force-dynamic";

const SOURCE_URL_BY_DOC_ID = new Map<string, string>(
  ((sourceManifest as any)?.documents || [])
    .filter((d: any) => typeof d?.document_id === "string" && typeof d?.metadata_url === "string")
    .map((d: any) => [d.document_id.toUpperCase().replace(/\s+/g, ""), d.metadata_url])
);

function buildBuiltinCorpusInventory() {
  const rows: any[] = Array.isArray((corpusBundle as any)?.records)
    ? (corpusBundle as any).records
    : [];

  const summary = new Map<
    string,
    {
      doc_id: string;
      doc_title: string;
      article: string;
      clause: string;
      status: "ACTIVE" | "EXPIRED";
      effective_date: string;
      source_url?: string;
      total_versions: number;
      reviewed_versions: number;
    }
  >();

  for (const r of rows) {
    const docId = String(r.doc_id || "");
    if (!docId) continue;
    const key = docId.toUpperCase().replace(/\s+/g, "");
    const existing = summary.get(key);
    if (!existing) {
      summary.set(key, {
        doc_id: docId,
        doc_title: String(r.doc_title || ""),
        article: String(r.article || "1"),
        clause: String(r.clause || "1"),
        status: r.status === "EXPIRED" ? "EXPIRED" : "ACTIVE",
        effective_date: String(r.effective_date || ""),
        ...(SOURCE_URL_BY_DOC_ID.get(key) ? { source_url: SOURCE_URL_BY_DOC_ID.get(key) } : {}),
        total_versions: 1,
        reviewed_versions: r.verified ? 1 : 0
      });
    } else {
      existing.total_versions += 1;
      if (r.verified) existing.reviewed_versions += 1;
    }
  }

  return {
    total_documents: summary.size,
    total_chunks: rows.length,
    reviewed_chunks: Number((corpusBundle as any)?.verified_chunks || 0),
    extracted_unreviewed_chunks: Number((corpusBundle as any)?.unreviewed_extracted_chunks || 0),
    corpus_status: "DEMO_UNVERIFIED",
    domain: "Import-Export & Vietnam Customs Law",
    records: Array.from(summary.values())
  };
}

const BUILTIN_CORPUS_INVENTORY = buildBuiltinCorpusInventory();

export async function GET() {
  const askUrl =
    process.env.AI_SERVICE_URL ||
    process.env.LEGAL_RAG_API_URL ||
    "http://127.0.0.1:8000/api/v1/legal/ask";
  const corpusUrl =
    process.env.LEGAL_CORPUS_API_URL || askUrl.replace(/\/ask\/?$/, "/corpus");

  if (corpusUrl === askUrl) {
    return NextResponse.json(BUILTIN_CORPUS_INVENTORY, { status: 200 });
  }

  const result = await fetchLegalCorpus(corpusUrl);
  if (result.status === 503) {
    if (process.env.ASKPAY_ENABLE_BUILTIN_DEMO === "false") {
      return NextResponse.json(result.body, { status: 503 });
    }
    return NextResponse.json(BUILTIN_CORPUS_INVENTORY, { status: 200 });
  }
  return NextResponse.json(result.body, { status: result.status });
}
