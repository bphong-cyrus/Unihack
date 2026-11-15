import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toBytes
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";
import { forwardLegalQuestion } from "./legal-proxy.mjs";

export const maxDuration = 30;

const BUILTIN_CORPUS: Record<
  string,
  { doc_title: string; status: "ACTIVE" | "EXPIRED"; raw_text: string }
> = {
  "128/2020/NĐ-CP#9#1": {
    doc_title: "Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan",
    status: "ACTIVE",
    raw_text:
      "Phạt 20% tính trên số tiền thuế khai thiếu hoặc số tiền thuế được miễn, giảm, hoàn, không thu cao hơn so với quy định của pháp luật về thuế đối với hành vi khai sai mã số hàng hóa, thuế suất, mức thuế đối với hàng hóa xuất khẩu, nhập khẩu dẫn đến thiếu số tiền thuế phải nộp mà bị cơ quan hải quan phát hiện trong quá trình kiểm tra sau thông quan."
  },
  "38/2015/TT-BTC#18#1": {
    doc_title:
      "Thông tư quy định về thủ tục hải quan; kiểm tra, giám sát hải quan; thuế xuất khẩu, thuế nhập khẩu",
    status: "ACTIVE",
    raw_text:
      "Người khai hải quan phải khai đầy đủ các thông tin trên tờ khai hải quan theo các chỉ tiêu thông tin quy định tại mẫu số 01 hoặc mẫu số 02 Phụ lục II ban hành kèm theo Thông tư này và gửi các chứng từ thuộc hồ sơ hải quan cho cơ quan hải quan qua hệ thống xử lý dữ liệu điện tử hải quan."
  },
  "39/2018/TT-BTC#1#7": {
    doc_title: "Thông tư sửa đổi, bổ sung một số điều tại Thông tư 38/2015/TT-BTC về thủ tục hải quan",
    status: "ACTIVE",
    raw_text:
      "Người khai hải quan được khai bổ sung hồ sơ hải quan sau khi Hệ thống phân luồng tờ khai nhưng trước thời điểm cơ quan hải quan thông báo việc kiểm tra trực tiếp hồ sơ hải quan hoặc kiểm tra thực tế hàng hóa."
  },
  "31/2018/NĐ-CP#15#1": {
    doc_title: "Nghị định quy định chi tiết Luật Quản lý ngoại thương về xuất xứ hàng hóa (C/O)",
    status: "ACTIVE",
    raw_text:
      "Thương nhân đề nghị cấp Giấy chứng nhận xuất xứ hàng hóa (C/O) lần đầu phải đăng ký Hồ sơ thương nhân với cơ quan, tổ chức cấp Giấy chứng nhận xuất xứ hàng hóa thông qua Hệ thống quản lý và cấp chứng nhận xuất xứ điện tử."
  },
  "107/2016/QH13#19#1": {
    doc_title: "Luật Thuế xuất khẩu, thuế nhập khẩu năm 2016",
    status: "ACTIVE",
    raw_text:
      "Người nộp thuế đã nộp thuế nhập khẩu nhưng hàng hóa nhập khẩu phải tái xuất được hoàn thuế nhập khẩu và không phải nộp thuế xuất khẩu khi hàng hóa chưa qua sử dụng, gia công, chế biến tại Việt Nam."
  },
  "54/2014/QH13#25#1": {
    doc_title: "Luật Hải quan năm 2014",
    status: "ACTIVE",
    raw_text:
      "Đối với hàng hóa nhập khẩu, nộp trước ngày hàng hóa đến cửa khẩu hoặc trong thời hạn 30 ngày kể từ ngày hàng hóa đến cửa khẩu."
  },
  "43/2017/NĐ-CP#7#3": {
    doc_title: "Nghị định về nhãn hàng hóa (được sửa đổi bởi Nghị định 111/2021/NĐ-CP)",
    status: "ACTIVE",
    raw_text:
      "Hàng hóa nhập khẩu vào Việt Nam mà trên nhãn chưa thể hiện hoặc thể hiện chưa đủ những nội dung bắt buộc bằng tiếng Việt thì phải có nhãn phụ thể hiện những nội dung bắt buộc bằng tiếng Việt và giữ nguyên nhãn gốc của hàng hóa."
  },
  "127/2013/NĐ-CP#8#1": {
    doc_title: "Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan (ĐÃ HẾT HIỆU LỰC)",
    status: "EXPIRED",
    raw_text:
      "Phạt tiền từ 1.000.000 đồng đến 3.000.000 đồng đối với hành vi không khai hoặc khai sai so với thực tế về tên hàng, chủng loại, số lượng hàng hóa xuất khẩu, nhập khẩu."
  }
};

function normalizeVn(s: string): string {
  return (s || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function computeExcerptSimilarityTS(excerpt: string, rawText: string): number {
  const normEx = normalizeVn(excerpt);
  const normSrc = normalizeVn(rawText);
  const exWords = normEx.split(" ").filter(Boolean);
  if (exWords.length < 10 || !normSrc) return 0;
  if (normSrc.includes(normEx)) return 1.0;

  const srcWords = new Set(normSrc.split(" ").filter(Boolean));
  const matched = exWords.filter((w) => srcWords.has(w)).length;
  const wordRatio = matched / exWords.length;
  const coverageBound = Math.min(1.0, normSrc.length / normEx.length);
  return Number(Math.min(wordRatio, coverageBound).toFixed(4));
}

function runBuiltinMockLegalQA(
  questionId: string,
  question: string,
  tier: string,
  simulateHallucination: boolean,
  simulateExpiredLaw: boolean
) {
  let answer = "";
  let citations: Array<{
    document: string;
    document_title: string;
    article: string;
    clause: string;
    excerpt: string;
  }> = [];

  const qLower = question.toLowerCase();

  if (simulateExpiredLaw) {
    answer =
      "Theo Khoản 1 Điều 8 Nghị định 127/2013/NĐ-CP, hành vi khai sai tên hàng, số lượng hàng hóa xuất nhập khẩu bị phạt từ 1.000.000 đồng đến 3.000.000 đồng.";
    citations = [
      {
        document: "127/2013/NĐ-CP",
        document_title: "Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan",
        article: "8",
        clause: "1",
        excerpt:
          "Phạt tiền từ 1.000.000 đồng đến 3.000.000 đồng đối với hành vi không khai hoặc khai sai so với thực tế về tên hàng, chủng loại, số lượng hàng hóa xuất khẩu, nhập khẩu."
      }
    ];
  } else if (simulateHallucination) {
    answer =
      "Theo Khoản 1 Điều 9 Nghị định 128/2020/NĐ-CP, doanh nghiệp nhập khẩu khai sai mã HS lần đầu được miễn phạt 100% và được thông quan luồng xanh tự động tại mọi chi cục hải quan.";
    citations = [
      {
        document: "128/2020/NĐ-CP",
        document_title: "Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan",
        article: "9",
        clause: "1",
        excerpt:
          "Doanh nghiệp nhập khẩu khai sai mã HS lần đầu được miễn phạt hoàn toàn 100% và được ưu tiên thông quan luồng xanh tự động tại cửa khẩu."
      }
    ];
  } else if (
    (qLower.includes("c/o") || qLower.includes("chứng nhận xuất xứ")) &&
    qLower.includes("thương nhân") &&
    (qLower.includes("đăng ký") || qLower.includes("hồ sơ"))
  ) {
    answer =
      "Theo quy định tại Khoản 1 Điều 15 Nghị định 31/2018/NĐ-CP, doanh nghiệp xuất nhập khẩu đề nghị cấp Giấy chứng nhận xuất xứ hàng hóa (C/O) lần đầu bắt buộc phải đăng ký Hồ sơ thương nhân thông qua Hệ thống quản lý và cấp chứng nhận xuất xứ điện tử trước khi nộp bộ hồ sơ C/O.";
    citations = [
      {
        document: "31/2018/NĐ-CP",
        document_title:
          "Nghị định quy định chi tiết Luật Quản lý ngoại thương về xuất xứ hàng hóa (C/O)",
        article: "15",
        clause: "1",
        excerpt:
          "Thương nhân đề nghị cấp Giấy chứng nhận xuất xứ hàng hóa (C/O) lần đầu phải đăng ký Hồ sơ thương nhân với cơ quan, tổ chức cấp Giấy chứng nhận xuất xứ hàng hóa thông qua Hệ thống quản lý và cấp chứng nhận xuất xứ điện tử."
      }
    ];
  } else if (
    qLower.includes("hoàn thuế") &&
    qLower.includes("nhập khẩu") &&
    qLower.includes("tái xuất")
  ) {
    answer =
      "Theo Khoản 1 Điều 19 Luật Thuế xuất khẩu, thuế nhập khẩu 2016 (Luật số 107/2016/QH13), doanh nghiệp đã nộp thuế nhập khẩu nhưng hàng hóa nhập khẩu phải tái xuất sẽ được hoàn thuế nhập khẩu và không phải nộp thuế xuất khẩu với điều kiện hàng hóa đó chưa qua sử dụng, gia công, chế biến tại Việt Nam.";
    citations = [
      {
        document: "107/2016/QH13",
        document_title: "Luật Thuế xuất khẩu, thuế nhập khẩu năm 2016",
        article: "19",
        clause: "1",
        excerpt:
          "Người nộp thuế đã nộp thuế nhập khẩu nhưng hàng hóa nhập khẩu phải tái xuất được hoàn thuế nhập khẩu và không phải nộp thuế xuất khẩu khi hàng hóa chưa qua sử dụng, gia công, chế biến tại Việt Nam."
      }
    ];
  } else if (
    qLower.includes("thời hạn") &&
    qLower.includes("tờ khai") &&
    qLower.includes("nhập khẩu")
  ) {
    answer =
      "Theo Điểm b Khoản 1 Điều 25 Luật Hải quan 2014 (Luật số 54/2014/QH13), đối với hàng hóa nhập khẩu, người khai hải quan phải nộp tờ khai hải quan trước ngày hàng hóa đến cửa khẩu hoặc trong thời hạn 30 ngày kể từ ngày hàng hóa đến cửa khẩu.";
    citations = [
      {
        document: "54/2014/QH13",
        document_title: "Luật Hải quan năm 2014",
        article: "25",
        clause: "1",
        excerpt:
          "Đối với hàng hóa nhập khẩu, nộp trước ngày hàng hóa đến cửa khẩu hoặc trong thời hạn 30 ngày kể từ ngày hàng hóa đến cửa khẩu."
      }
    ];
  } else if (qLower.includes("khai bổ sung") && qLower.includes("phân luồng")) {
    answer =
      "Theo Khoản 7 Điều 1 Thông tư 39/2018/TT-BTC, người khai hải quan được phép khai bổ sung hồ sơ hải quan sau khi Hệ thống phân luồng tờ khai nhưng trước thời điểm cơ quan hải quan thông báo kiểm tra trực tiếp hồ sơ hoặc kiểm tra thực tế hàng hóa.";
    citations = [
      {
        document: "39/2018/TT-BTC",
        document_title:
          "Thông tư sửa đổi, bổ sung một số điều tại Thông tư 38/2015/TT-BTC về thủ tục hải quan",
        article: "1",
        clause: "7",
        excerpt:
          "Người khai hải quan được khai bổ sung hồ sơ hải quan sau khi Hệ thống phân luồng tờ khai nhưng trước thời điểm cơ quan hải quan thông báo việc kiểm tra trực tiếp hồ sơ hải quan hoặc kiểm tra thực tế hàng hóa."
      }
    ];
  } else if (
    qLower.includes("nhãn phụ") ||
    (qLower.includes("nhãn hàng hóa") && qLower.includes("nhập khẩu"))
  ) {
    answer =
      "Theo Khoản 3 Điều 7 Nghị định 43/2017/NĐ-CP (được sửa đổi, bổ sung bởi Nghị định 111/2021/NĐ-CP), hàng hóa nhập khẩu vào Việt Nam mà trên nhãn gốc chưa thể hiện đủ nội dung bắt buộc bằng tiếng Việt thì bắt buộc phải có nhãn phụ thể hiện những nội dung bắt buộc bằng tiếng Việt và giữ nguyên nhãn gốc.";
    citations = [
      {
        document: "43/2017/NĐ-CP",
        document_title: "Nghị định về nhãn hàng hóa (được sửa đổi bởi Nghị định 111/2021/NĐ-CP)",
        article: "7",
        clause: "3",
        excerpt:
          "Hàng hóa nhập khẩu vào Việt Nam mà trên nhãn chưa thể hiện hoặc thể hiện chưa đủ những nội dung bắt buộc bằng tiếng Việt thì phải có nhãn phụ thể hiện những nội dung bắt buộc bằng tiếng Việt và giữ nguyên nhãn gốc của hàng hóa."
      }
    ];
  } else if (
    qLower.includes("chỉ tiêu thông tin") ||
    (qLower.includes("tờ khai hải quan") && qLower.includes("hệ thống xử lý dữ liệu điện tử"))
  ) {
    answer =
      "Theo Khoản 1 Điều 18 Thông tư 38/2015/TT-BTC, người khai hải quan phải khai đầy đủ các thông tin trên tờ khai hải quan theo các chỉ tiêu thông tin quy định và gửi các chứng từ thuộc hồ sơ hải quan qua hệ thống xử lý dữ liệu điện tử hải quan.";
    citations = [
      {
        document: "38/2015/TT-BTC",
        document_title:
          "Thông tư quy định về thủ tục hải quan; kiểm tra, giám sát hải quan; thuế xuất khẩu, thuế nhập khẩu",
        article: "18",
        clause: "1",
        excerpt:
          "Người khai hải quan phải khai đầy đủ các thông tin trên tờ khai hải quan theo các chỉ tiêu thông tin quy định tại mẫu số 01 hoặc mẫu số 02 Phụ lục II ban hành kèm theo Thông tư này và gửi các chứng từ thuộc hồ sơ hải quan cho cơ quan hải quan qua hệ thống xử lý dữ liệu điện tử hải quan."
      }
    ];
  } else if (
    (qLower.includes("mã hs") || qLower.includes("mã số hàng")) &&
    (qLower.includes("sai") || qLower.includes("nhầm")) &&
    (qLower.includes("phạt") || qLower.includes("xử lý") || qLower.includes("sau thông quan"))
  ) {
    answer =
      "Theo quy định tại Khoản 1 Điều 9 Nghị định 128/2020/NĐ-CP, trường hợp doanh nghiệp xuất nhập khẩu khai sai mã số hàng hóa (mã HS), thuế suất dẫn đến thiếu số tiền thuế phải nộp mà bị cơ quan hải quan phát hiện trong quá trình kiểm tra sau thông quan thì bị phạt 20% tính trên số tiền thuế khai thiếu.";
    if (tier === "deep") {
      answer +=
        "\n\nLưu ý thực tế cho bộ phận XNK: Ngoài tiền phạt 20% trên số thuế khai thiếu, doanh nghiệp vẫn phải nộp đủ số tiền thuế truy thu và tiền chậm nộp theo Luật Quản lý thuế. Nếu doanh nghiệp tự nguyện phát hiện sai sót và khai bổ sung trước thời điểm có quyết định kiểm tra sau thông quan thì có thể giảm thiểu rủi ro chế tài tùy hồ sơ.";
    }
    citations = [
      {
        document: "128/2020/NĐ-CP",
        document_title: "Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan",
        article: "9",
        clause: "1",
        excerpt:
          "Phạt 20% tính trên số tiền thuế khai thiếu hoặc số tiền thuế được miễn, giảm, hoàn, không thu cao hơn so với quy định của pháp luật về thuế đối với hành vi khai sai mã số hàng hóa, thuế suất, mức thuế đối với hàng hóa xuất khẩu, nhập khẩu"
      }
    ];
  } else {
    answer =
      "Hiện chưa tìm thấy điều khoản pháp luật Hải quan và Xuất nhập khẩu phù hợp trong kho văn bản để đối chiếu câu hỏi này. Nếu đã khóa cọc Escrow, Smart Contract sẽ tự động hoàn trả 100%.";
    citations = [];
  }

  const checks = citations.map((c) => {
    const docId = c.document.toUpperCase().replace(/\s+/g, "");
    const key = `${docId}#${c.article}#${c.clause}`;
    const docExists = Object.keys(BUILTIN_CORPUS).some((k) =>
      k.toUpperCase().startsWith(`${docId}#`)
    );
    const rec = Object.entries(BUILTIN_CORPUS).find(
      ([k]) => k.toUpperCase() === key
    )?.[1];
    const artClauseExists = Boolean(rec);
    const isInForce = Boolean(rec && rec.status === "ACTIVE");
    const similarity = rec ? computeExcerptSimilarityTS(c.excerpt, rec.raw_text) : 0;

    let failReason: string | null = null;
    if (!docExists) failReason = "DOCUMENT_NOT_IN_CORPUS";
    else if (!artClauseExists) failReason = "ARTICLE_OR_CLAUSE_NOT_FOUND";
    else if (!isInForce) failReason = "DOCUMENT_EXPIRED_OR_REPLACED";
    else if (similarity < 0.9)
      failReason = `EXCERPT_SIMILARITY_TOO_LOW (${(similarity * 100).toFixed(1)}% < 90%)`;

    const itemScore =
      (docExists ? 25 : 0) +
      (artClauseExists ? 25 : 0) +
      (isInForce ? 20 : 0) +
      30 * similarity;

    return {
      document: docId,
      article: c.article,
      clause: c.clause,
      doc_exists: docExists,
      article_clause_exists: artClauseExists,
      is_in_force: isInForce,
      excerpt_similarity: similarity,
      threshold_required: 0.9,
      raw_text: rec?.raw_text || c.excerpt || "",
      status: (failReason ? "FAIL" : "PASS") as "PASS" | "FAIL",
      fail_reason: failReason,
      _score: itemScore
    };
  });

  const allPassed = checks.length > 0 && checks.every((c) => c.status === "PASS");
  const overallScore =
    checks.length > 0
      ? Number((checks.reduce((s, c) => s + c._score, 0) / checks.length).toFixed(2))
      : 0;

  return {
    question_id: questionId,
    tier,
    answer,
    citations,
    validation: {
      passed: allPassed,
      verdict: allPassed ? "VERIFIED_RELEASE" : "UNVERIFIED_REFUND",
      settlement_eligible: false,
      corpus_status: "DEMO_UNVERIFIED",
      overall_score: overallScore,
      citation_checks: checks.map(({ _score, ...rest }) => rest),
      ...(checks.length === 0 ? { fail_reason: "NO_CITATION_PROVIDED" } : {})
    },
    demo: true
  };
}

const ESCROW_ABI = [
  {
    name: "escrows",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "questionId", type: "bytes32" }],
    outputs: [
      { name: "asker", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "tier", type: "uint8" },
      { name: "status", type: "uint8" },
      { name: "createdAt", type: "uint256" },
      { name: "questionHash", type: "bytes32" },
      { name: "l1ReceiptHash", type: "bytes32" },
      { name: "validatorScore", type: "uint16" }
    ]
  },
  {
    name: "resolveQuestion",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "questionId", type: "bytes32" },
      { name: "passed", type: "bool" },
      { name: "validatorScore", type: "uint16" },
      { name: "l1ReceiptHash", type: "bytes32" }
    ],
    outputs: []
  }
] as const;

const RECEIPT_ABI = [
  {
    name: "recordReceipt",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "questionId", type: "bytes32" },
      { name: "asker", type: "address" },
      { name: "questionHash", type: "bytes32" },
      { name: "answerHash", type: "bytes32" },
      { name: "citationsHash", type: "bytes32" },
      { name: "passed", type: "bool" },
      { name: "validatorScore", type: "uint16" },
      { name: "citedDocuments", type: "string" }
    ],
    outputs: [{ name: "receiptHash", type: "bytes32" }]
  }
] as const;

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Dữ liệu yêu cầu không hợp lệ." }, { status: 400 });
  }

  const url =
    process.env.AI_SERVICE_URL ||
    process.env.LEGAL_RAG_API_URL ||
    "http://127.0.0.1:8000/api/v1/legal/ask";

  const proxyResult = await forwardLegalQuestion(body, url);
  if (proxyResult.status === 400 || proxyResult.status === 502) {
    return NextResponse.json(proxyResult.body, { status: proxyResult.status });
  }

  let ragData: any;
  if (proxyResult.status === 200) {
    ragData = proxyResult.body;
  } else {
    // 503: Python service offline (e.g., serverless deployment on Vercel) -> run built-in validator fallback
    if (body.asOf) {
      return NextResponse.json(
        { error: "Dữ liệu demo không hỗ trợ tra cứu theo ngày." },
        { status: 400 }
      );
    }
    ragData = runBuiltinMockLegalQA(
      body.questionId,
      body.question.trim(),
      body.tier,
      body.simulateHallucination === true,
      body.simulateExpiredLaw === true
    );
  }

  const questionId: string = body.questionId;
  const question: string = body.question.trim();
  const askerAddress: string =
    typeof body.askerAddress === "string" && body.askerAddress.startsWith("0x")
      ? body.askerAddress
      : "0x0000000000000000000000000000000000000001";

  const passed: boolean = Boolean(ragData?.validation?.passed);
  const scoreInt = Math.round((ragData?.validation?.overall_score || 0) * 100);

  const questionHash = keccak256(toBytes(question));
  const answerHash = keccak256(toBytes(ragData.answer || ""));
  const citationsHash = keccak256(toBytes(JSON.stringify(ragData.citations || [])));
  const citedDocsSummary = (ragData.citations || [])
    .map((c: any) => `${c.document}#Art${c.article}#Cl${c.clause}`)
    .join(";");

  const pk = process.env.ORACLE_PRIVATE_KEY || "";
  const escrowAddr = process.env.NEXT_PUBLIC_ESCROW_ADDRESS || "";
  const receiptAddr = process.env.NEXT_PUBLIC_RECEIPT_LOG_ADDRESS || "";

  const isLiveOnchainReady =
    pk.startsWith("0x") &&
    pk.length === 66 &&
    escrowAddr.startsWith("0x") &&
    receiptAddr.startsWith("0x");

  let l1TxHash = keccak256(
    toBytes(`L1_RECEIPT_${questionId}_${answerHash}_${citationsHash}_${scoreInt}`)
  );
  let settlementTxHash = keccak256(
    toBytes(`FUJI_SETTLE_${questionId}_${passed ? "RELEASE" : "REFUND"}_${Date.now()}`)
  );
  let onchainMode: "LIVE_AVALANCHE" | "SIMULATED_PREVIEW" = "SIMULATED_PREVIEW";

  if (isLiveOnchainReady) {
    try {
      const oracleAccount = privateKeyToAccount(pk as `0x${string}`);
      const fujiRpc =
        process.env.NEXT_PUBLIC_FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";
      const l1Rpc = process.env.ASKPAY_L1_RPC_URL || fujiRpc;
      const l1ChainId = Number(process.env.ASKPAY_L1_CHAIN_ID || 43113);

      const askPayL1 = defineChain({
        id: l1ChainId,
        name: "AskPay Audit L1",
        nativeCurrency: { name: "ASK", symbol: "ASK", decimals: 18 },
        rpcUrls: { default: { http: [l1Rpc] } }
      });

      const l1Public = createPublicClient({
        chain: askPayL1,
        transport: http(l1Rpc, { timeout: 10000 })
      });
      const l1Wallet = createWalletClient({
        account: oracleAccount,
        chain: askPayL1,
        transport: http(l1Rpc, { timeout: 10000 })
      });

      l1TxHash = await l1Wallet.writeContract({
        chain: askPayL1,
        account: oracleAccount,
        address: receiptAddr as `0x${string}`,
        abi: RECEIPT_ABI,
        functionName: "recordReceipt",
        args: [
          questionId as `0x${string}`,
          askerAddress as `0x${string}`,
          questionHash,
          answerHash,
          citationsHash,
          passed,
          scoreInt,
          citedDocsSummary
        ]
      });

      await l1Public.waitForTransactionReceipt({ hash: l1TxHash as `0x${string}` });

      const fujiPublic = createPublicClient({
        chain: avalancheFuji,
        transport: http(fujiRpc, { timeout: 10000 })
      });

      const escrowData = await fujiPublic.readContract({
        address: escrowAddr as `0x${string}`,
        abi: ESCROW_ABI,
        functionName: "escrows",
        args: [questionId as `0x${string}`],
        authorizationList: undefined
      });

      const escrowStatus = Number(escrowData[3]); // 1 = PENDING
      if (escrowStatus === 1) {
        const fujiWallet = createWalletClient({
          account: oracleAccount,
          chain: avalancheFuji,
          transport: http(fujiRpc, { timeout: 10000 })
        });

        settlementTxHash = await fujiWallet.writeContract({
          chain: avalancheFuji,
          account: oracleAccount,
          address: escrowAddr as `0x${string}`,
          abi: ESCROW_ABI,
          functionName: "resolveQuestion",
          args: [questionId as `0x${string}`, passed, scoreInt, l1TxHash as `0x${string}`]
        });
      } else {
        settlementTxHash = keccak256(
          toBytes(`NO_WALLET_DEPOSIT_${questionId}_${passed ? "VERIFIED" : "REFUND"}`)
        );
      }

      onchainMode = "LIVE_AVALANCHE";
    } catch {
      onchainMode = "SIMULATED_PREVIEW";
    }
  }

  return NextResponse.json({
    ...ragData,
    onchain: {
      mode: onchainMode,
      escrowTxHash:
        typeof body.escrowTxHash === "string" && body.escrowTxHash
          ? body.escrowTxHash
          : undefined,
      l1ReceiptTxHash: l1TxHash,
      fujiSettlementTxHash: settlementTxHash,
      settlementStatus: passed ? "RELEASED_TO_TREASURY" : "AUTO_REFUNDED_TO_USER"
    }
  });
}
