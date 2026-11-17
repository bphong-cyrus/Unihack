# Lorx

**Trợ lý tra cứu pháp luật Xuất Nhập Khẩu & Hải quan có đối chiếu nguồn văn bản, kết hợp cơ chế tạm giữ phí (escrow) và hoàn tiền khi kiểm tra trích dẫn không đạt.**

Quick: **0,05 USDC** · Deep: **0,20 USDC** *(giá thử nghiệm trên Avalanche Fuji testnet)* · **Kiểm chứng nguồn** & **Dùng thử demo**: **Miễn phí**.

- **Web Demo:** https://lorx-xnk.vercel.app/
- **Tài liệu kỹ thuật:** [Kiến trúc & Thiết kế](docs/KE_HOACH_THIET_KE.md) · [Kho luật theo phiên bản](docs/KHO_LUAT_PHIEN_BAN.md) · [Đánh giá & Kế hoạch](docs/demo-readiness/LATEST_REVIEW.md)

> **Lưu ý phạm vi:** Lorx hiện chạy chế độ `RULE_BASED_DEMO` trong phạm vi pháp luật Hải quan và Xuất Nhập Khẩu Việt Nam (`Kiểm chứng nguyên văn & hiệu lực trong snapshot đã rà soát`, **không phải chứng nhận tư vấn pháp lý**). Trích dẫn khớp nguyên văn không tự chứng minh kết luận pháp lý cuối cùng cho mọi tình huống thực tế.

---

## Trải nghiệm nhanh trong 3 phút

1. Mở web demo và chọn **Dùng thử demo (Miễn phí)** (vào tài khoản mẫu **Nguyễn Minh Anh (Dữ liệu mẫu)**, không cần ví) hoặc **Đăng nhập tài khoản / Kết nối Core Wallet · MetaMask** (mạng Avalanche Fuji Testnet, USDC) để thử luồng tạm giữ escrow.
2. Thử **4 tình huống tiêu biểu** ngay trên màn hình chào:
   - **Thời hạn nộp tờ khai nhập khẩu (30 ngày):** Tính số ngày đã qua / còn lại giữa `01/11/2026` và `17/11/2026` theo Điểm b Khoản 1 Điều 25 Luật Hải quan `54/2014/QH13`.
   - **Nhập khẩu máy móc cũ (`18/2019/QĐ-TTg` & `28/2022/QĐ-TTg`):** Khi thiếu mã HS, chứng thư giám định hoặc nhập để bán lại, hệ thống chủ động yêu cầu làm rõ (`NEEDS_CLARIFICATION`), không tự suy đoán đủ điều kiện.
   - **Hiệu lực văn bản theo thời gian:** Hỏi hiệu lực Nghị định `128/2020/NĐ-CP` tại `17/11/2026` → phát hiện đã hết hiệu lực từ `01/07/2026` theo Điều 38 Nghị định `169/2026/NĐ-CP`.
   - **Kiểm chứng nguồn (Miễn phí):** Cố tình sửa `30 ngày` thành `60 ngày` hoặc hỏi `Điều 999` → bộ kiểm chứng giữ nguyên đối tượng kiểm tra và chỉ rõ sai lệch số liệu.
3. Bấm vào từng căn cứ dưới câu trả lời để mở bảng **Trích dẫn** (nguyên văn + link nguồn gốc) hoặc tab **Văn bản** (dựng bản nháp & xuất PDF).

---

## Kiến trúc & Cơ chế hoạt động

1. **Kho luật có phiên bản & SHA-256 ([corpus/demo-v1/manifest.json](corpus/demo-v1/manifest.json)):**
   - Gồm **6 văn bản / 34 điều khoản chọn lọc** trích xuất từ PDF chính thức (`54/2014/QH13` VBHN 2026, `18/2019/QĐ-TTg`, `28/2022/QĐ-TTg`, `02/2026/QĐ-TTg`, `169/2026/NĐ-CP`, `128/2020/NĐ-CP`), gắn mốc hiệu lực (`effective_from` / `effective_until`) và `verified_through: 2026-11-17`.
   - Chạy đồng bộ qua backend Python (`ai-service/demo_api.py`) hoặc nhánh fallback tương đương trên Next.js cho các request demo miễn phí khi triển khai serverless.
   - Tài liệu tham chiếu kho mở rộng 45 văn bản / 2.581 khoản được lưu tại [research/DANH_MUC_NGUON_LUAT.md](research/DANH_MUC_NGUON_LUAT.md) và [data/legal-corpus.json](data/legal-corpus.json).
2. **Truy xuất & Kiểm chứng tất định ([ai-service/versioned_validator.py](ai-service/versioned_validator.py), [app/api/ask-and-settle/validator-core.mjs](app/api/ask-and-settle/validator-core.mjs)):**
   - Kiểm tra sự tồn tại của văn bản, Điều/Khoản/Điểm, hiệu lực tại ngày tra cứu `as_of`, độ khớp nguyên văn `>= 90%`, và chặn sai lệch số liệu / từ phủ định.
   - Giao diện tách riêng 3 trạng thái: **Nguồn trích dẫn**, **Mức độ kết luận / dữ kiện** (`ANSWERED`, `NEEDS_CLARIFICATION`, `INSUFFICIENT_EVIDENCE`, `FACTCHECK`), và **Trạng thái thanh toán**.
3. **Thanh toán có điều kiện (`askpay-escrow-v2`):**
   - Frontend tạo `requestHash(context)` ([app/lib/payment-request.mjs](app/lib/payment-request.mjs)), khóa USDC vào [AskPayEscrow.sol](contracts/AskPayEscrow.sol) trên Avalanche Fuji và ký EIP-191 xác nhận giao dịch.
   - Backend xác minh proof trực tiếp qua RPC ([app/api/ask-and-settle/verify-payment.mjs](app/api/ask-and-settle/verify-payment.mjs)): kiểm tra chain ID, calldata `askQuestionUsdc`, log `QuestionAsked`, ERC-20 `Transfer`, trạng thái pending, số block xác nhận và timeout.
   - Hỗ trợ khôi phục giao dịch trên UI (thử đối soát lại không trừ cọc mới và nút `claimTimeoutRefund` sau thời hạn timeout của contract).

---

## Trạng thái hiện tại & Giới hạn

| Thành phần | Trạng thái & Ghi chú |
|---|---|
| Giao diện web (`Lorx`) | Tách rõ 2 luồng *Dùng thử demo* (`Nguyễn Minh Anh (Dữ liệu mẫu)`) / *Đăng nhập & Ví Web3*, chế độ Nhanh / Phân tích tình huống / Kiểm chứng nguồn (free), khôi phục phiên cọc qua reload (`lorx_pending_paid_attempt_v1`) và nút `claimTimeoutRefund`. |
| Corpus demo (`corpus/demo-v1`) | 6 văn bản / 34 điều khoản kèm PDF chính thức và SHA-256 (`source-check-v1`: chỉ mở giải ngân tất định cho 5 nhóm câu kiểm chứng/định lượng nằm trong whitelist đã rà soát tới `2026-11-17`, các ca còn lại chặn/hoàn cọc an toàn). |
| Backend AI (`ai-service/`) | Chạy ở chế độ `RULE_BASED_DEMO` trong phạm vi XNK (không phải mô hình RAG tổng quát hay tư vấn pháp lý chính thức); `legal_pipeline.py` cung cấp sẵn contract adapter (`retrieve / answer / assess`) cho mô hình LegalIR/LegalQA. |
| Thanh toán & Smart Contract | Hợp đồng V2 (`AskPayEscrow.sol`, `AskPayReceiptLog.sol`), settlement journal bền vững phía server và trình xác minh proof `askpay-escrow-v2` đã kiểm thử trên Ganache EVM cục bộ; ghi nhận receipt qua Avalanche Fuji C-Chain (`43113`) hoặc Receipt Chain cấu hình riêng. |

---

## Cấu trúc thư mục

```text
Unihack/
├── app/                   # Next.js 14 App Router (UI Lorx, icon/favicon, API /api/ask-and-settle, /api/legal-corpus)
├── ai-service/            # FastAPI demo_api.py, main.py, legal_pipeline.py, deterministic validator & tests
├── contracts/             # Smart contracts Solidity V2 (AskPayEscrow.sol, AskPayReceiptLog.sol) + script deploy
├── corpus/demo-v1/        # Corpus demo chuẩn hóa (6 văn bản / 34 điều khoản) + PDF gốc & SHA-256
├── data/                  # Corpus mở rộng biên dịch sẵn (45 văn bản / 2.581 khoản)
├── docs/                  # Tài liệu thiết kế, kho luật theo phiên bản và báo cáo rà soát
├── research/              # Nguồn văn bản gốc thu thập và công cụ trích xuất / audit
├── scripts/               # Script tải và biên dịch corpus/demo-v1 từ PDF chính thức
└── tests/                 # Kiểm thử Node.js (payment proof Ganache EVM, proxy, factcheck, validator parity, HTTP smoke)
```

---

## Cài đặt & Chạy cục bộ

### 1. Cài đặt phụ thuộc
Yêu cầu Node.js (>= 18), npm và Python 3:

```bash
npm ci
python -m pip install -r ai-service/requirements.txt
```

### 2. Chạy dịch vụ AI & Giao diện web
Trong terminal 1 (khởi chạy `demo_api`):

```bash
python -m uvicorn demo_api:app --app-dir ai-service --host 127.0.0.1 --port 8000
```

Trong terminal 2 (chạy Next.js):

```bash
npm run dev
```

Mở `http://localhost:3000`. Khi chưa bật `demo_api` (ví dụ deploy serverless trên Vercel), các lượt dùng thử miễn phí tự động dùng nhánh fallback tương đương từ `corpus/demo-v1/manifest.json` (có thể tắt fallback bằng `ASKPAY_ENABLE_BUILTIN_DEMO=false`).

### 3. Cấu hình thanh toán USDC Testnet (tùy chọn)
Chỉ dùng trên **Avalanche Fuji Testnet** và đặt trong `.env.local` (không commit khóa bí mật):

```dotenv
NEXT_PUBLIC_ESCROW_ADDRESS=0x...
NEXT_PUBLIC_USDC_ADDRESS=0x5425890298aed601595a70AB815c96711a31Bc65
NEXT_PUBLIC_FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
NEXT_PUBLIC_RECEIPT_LOG_ADDRESS=0x...
# Receipt Contract mặc định chạy trên Avalanche Fuji C-Chain (43113) hoặc trỏ tới Receipt Chain riêng
ASKPAY_L1_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
ASKPAY_L1_CHAIN_ID=43113
ORACLE_PRIVATE_KEY=0x...
ASKPAY_PAYMENT_CORPUS_SHA256=38f84d5d593a86142b23bb6d79187192a847be52f56f2befa9f0c0fabdd2bec3
ASKPAY_PAYMENT_CONFIRMATIONS=2
```

---

## Kiểm thử

```bash
# Kiểm thử Python (LegalIR/LegalQA adapter, validator, snapshot, release policy & demo-v1)
python -m unittest discover -s ai-service/tests -q

# Đánh giá bộ 30 câu hỏi holdout (xuất evidence/holdout-eval.json & evidence/demo-results.json)
python scripts/run_holdout_eval.py

# Kiểm thử Node.js (proxy, memo, validator parity, factcheck)
node --test tests/legal-proxy.test.mjs tests/memo.test.cjs tests/judge-audit-fixes.test.mjs

# Kiểm thử Settlement Journal & khôi phục sau sự cố
npm run test:journal

# Kiểm thử luồng đặt cọc / proof / giải ngân / hoàn tiền / timeout trên Ganache EVM cục bộ
npm run test:payment

# Build kiểm tra TypeScript và Next.js production
npx tsc --noEmit && npm run build
```

Để chạy kiểm thử HTTP end-to-end (`tests/demo-http-smoke.mjs`), khởi động `demo_api` (cổng `8000`) và `next start` (cổng `3017`) trong môi trường chưa bật payment rồi chạy:

```bash
ASK_BASE_URL=http://127.0.0.1:3017 node tests/demo-http-smoke.mjs
```
