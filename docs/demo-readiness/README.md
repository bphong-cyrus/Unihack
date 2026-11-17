# Bản vá corpus + payment proof — đọc trước khi áp dụng

Dựa trên `395ff8f39510adc9fdfcabde5d89022bb5e0b9c7` (Fix pay), kiểm tra ngày 17/11/2026.
Không sửa trực tiếp GitHub, Vercel hay ví của bạn. ZIP có mã, PDF gốc, patch và kết quả kiểm thử để bạn tự áp dụng.

## Đã làm trong bản vá

- Verifier đối chiếu RPC: đúng chain, contract, payer, calldata `askQuestionUsdc`, giá Quick 50.000 / Deep 200.000, sự kiện `QuestionAsked`, `Transfer` USDC, trạng thái escrow pending, số xác nhận, block canonical và timeout.
- Proof cần chữ ký EIP-191 của ví đã đặt cọc. Hash được ràng buộc với toàn bộ request: question ID, question, tier/mode, payer, chain/contract/token, ngày áp dụng và corpus SHA-256. Chỉ có txHash hoặc authorization đúng hình dạng không đủ.
- BFF không được tự nâng `settlement_eligible=false` từ backend thành true. Cần receipt thành công trước khi báo release/refund. Lỗi RPC/settlement sau đặt cọc giữ `PENDING_RECONCILIATION`.
- Frontend USDC gửi hash request đầy đủ, chờ deposit thành công và ký proof. AVAX bị chặn trước khi đặt cọc trong luồng mới. Factcheck hiện chỉ dùng demo miễn phí.
- Corpus demo gồm **6 văn bản / 34 điều khoản được chọn**, dùng các PDF chính thức kèm SHA-256. Không thay thế kho 45 văn bản hiện có. Chọn corpus này bằng `demo_api:app`.
- Backend demo có nhãn `RULE_BASED_DEMO`: xử lý đúng những nhóm tình huống được chỉ định; hỏi lại/abstain ngoài phạm vi. Đây không phải model LegalQA đã huấn luyện.
- Nhãn rà soát là `AI_ASSISTED_SOURCE_CHECK_ONLY`, **chưa được luật sư/chuyên gia pháp lý duyệt**, nên backend demo không cho giải ngân; có thể thử thanh toán và hoàn tiền bằng testnet.

## Áp dụng an toàn trên máy bạn

Tạo branch trước; giữ nguyên các thay đổi bạn đang làm. Trong thư mục repo, chạy:

```bash
git switch -c fix/demo-proof-corpus
python /duong-dan-da-giai-nen/apply_overlay.py --repo . --check
python /duong-dan-da-giai-nen/apply_overlay.py --repo .
```

Script chỉ ghi file khi hash file hiện tại khớp baseline hoặc đã giống bản vá. Nếu có thay đổi mới, dừng toàn bộ để bạn merge tay; không dùng `git reset --hard`. Có `changes.patch` để đọc diff, và `overlay/` chứa đầy đủ file mới/sửa để copy thủ công. Không áp dụng cả patch lẫn overlay hai lần.

## Chạy demo, chưa bật thanh toán

```bash
npm ci
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
python -m pip install -r ai-service/requirements.txt
python -m uvicorn demo_api:app --app-dir ai-service --host 127.0.0.1 --port 8000
```

Trong `.env.local` của Next.js:

```dotenv
AI_SERVICE_URL=http://127.0.0.1:8000/api/v1/legal/ask
LEGAL_CORPUS_API_URL=http://127.0.0.1:8000/api/v1/legal/corpus
ASKPAY_ENABLE_BUILTIN_DEMO=false
```

Chạy `npm run dev`. Khi deploy, thay localhost bằng URL backend FastAPI có thể truy cập từ Vercel. Không gọi API nội bộ của một máy khác qua `127.0.0.1`.

Corpus khóa mốc rà soát **17/11/2026**. Sau ngày này, demo yêu cầu chọn ngày đó hoặc rà soát nguồn và phát hành snapshot mới; không tự kéo dài `verified_through`. Thay manifest sẽ đổi hash và làm request thanh toán cũ không khớp.

## Kiểm thử

```bash
python -m unittest discover -s ai-service/tests -q
node --test tests/legal-proxy.test.mjs tests/memo.test.cjs tests/judge-audit-fixes.test.mjs
npm run test:payment
npm run build
```

`ganache` là devDependency; test payment triển khai token giả + contract của repo trên **EVM cục bộ**, không cần ví thật. Node hiện dùng được v24, nhưng nên giữ phiên bản đã khóa của môi trường nhóm. `tests/demo-http-smoke.mjs` kiểm tra Next↔FastAPI; khởi động hai server và đặt `ASK_BASE_URL=http://localhost:3000`. Test smoke giả định môi trường **chưa cấu hình payment**.

Để tái tạo corpus: cài `ai-service/requirements-demo.txt`, chạy `python scripts/download_demo_sources.py` rồi `python scripts/build_demo_corpus.py`. Script download kiểm tra hash; source đổi sẽ dừng, không tự chấp nhận nội dung mới.

## Bật proof USDC trên Fuji

Chỉ thử bằng USDC/AVAX **testnet**. Cần contract V2 đúng ABI, token USDC được cấu hình trong contract, oracle và treasury đúng môi trường.

```dotenv
NEXT_PUBLIC_ESCROW_ADDRESS=0x...contractV2
NEXT_PUBLIC_USDC_ADDRESS=0x...USDC_Fuji
NEXT_PUBLIC_FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
NEXT_PUBLIC_RECEIPT_LOG_ADDRESS=0x...receiptV2
ASKPAY_L1_RPC_URL=https://...rpc-cua-chain-receipt
ASKPAY_L1_CHAIN_ID=...chain-id-thuc-te
ORACLE_PRIVATE_KEY=...chi-dat-o-backend-khong-commit
ASKPAY_PAYMENT_CORPUS_SHA256=...noi-dung-corpus/demo-v1/manifest.sha256
ASKPAY_PAYMENT_CONFIRMATIONS=2
```

Không đặt private key vào biến `NEXT_PUBLIC_*`. Thiếu cấu hình trả 503 **trước khi frontend yêu cầu đặt cọc**. Chữ ký proof xác nhận quyền xử lý request, không chuyển thêm tiền.

**Breaking change:** field `questionHash` của escrow bây giờ chứa `requestHash(context)`, không chỉ hash câu hỏi. Frontend và BFF phải deploy cùng phiên bản. Khoản cọc cũ không được âm thầm chấp nhận; dùng luồng refund/timeout của phiên bản cũ. Chỉ hỗ trợ EOA; chưa có EIP-1271/smart wallets.

**Tên protocol:** `askpay-escrow-v2` là giao thức HTTP 402 riêng cho escrow. Không tuyên bố đã tương thích chuẩn x402 facilitator/exact scheme. Repo cũ gắn `x402Version: 1` cho `exact-escrow` chưa làm nó trở thành chuẩn. Nếu hackathon bắt buộc SDK x402 chính thức, đó là hạng mục tích hợp riêng cần chứng minh interoperability.

## Những gì CHƯA hoàn thành — đừng trình bày như đã có

1. Chưa chạy ví thực trên Fuji hay own L1; kết quả EVM cục bộ không thay thế explorer links.
2. Backend `demo_api` luôn `settlement_eligible=false`: câu đúng cũng đi refund nếu có cọc và oracle xử lý được. Để demo release cho câu pháp lý thật, cần policy và corpus được chuyên gia duyệt. Test contract release dùng verdict fixture được ghi rõ.
3. Chưa có durable job/answer journal. Hợp đồng chặn double payout nhưng hai worker vẫn có thể cùng chạy QA/ghi receipt; receipt thành công mà settlement lỗi cần reconcile. Không quảng cáo exactly-once hoặc idempotency đa instance.
4. Chưa có nút claimTimeoutRefund trong UI. Contract có hàm này; timeout **cho phép claim**, không tự xuất hiện giao dịch hoàn tiền nếu không có người/bot gọi.
5. Chưa audit smart contract/RPC trust; không bật mainnet chỉ dựa trên test suite.
6. API snapshot cũ và `build_corpus.py` của repo còn metadata cần rà soát. Bản vá không công nhận toàn bộ 2.581 khoản là hiện hành. Demo API mới không dùng fallback đó; đừng bật lại fallback để chạy paid.
7. Next.js 14.2.15 của baseline là bản cũ, cần nâng lên phiên bản được hỗ trợ và kiểm thử riêng trước khi mở dịch vụ công khai thu phí.

## Nối LegalIR / LegalQA của nhóm

Giữ `ai-service/legal_pipeline.py` làm adapter contract:

- `retrieve(question, snapshot, as_of, top_k)` trả **ID** của điều/khoản/điểm thuộc phiên bản hợp lệ. Backend lấy text từ snapshot, không tin text do retriever tự gửi.
- `answer(question, evidence, tier, as_of)` trả `ANSWERED / NEEDS_CLARIFICATION / INSUFFICIENT_EVIDENCE / OUT_OF_SCOPE`, câu trả lời và 1–3 citations nguyên đối tượng.
- `assess(...)` đánh giá relevance + support; đó là đánh giá chất lượng, không phải chứng minh pháp lý tất định.
- Validator kiểm tra nguyên văn riêng; chỉ bật paid release khi có policy xét cả trạng thái nguồn, phiên bản, relevance/support và kết quả validator. **Không OR với `verified: true` trong JSON.**

Khi model sẵn sàng, chạy `main:app` với `ASKPAY_CORPUS_MANIFEST` và `ASKPAY_LEGAL_ADAPTER`; vẫn phải nối nhánh factcheck riêng vì `demo_api` đã cung cấp nhánh đó còn `main` có thể không có. Đừng đổi server entrypoint âm thầm trên môi trường đang có cọc.
