export type TierMode = "quick" | "deep" | "factcheck";

export interface CitationItem {
  document: string;
  document_title?: string;
  article: string;
  clause: string;
  excerpt: string;
}

export interface CitationCheck {
  document: string;
  article: string;
  clause: string;
  doc_exists: boolean;
  article_clause_exists: boolean;
  is_in_force: boolean;
  excerpt_similarity: number;
  threshold_required: number;
  raw_text?: string;
  source_url?: string | null;
  source_sha256?: string | null;
  status: "PASS" | "FAIL";
  fail_reason: string | null;
}

export interface ValidationPayload {
  passed: boolean;
  verdict: "VERIFIED_RELEASE" | "UNVERIFIED_REFUND";
  overall_score: number;
  citation_checks: CitationCheck[];
  fail_reason?: string;
  snapshot_id?: string;
  as_of?: string;
}

export interface OnchainProof {
  mode: "LIVE_AVALANCHE" | "SIMULATED_PREVIEW" | "SAMPLE_SHOWCASE";
  escrowTxHash?: string;
  l1ReceiptTxHash: string;
  fujiSettlementTxHash: string;
  settlementStatus: "RELEASED_TO_TREASURY" | "AUTO_REFUNDED_TO_USER";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestampLabel: string;
  mode?: TierMode;
  feeLabel?: string;
  citations?: CitationItem[];
  validation?: ValidationPayload;
  onchain?: OnchainProof;
  questionId?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  group: "today" | "week";
  status: "verified" | "refunded" | "draft";
  messages: ChatMessage[];
}

export interface ExpertLawyer {
  id: string;
  name: string;
  initials: string;
  avatarBg: string;
  barAssociation: string;
  experienceYears: number;
  rating: string;
  reviews: number;
  tags: string[];
  escrowFeeUsdc: string;
  topRated?: boolean;
}

export const COMMON_SITUATIONS: string[] = [
  "Khai sai mã HS khi kiểm tra sau thông quan bị xử lý thế nào?",
  "Thủ tục đăng ký hồ sơ thương nhân xin cấp C/O lần đầu",
  "Điều kiện hoàn thuế nhập khẩu đối với hàng tái xuất",
  "Thời hạn nộp tờ khai hải quan đối với hàng hóa nhập khẩu"
];

export const LEGAL_DOCUMENTS_LIST = [
  {
    code: "Luật số 54/2014/QH13",
    title: "Luật Hải quan quy định về thủ tục, kiểm tra, giám sát hải quan",
    status: "Đang có hiệu lực"
  },
  {
    code: "Luật số 107/2016/QH13",
    title: "Luật Thuế xuất khẩu, thuế nhập khẩu",
    status: "Đang có hiệu lực"
  },
  {
    code: "Luật số 05/2017/QH14",
    title: "Luật Quản lý ngoại thương",
    status: "Đang có hiệu lực"
  },
  {
    code: "Luật số 38/2019/QH14",
    title: "Luật Quản lý thuế",
    status: "Đang có hiệu lực"
  },
  {
    code: "Nghị định 08/2015/NĐ-CP & 59/2018/NĐ-CP",
    title: "Quy định chi tiết Luật Hải quan về thủ tục, kiểm tra, giám sát hải quan",
    status: "Đang có hiệu lực"
  },
  {
    code: "Nghị định 128/2020/NĐ-CP",
    title: "Quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan",
    status: "Đang có hiệu lực"
  },
  {
    code: "Nghị định 134/2016/NĐ-CP & 18/2021/NĐ-CP",
    title: "Quy định chi tiết thi hành Luật Thuế xuất khẩu, thuế nhập khẩu",
    status: "Đang có hiệu lực"
  },
  {
    code: "Nghị định 31/2018/NĐ-CP",
    title: "Quy định chi tiết Luật Quản lý ngoại thương về xuất xứ hàng hóa (C/O)",
    status: "Đang có hiệu lực"
  },
  {
    code: "Nghị định 43/2017/NĐ-CP & 111/2021/NĐ-CP",
    title: "Quy định về nhãn hàng hóa và nhãn phụ hàng hóa nhập khẩu",
    status: "Đang có hiệu lực"
  },
  {
    code: "Thông tư 38/2015/TT-BTC & 39/2018/TT-BTC",
    title: "Quy định về thủ tục hải quan; kiểm tra, giám sát hải quan; thuế XK, NK",
    status: "Đang có hiệu lực"
  },
  {
    code: "Thông tư 14/2015/TT-BTC & 17/2021/TT-BTC",
    title: "Hướng dẫn phân loại hàng hóa, phân tích để phân loại mã số HS",
    status: "Đang có hiệu lực"
  },
  {
    code: "Nghị định 127/2013/NĐ-CP",
    title: "Xử phạt VPHC hải quan cũ (Giữ metadata EXPIRED để bộ lọc loại trừ)",
    status: "Hết hiệu lực"
  }
];

export const EXPERT_LAWYERS: ExpertLawyer[] = [
  {
    id: "ls-an",
    name: "LS. Nguyễn Văn An",
    initials: "NA",
    avatarBg: "#1e4268",
    barAssociation: "Đoàn Ls. TP HCM",
    experienceYears: 15,
    rating: "4.9",
    reviews: 120,
    tags: ["Mã HS & Thuế XNK", "Sau thông quan"],
    escrowFeeUsdc: "15.00",
    topRated: true
  },
  {
    id: "cg-bich",
    name: "Chuyên gia Trần Thị Bích",
    initials: "TB",
    avatarBg: "#0f766e",
    barAssociation: "Đại lý HQ Bình Dương",
    experienceYears: 9,
    rating: "4.8",
    reviews: 85,
    tags: ["Xuất xứ C/O", "Hoàn thuế XNK"],
    escrowFeeUsdc: "10.00",
    topRated: false
  }
];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] as string));
}

export function buildFormalMemoHtml(
  question: string,
  assistantMsg?: ChatMessage | null
): string {
  const citations = assistantMsg?.citations || [];
  const answer =
    assistantMsg?.content ||
    "Chưa có nội dung phân tích. Hãy đặt câu hỏi ở khung giữa để hệ thống tự động lập Phiếu tham vấn pháp lý kèm trích dẫn.";

  const citationsHtml =
    citations.length > 0
      ? citations
          .map(
            (c, idx) =>
              `<p><strong>${idx + 1}. Điều ${escapeHtml(c.article)}, Khoản ${escapeHtml(c.clause)} — ${escapeHtml(c.document)}</strong>${
                c.document_title ? ` (${escapeHtml(c.document_title)})` : ""
              }<br/><em>&ldquo;${escapeHtml(c.excerpt)}&rdquo;</em></p>`
          )
          .join("")
      : "<p><em>Chưa có trích dẫn hợp lệ được xác thực cho phiên tra cứu này.</em></p>";

  const proofCode = assistantMsg?.questionId
    ? `${assistantMsg.questionId.slice(0, 14)}...`
    : "ASKPAY-XNK-MEMO";

  return `
    <div style="text-align:center;margin:14px 0 16px;">
      <div style="font-weight:800;font-size:14px;color:#0a1c2e;">PHIẾU TRA CỨU THỬ NGHIỆM</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px;">Mã tham chiếu: ${escapeHtml(proofCode)}</div>
    </div>
    <p><strong>I. Tình huống / Yêu cầu tra cứu:</strong><br/>${escapeHtml(question || "Tra cứu nghiệp vụ Xuất Nhập Khẩu")}</p>
    <p><strong>II. Nội dung tra cứu:</strong><br/>${escapeHtml(answer).replace(/\n/g, "<br/>")}</p>
    <div style="margin-top:10px;">
      <p><strong>III. Trích dẫn được cung cấp:</strong></p>
      ${citationsHtml}
    </div>
    <p style="margin-top:14px;font-size:11.5px;color:#475569;"><em>Kiểm tra trích dẫn chưa chứng minh câu trả lời đúng hoặc văn bản còn hiệu lực. Cần đối chiếu nguồn và tham vấn chuyên gia.</em></p>
  `;
}

export const INITIAL_SESSIONS: ChatSession[] = [
  {
    id: "demo-hs-128",
    title: "Khai sai mã HS sau thông quan",
    group: "today",
    status: "verified",
    messages: [
      {
        id: "m-u1",
        role: "user",
        timestampLabel: "10:42 AM",
        content:
          "Khai sai mã HS khi kiểm tra sau thông quan bị xử lý thế nào theo quy định hiện hành?"
      },
      {
        id: "m-a1",
        role: "assistant",
        timestampLabel: "10:42 AM",
        mode: "deep",
        feeLabel: "Phân tích sâu - 0.20 USDC",
        questionId: "0x76982b366f47344ce9c67a7dab35760a4fcb7d6f9ab789feb2d5e16b9781f1e9",
        content:
          "Chào bạn, đối với trường hợp doanh nghiệp xuất nhập khẩu khai sai mã số hàng hóa (mã HS) bị phát hiện trong quá trình kiểm tra sau thông quan, hệ thống căn cứ theo quy định hiện hành như sau:\n\n1. Mức xử phạt hành chính: Phạt 20% tính trên số tiền thuế khai thiếu hoặc số tiền thuế được miễn, giảm, hoàn cao hơn so với quy định nếu hành vi dẫn đến thiếu số tiền thuế phải nộp.\n\n2. Nghĩa vụ khắc phục hậu quả: Doanh nghiệp vẫn phải nộp đủ số tiền thuế truy thu và tiền chậm nộp theo Luật Quản lý thuế.\n\n3. Lưu ý khai bổ sung: Nếu tự nguyện phát hiện sai sót trước khi có quyết định kiểm tra trực tiếp hồ sơ/thực tế hàng hóa, doanh nghiệp có quyền khai bổ sung hồ sơ hải quan để giảm thiểu rủi ro chế tài.",
        citations: [
          {
            document: "128/2020/NĐ-CP",
            document_title: "Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan",
            article: "9",
            clause: "1",
            excerpt:
              "Phạt 20% tính trên số tiền thuế khai thiếu hoặc số tiền thuế được miễn, giảm, hoàn, không thu cao hơn so với quy định của pháp luật về thuế đối với hành vi khai sai mã số hàng hóa, thuế suất, mức thuế"
          },
          {
            document: "39/2018/TT-BTC",
            document_title:
              "Thông tư sửa đổi, bổ sung một số điều tại Thông tư 38/2015/TT-BTC về thủ tục hải quan",
            article: "1",
            clause: "7",
            excerpt:
              "Người khai hải quan được khai bổ sung hồ sơ hải quan sau khi Hệ thống phân luồng tờ khai nhưng trước thời điểm cơ quan hải quan thông báo việc kiểm tra trực tiếp hồ sơ hải quan"
          }
        ],
        validation: {
          passed: true,
          verdict: "VERIFIED_RELEASE",
          overall_score: 100,
          citation_checks: [
            {
              document: "128/2020/NĐ-CP",
              article: "9",
              clause: "1",
              doc_exists: true,
              article_clause_exists: true,
              is_in_force: true,
              excerpt_similarity: 1,
              threshold_required: 0.9,
              raw_text:
                "Phạt 20% tính trên số tiền thuế khai thiếu hoặc số tiền thuế được miễn, giảm, hoàn, không thu cao hơn so với quy định của pháp luật về thuế đối với hành vi khai sai mã số hàng hóa, thuế suất, mức thuế đối với hàng hóa xuất khẩu, nhập khẩu dẫn đến thiếu số tiền thuế phải nộp mà bị cơ quan hải quan phát hiện trong quá trình kiểm tra sau thông quan.",
              status: "PASS",
              fail_reason: null
            },
            {
              document: "39/2018/TT-BTC",
              article: "1",
              clause: "7",
              doc_exists: true,
              article_clause_exists: true,
              is_in_force: true,
              excerpt_similarity: 1,
              threshold_required: 0.9,
              raw_text:
                "Người khai hải quan được khai bổ sung hồ sơ hải quan sau khi Hệ thống phân luồng tờ khai nhưng trước thời điểm cơ quan hải quan thông báo việc kiểm tra trực tiếp hồ sơ hải quan hoặc kiểm tra thực tế hàng hóa.",
              status: "PASS",
              fail_reason: null
            }
          ]
        },
        onchain: {
          mode: "SAMPLE_SHOWCASE",
          l1ReceiptTxHash: "0x0433323556f5a2681a5b333f688a9d51b2a24bc94ff6d8338356ac66fa3c0203",
          fujiSettlementTxHash: "0xb4fc756871c6e1694f13d7692c8f714c47142108",
          settlementStatus: "RELEASED_TO_TREASURY"
        }
      }
    ]
  },
  {
    id: "demo-co-31",
    title: "Đăng ký hồ sơ thương nhân C/O",
    group: "today",
    status: "verified",
    messages: [
      {
        id: "m-u2",
        role: "user",
        timestampLabel: "09:15 AM",
        content: "Thủ tục đăng ký hồ sơ thương nhân xin cấp C/O lần đầu"
      },
      {
        id: "m-a2",
        role: "assistant",
        timestampLabel: "09:15 AM",
        mode: "quick",
        feeLabel: "Hỏi nhanh - 0.05 USDC",
        questionId: "0x3120181501a4b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456",
        content:
          "Theo quy định tại Khoản 1 Điều 15 Nghị định 31/2018/NĐ-CP, thương nhân đề nghị cấp Giấy chứng nhận xuất xứ hàng hóa (C/O) lần đầu bắt buộc phải đăng ký Hồ sơ thương nhân qua Hệ thống quản lý và cấp chứng nhận xuất xứ điện tử (eCoSys) trước khi nộp hồ sơ đề nghị cấp C/O.",
        citations: [
          {
            document: "31/2018/NĐ-CP",
            document_title:
              "Nghị định quy định chi tiết Luật Quản lý ngoại thương về xuất xứ hàng hóa (C/O)",
            article: "15",
            clause: "1",
            excerpt:
              "Thương nhân đề nghị cấp Giấy chứng nhận xuất xứ hàng hóa (C/O) lần đầu phải đăng ký Hồ sơ thương nhân với cơ quan, tổ chức cấp Giấy chứng nhận xuất xứ hàng hóa thông qua Hệ thống quản lý và cấp chứng nhận xuất xứ điện tử."
          }
        ],
        validation: {
          passed: true,
          verdict: "VERIFIED_RELEASE",
          overall_score: 100,
          citation_checks: [
            {
              document: "31/2018/NĐ-CP",
              article: "15",
              clause: "1",
              doc_exists: true,
              article_clause_exists: true,
              is_in_force: true,
              excerpt_similarity: 1,
              threshold_required: 0.9,
              raw_text:
                "Thương nhân đề nghị cấp Giấy chứng nhận xuất xứ hàng hóa (C/O) lần đầu phải đăng ký Hồ sơ thương nhân với cơ quan, tổ chức cấp Giấy chứng nhận xuất xứ hàng hóa thông qua Hệ thống quản lý và cấp chứng nhận xuất xứ điện tử.",
              status: "PASS",
              fail_reason: null
            }
          ]
        },
        onchain: {
          mode: "SAMPLE_SHOWCASE",
          l1ReceiptTxHash: "0x8a92f3f9e42bb12c4091e2b7a11d49c8f32e108a42c7e5511092a3b4c5d6d912",
          fujiSettlementTxHash: "0xb4fc756871c6e1694f13d7692c8f714c47142108",
          settlementStatus: "RELEASED_TO_TREASURY"
        }
      }
    ]
  },
  {
    id: "demo-refund-127",
    title: "Kiểm thử: Luật cũ 127/2013 đã hết hạn",
    group: "week",
    status: "refunded",
    messages: [
      {
        id: "m-u3",
        role: "user",
        timestampLabel: "7 ngày trước",
        content: "Mức phạt hành vi không khai hoặc khai sai tên hàng hóa xuất nhập khẩu?"
      },
      {
        id: "m-a3",
        role: "assistant",
        timestampLabel: "7 ngày trước",
        mode: "quick",
        feeLabel: "Hoàn tiền 100% (0.00 USDC)",
        questionId: "0x12720130801deadbeef00000000000000000000000000000000000000000081",
        content:
          "Theo Khoản 1 Điều 8 Nghị định 127/2013/NĐ-CP, hành vi khai sai tên hàng, số lượng hàng hóa xuất nhập khẩu bị phạt từ 1.000.000 đồng đến 3.000.000 đồng.\n\n[CẢNH BÁO TỪ VALIDATOR]: Văn bản được AI trích dẫn đã HẾT HIỆU LỰC (thay thế bởi Nghị định 128/2020/NĐ-CP). Hợp đồng thông minh AskPayEscrow đã từ chối giải ngân và TỰ ĐỘNG HOÀN TRẢ 100% tiền cọc về ví người hỏi.",
        citations: [
          {
            document: "127/2013/NĐ-CP",
            document_title: "Nghị định xử phạt vi phạm hành chính hải quan (ĐÃ HẾT HIỆU LỰC)",
            article: "8",
            clause: "1",
            excerpt:
              "Phạt tiền từ 1.000.000 đồng đến 3.000.000 đồng đối với hành vi không khai hoặc khai sai so với thực tế về tên hàng, chủng loại, số lượng hàng hóa xuất khẩu, nhập khẩu."
          }
        ],
        validation: {
          passed: false,
          verdict: "UNVERIFIED_REFUND",
          overall_score: 80,
          citation_checks: [
            {
              document: "127/2013/NĐ-CP",
              article: "8",
              clause: "1",
              doc_exists: true,
              article_clause_exists: true,
              is_in_force: false,
              excerpt_similarity: 1,
              threshold_required: 0.9,
              raw_text:
                "Phạt tiền từ 1.000.000 đồng đến 3.000.000 đồng đối với hành vi không khai hoặc khai sai so với thực tế về tên hàng, chủng loại, số lượng hàng hóa xuất khẩu, nhập khẩu.",
              status: "FAIL",
              fail_reason: "DOCUMENT_EXPIRED_OR_REPLACED"
            }
          ]
        },
        onchain: {
          mode: "SAMPLE_SHOWCASE",
          l1ReceiptTxHash: "0xdead1272013000000000000000000000000000000000000000000000000refund",
          fujiSettlementTxHash: "0xb4fc756871c6e1694f13d7692c8f714c47142108",
          settlementStatus: "AUTO_REFUNDED_TO_USER"
        }
      }
    ]
  }
];
