import { NextResponse } from "next/server";
import { fetchLegalCorpus } from "../ask-and-settle/legal-proxy.mjs";

export const dynamic = "force-dynamic";

type BuiltinCorpusRow = readonly [
  doc_id: string,
  doc_title: string,
  article: string,
  clause: string,
  status: "ACTIVE" | "EXPIRED",
  effective_date: string
];

const BUILTIN_CORPUS_ROWS: BuiltinCorpusRow[] = [
  ["128/2020/NĐ-CP", "Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan", "9", "1", "ACTIVE", "2020-12-10"],
  ["38/2015/TT-BTC", "Thông tư quy định về thủ tục hải quan; kiểm tra, giám sát hải quan; thuế xuất khẩu, thuế nhập khẩu", "18", "1", "ACTIVE", "2015-04-01"],
  ["39/2018/TT-BTC", "Thông tư sửa đổi, bổ sung một số điều tại Thông tư 38/2015/TT-BTC về thủ tục hải quan", "1", "7", "ACTIVE", "2018-06-05"],
  ["31/2018/NĐ-CP", "Nghị định quy định chi tiết Luật Quản lý ngoại thương về xuất xứ hàng hóa (C/O)", "15", "1", "ACTIVE", "2018-03-08"],
  ["107/2016/QH13", "Luật Thuế xuất khẩu, thuế nhập khẩu năm 2016", "19", "1", "ACTIVE", "2016-09-01"],
  ["54/2014/QH13", "Luật Hải quan năm 2014", "25", "1", "ACTIVE", "2015-01-01"],
  ["43/2017/NĐ-CP", "Nghị định về nhãn hàng hóa (được sửa đổi bởi Nghị định 111/2021/NĐ-CP)", "7", "3", "ACTIVE", "2017-06-01"],
  ["05/2017/QH14", "Luật Quản lý ngoại thương năm 2017", "67", "1", "ACTIVE", "2018-01-01"],
  ["36/2005/QH11", "Luật Thương mại năm 2005", "28", "1", "ACTIVE", "2006-01-01"],
  ["38/2019/QH14", "Luật Quản lý thuế năm 2019", "42", "1", "ACTIVE", "2020-07-01"],
  ["08/2015/NĐ-CP", "Nghị định quy định chi tiết và biện pháp thi hành Luật Hải quan về thủ tục hải quan, kiểm tra, giám sát, kiểm soát hải quan", "19", "1", "ACTIVE", "2015-03-15"],
  ["59/2018/NĐ-CP", "Nghị định sửa đổi, bổ sung một số điều của Nghị định 08/2015/NĐ-CP về thủ tục hải quan, kiểm tra, giám sát, kiểm soát hải quan", "1", "9", "ACTIVE", "2018-06-05"],
  ["69/2018/NĐ-CP", "Nghị định quy định chi tiết một số điều của Luật Quản lý ngoại thương", "13", "1", "ACTIVE", "2018-05-15"],
  ["134/2016/NĐ-CP", "Nghị định quy định chi tiết một số điều và biện pháp thi hành Luật Thuế xuất khẩu, thuế nhập khẩu", "10", "1", "ACTIVE", "2016-09-01"],
  ["18/2021/NĐ-CP", "Nghị định sửa đổi, bổ sung một số điều của Nghị định 134/2016/NĐ-CP hướng dẫn Luật Thuế xuất khẩu, thuế nhập khẩu", "1", "6", "ACTIVE", "2021-04-25"],
  ["102/2021/NĐ-CP", "Nghị định sửa đổi, bổ sung các Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực thuế, hóa đơn; hải quan", "2", "1", "ACTIVE", "2022-01-01"],
  ["126/2020/NĐ-CP", "Nghị định quy định chi tiết một số điều của Luật Quản lý thuế", "21", "1", "ACTIVE", "2020-12-05"],
  ["111/2021/NĐ-CP", "Nghị định sửa đổi, bổ sung một số điều Nghị định 43/2017/NĐ-CP về nhãn hàng hóa", "1", "5", "ACTIVE", "2022-02-15"],
  ["14/2015/TT-BTC", "Thông tư hướng dẫn về phân loại hàng hóa, phân tích để phân loại hàng hóa; phân tích để kiểm tra chất lượng, kiểm tra an toàn thực phẩm", "4", "1", "ACTIVE", "2015-03-16"],
  ["17/2021/TT-BTC", "Thông tư sửa đổi, bổ sung một số điều tại Thông tư 14/2015/TT-BTC hướng dẫn về phân loại hàng hóa, phân tích để phân loại hàng hóa", "1", "3", "ACTIVE", "2021-04-12"],
  ["39/2015/TT-BTC", "Thông tư quy định về trị giá hải quan đối với hàng hóa xuất khẩu, nhập khẩu", "5", "1", "ACTIVE", "2015-04-01"],
  ["60/2019/TT-BTC", "Thông tư sửa đổi, bổ sung một số điều của Thông tư 39/2015/TT-BTC quy định về trị giá hải quan", "1", "4", "ACTIVE", "2019-10-15"],
  ["06/2021/TT-BTC", "Thông tư hướng dẫn thi hành một số điều của Luật Quản lý thuế đối với hàng hóa xuất khẩu, nhập khẩu", "13", "1", "ACTIVE", "2021-03-08"],
  ["05/2018/TT-BCT", "Thông tư quy định về xuất xứ hàng hóa", "6", "1", "ACTIVE", "2018-04-03"],
  ["38/2018/TT-BCT", "Thông tư quy định thực hiện chứng nhận xuất xứ hàng hóa theo chế độ ưu đãi thuế quan phổ cập (GSP)", "4", "1", "ACTIVE", "2018-12-14"],
  ["22/2016/TT-BCT", "Thông tư thực hiện Quy tắc xuất xứ hàng hóa trong Hiệp định Thương mại hàng hóa ASEAN (ATIGA)", "2", "1", "ACTIVE", "2016-11-15"],
  ["11/2020/TT-BCT", "Thông tư quy định Quy tắc xuất xứ hàng hóa trong Hiệp định Thương mại tự do giữa Việt Nam và Liên minh Châu Âu (EVFTA)", "5", "1", "ACTIVE", "2020-08-01"],
  ["03/2019/TT-BCT", "Thông tư quy định Quy tắc xuất xứ hàng hóa trong Hiệp định Đối tác Toàn diện và Tiến bộ xuyên Thái Bình Dương (CPTPP)", "4", "1", "ACTIVE", "2019-03-08"],
  ["12/2019/TT-BCT", "Thông tư quy định Quy tắc xuất xứ hàng hóa trong Hiệp định khung về hợp tác kinh tế toàn diện ASEAN - Trung Quốc (ACFTA)", "1", "1", "ACTIVE", "2019-09-12"],
  ["10/2022/TT-BCT", "Thông tư sửa đổi, bổ sung các Thông tư quy định thực hiện Quy tắc xuất xứ hàng hóa trong Hiệp định ATIGA", "1", "1", "ACTIVE", "2022-07-16"],
  ["03/2023/TT-BCT", "Thông tư sửa đổi, bổ sung một số điều của Thông tư 22/2016/TT-BCT thực hiện Quy tắc xuất xứ hàng hóa trong Hiệp định ATIGA", "1", "1", "ACTIVE", "2023-04-01"],
  ["167/2025/NĐ-CP", "Nghị định sửa đổi, bổ sung một số điều của Nghị định 08/2015/NĐ-CP về thủ tục hải quan, kiểm tra, giám sát, kiểm soát hải quan", "1", "1", "ACTIVE", "2025-08-15"],
  ["182/2025/NĐ-CP", "Nghị định sửa đổi, bổ sung một số điều của Nghị định 134/2016/NĐ-CP hướng dẫn Luật Thuế xuất khẩu, thuế nhập khẩu", "1", "1", "ACTIVE", "2025-09-01"],
  ["23/2025/TT-BCT", "Thông tư sửa đổi, bổ sung Thông tư 05/2018/TT-BCT và Thông tư 38/2018/TT-BCT về xuất xứ hàng hóa", "1", "1", "ACTIVE", "2025-07-01"],
  ["121/2025/TT-BTC", "Thông tư sửa đổi, bổ sung quy định về thủ tục hải quan và quản lý thuế đối với hàng hóa xuất khẩu, nhập khẩu", "1", "1", "ACTIVE", "2025-10-01"],
  ["85/2026/TT-BTC", "Thông tư hướng dẫn nghiệp vụ hải quan và quản lý thuế đối với hàng hóa xuất nhập khẩu", "2", "1", "ACTIVE", "2026-03-01"],
  ["373/2025/NĐ-CP", "Nghị định quy định về quản lý hải quan và thủ tục xuất nhập khẩu", "4", "1", "ACTIVE", "2025-12-01"],
  ["108/2025/QH15", "Luật sửa đổi, bổ sung một số điều của các luật trong lĩnh vực tài chính, thuế và hải quan", "1", "1", "ACTIVE", "2026-07-01"],
  ["142/2026/TT-BTC", "Thông tư quy định biểu mẫu và chứng từ nghiệp vụ hải quan, thuế xuất nhập khẩu", "1", "1", "ACTIVE", "2026-11-16"],
  ["54/2014/QH13", "Luật Hải quan năm 2014", "24", "1", "ACTIVE", "2015-01-01"],
  ["107/2016/QH13", "Luật Thuế xuất khẩu, thuế nhập khẩu năm 2016", "16", "1", "ACTIVE", "2016-09-01"],
  ["128/2020/NĐ-CP", "Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan", "7", "1", "ACTIVE", "2020-12-10"],
  ["08/2015/NĐ-CP", "Nghị định quy định chi tiết và biện pháp thi hành Luật Hải quan về thủ tục hải quan, kiểm tra, giám sát, kiểm soát hải quan", "25", "1", "ACTIVE", "2015-03-15"],
  ["38/2015/TT-BTC", "Thông tư quy định về thủ tục hải quan; kiểm tra, giám sát hải quan; thuế xuất khẩu, thuế nhập khẩu", "20", "1", "ACTIVE", "2015-04-01"],
  ["31/2018/NĐ-CP", "Nghị định quy định chi tiết Luật Quản lý ngoại thương về xuất xứ hàng hóa (C/O)", "14", "1", "ACTIVE", "2018-03-08"],
  ["128/2013/TT-BTC", "Thông tư quy định về thủ tục hải quan; kiểm tra, giám sát hải quan; thuế xuất khẩu, thuế nhập khẩu (ĐÃ HẾT HIỆU LỰC)", "10", "1", "EXPIRED", "2013-11-01"],
  ["45/2016/NĐ-CP", "Nghị định sửa đổi, bổ sung một số điều của Nghị định 127/2013/NĐ-CP quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan (ĐÃ HẾT HIỆU LỰC)", "1", "4", "EXPIRED", "2016-08-01"],
  ["155/2016/TT-BTC", "Thông tư quy định chi tiết thi hành Nghị định 127/2013/NĐ-CP và Nghị định 45/2016/NĐ-CP về xử phạt vi phạm hành chính trong lĩnh vực hải quan (ĐÃ HẾT HIỆU LỰC)", "3", "1", "EXPIRED", "2016-12-01"],
  ["127/2013/NĐ-CP", "Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan (ĐÃ HẾT HIỆU LỰC)", "8", "1", "EXPIRED", "2014-01-01"]
];

const BUILTIN_CORPUS_INVENTORY = {
  total_documents: new Set(BUILTIN_CORPUS_ROWS.map((row) => row[0])).size,
  total_chunks: BUILTIN_CORPUS_ROWS.length,
  corpus_status: "DEMO_UNVERIFIED",
  domain: "Import-Export & Vietnam Customs Law",
  records: BUILTIN_CORPUS_ROWS.map(
    ([doc_id, doc_title, article, clause, status, effective_date]) => ({
      doc_id,
      doc_title,
      article,
      clause,
      status,
      effective_date
    })
  )
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
