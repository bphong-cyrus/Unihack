import { NextResponse } from "next/server";
import { fetchLegalCorpus } from "../ask-and-settle/legal-proxy.mjs";

export const dynamic = "force-dynamic";

const BUILTIN_CORPUS_INVENTORY = {
  total_documents: 8,
  total_chunks: 8,
  corpus_status: "DEMO_UNVERIFIED",
  domain: "Import-Export & Vietnam Customs Law",
  records: [
    {
      doc_id: "128/2020/NĐ-CP",
      doc_title: "Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan",
      article: "9",
      clause: "1",
      status: "ACTIVE",
      effective_date: "2020-12-10"
    },
    {
      doc_id: "38/2015/TT-BTC",
      doc_title: "Thông tư quy định về thủ tục hải quan; kiểm tra, giám sát hải quan; thuế xuất khẩu, thuế nhập khẩu",
      article: "18",
      clause: "1",
      status: "ACTIVE",
      effective_date: "2015-04-01"
    },
    {
      doc_id: "39/2018/TT-BTC",
      doc_title: "Thông tư sửa đổi, bổ sung một số điều tại Thông tư 38/2015/TT-BTC về thủ tục hải quan",
      article: "1",
      clause: "7",
      status: "ACTIVE",
      effective_date: "2018-06-05"
    },
    {
      doc_id: "31/2018/NĐ-CP",
      doc_title: "Nghị định quy định chi tiết Luật Quản lý ngoại thương về xuất xứ hàng hóa (C/O)",
      article: "15",
      clause: "1",
      status: "ACTIVE",
      effective_date: "2018-03-08"
    },
    {
      doc_id: "107/2016/QH13",
      doc_title: "Luật Thuế xuất khẩu, thuế nhập khẩu năm 2016",
      article: "19",
      clause: "1",
      status: "ACTIVE",
      effective_date: "2016-09-01"
    },
    {
      doc_id: "54/2014/QH13",
      doc_title: "Luật Hải quan năm 2014",
      article: "25",
      clause: "1",
      status: "ACTIVE",
      effective_date: "2015-01-01"
    },
    {
      doc_id: "43/2017/NĐ-CP",
      doc_title: "Nghị định về nhãn hàng hóa (được sửa đổi bởi Nghị định 111/2021/NĐ-CP)",
      article: "7",
      clause: "3",
      status: "ACTIVE",
      effective_date: "2017-06-01"
    },
    {
      doc_id: "127/2013/NĐ-CP",
      doc_title: "Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan (ĐÃ HẾT HIỆU LỰC)",
      article: "8",
      clause: "1",
      status: "EXPIRED",
      effective_date: "2014-01-01"
    }
  ]
};

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
    return NextResponse.json(BUILTIN_CORPUS_INVENTORY, { status: 200 });
  }
  return NextResponse.json(result.body, { status: result.status });
}
