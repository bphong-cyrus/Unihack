# AskPay XNK
Hỏi về pháp luật xuất nhập khẩu, xem căn cứ cho từng câu trả lời.

AskPay thử nghiệm cơ chế trả tiền cho câu trả lời AI có kiểm tra
trích dẫn: tiền được giữ trong escrow; trích dẫn đạt điều kiện
thì giải ngân, thất bại thì đi theo nhánh hoàn tiền.

Quick: 0,05 USDC · Deep: 0,20 USDC.

## Xem dự án trong 3 phút
1. Đọc kiến trúc và trạng thái bên dưới.
2. Mở https://askpay-virid.vercel.app/ → **Dùng thử demo**.
3. Thử câu hỏi hợp lệ, citation sai (ví dụ `Điều 999` hoặc sửa `30` thành `60`) và tình huống máy móc đã qua sử dụng (`18/2019/QĐ-TTg`, `28/2022/QĐ-TTg`).

## Chúng tôi xây gì?
- LegalIR / Extractive Search: tìm đúng điều/khoản trong `data/legal-corpus.json` & `research/snapshot-manifest.json` theo ngày áp dụng.
- LegalQA Adapter (`ai-service/legal_pipeline.py`): lớp tích hợp trả lời từ các căn cứ được truy xuất.
- Validator: kiểm tra văn bản, điều/khoản, hiệu lực theo snapshot và độ khớp excerpt tối thiểu 90%.
- x402 & AnswerEscrow: challenge HTTP 402, xác minh `scheme` / `asset` USDC / receipt giao dịch trên Avalanche Fuji; giữ tiền, giải ngân hoặc hoàn theo kết quả oracle.
- ReceiptLog: ghi hash để đối chiếu kết quả và phiên bản dữ liệu trên AskPay L1.

## Trạng thái hiện tại
- Có web chat, Quick/Deep, kiểm chứng nguồn tách biệt (`mode: "factcheck"`), và smart contract V2 (USDC + AVAX).
- Kho nguồn gốc gồm **45 văn bản đã lưu kèm SHA-256** (`43` bộ nguồn ban đầu + `18/2019/QĐ-TTg` và `28/2022/QĐ-TTg`), biên dịch thành **2.581 khoản** (`69` điều khoản đối chiếu nguyên văn trực tiếp + `2.512` điều khoản tách từ RTF/DOCX/OCR, được gắn nhãn trung thực trạng thái rà soát trong `research/snapshot-manifest.json`).
- Đường snapshot mặc định là extractive (adapter `ASKPAY_LEGAL_ADAPTER` sẵn sàng nối model của nhóm).
- Luồng thanh toán hỗ trợ x402 USDC trên Avalanche Fuji; chỉ ghi “đã release/refund” khi có receipt giao dịch xác nhận on-chain.
- Khớp citation không tự chứng minh kết luận pháp lý đúng.

## Phạm vi
Hải quan, xuất xứ hàng hóa, thuế xuất nhập khẩu và nhập khẩu máy móc, thiết bị đã qua sử dụng tại Việt Nam.
Chưa bao phủ mọi lĩnh vực pháp luật.

## Bằng chứng cần xem
- Nguồn dữ liệu: [research/DANH_MUC_NGUON_LUAT.md](research/DANH_MUC_NGUON_LUAT.md)
- Kho phiên bản: [research/snapshot-manifest.json](research/snapshot-manifest.json)
- Kế hoạch & thiết kế: [docs/KE_HOACH_THIET_KE.md](docs/KE_HOACH_THIET_KE.md) · [docs/KHO_LUAT_PHIEN_BAN.md](docs/KHO_LUAT_PHIEN_BAN.md)
- Hợp đồng thông minh: [contracts/](contracts/)

## Cấu trúc thư mục
```text
Unihack/
├── app/                   # Next.js 14 App Router (UI chat, Admin, API /api/ask-and-settle, /api/legal-corpus)
├── ai-service/            # FastAPI LegalIR/LegalQA, Deterministic Validator, Snapshot & OCR tools
├── contracts/             # Smart contracts Solidity V2 (AskPayEscrow.sol, AskPayReceiptLog.sol) + artifacts
├── data/                  # Corpus đã biên dịch sẵn cho runtime (45 văn bản / 2.581 khoản)
├── docs/                  # Tài liệu thiết kế và đặc tả kho luật theo phiên bản
├── research/              # 45 văn bản gốc tải từ cổng Chính phủ/BCT, dữ liệu trích xuất OCR & snapshot-manifest.json
└── tests/                 # Bộ kiểm thử Node.js (proxy, memo, x402, factcheck, validator parity)
```

## Chạy cục bộ

Yêu cầu Node.js, npm và Python 3. Cài các phụ thuộc được khai báo trong dự án:

```bash
npm ci
python -m pip install -r ai-service/requirements.txt
```

Trong một terminal, chạy dịch vụ AI từ thư mục dự án:

```bash
cd ai-service
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Tuỳ chọn bật snapshot có kiểm tra ngày hiệu lực:

```bash
ASKPAY_CORPUS_MANIFEST=../research/snapshot-manifest.json python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Trong terminal khác, chạy giao diện:

```bash
npm run dev
```

Mở `http://localhost:3000`. Khi deploy serverless (Vercel) chưa cấu hình URL FastAPI rời, `route.ts` dùng bộ dữ liệu nội bộ `data/legal-corpus.json` và gắn nhãn nguồn rõ ràng (có thể đặt `ASKPAY_ENABLE_BUILTIN_DEMO=false` nếu muốn trả HTTP 503 khi backend Python tắt).

## Kiểm tra

```bash
python ai-service/corpus_cli.py check research/snapshot-manifest.json
python -m unittest discover -s ai-service/tests -q
node --test tests/legal-proxy.test.mjs tests/memo.test.cjs tests/judge-audit-fixes.test.mjs
npm run build
npm run compile:contracts
```

Danh mục và nguồn văn bản đã thu thập nằm tại [research/DANH_MUC_NGUON_LUAT.md](research/DANH_MUC_NGUON_LUAT.md); các kết quả OCR nằm trong `research/extracted/`. Thiết kế, giới hạn và công việc còn lại được mô tả tại [docs/KE_HOACH_THIET_KE.md](docs/KE_HOACH_THIET_KE.md).
