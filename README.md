# AskPay XNK

**Tra cứu pháp luật xuất nhập khẩu có nguồn đối chiếu, với cơ chế giữ phí và hoàn tiền khi kiểm tra không đạt.**

Quick: **0,05 USDC** · Deep: **0,20 USDC** — giá thử nghiệm trên testnet.

[**Mở demo**](https://askpay-virid.vercel.app/) · [**Chạy cục bộ / cấu hình payment**](docs/demo-readiness/README.md) · [**Kết quả kiểm tra bản deploy**](docs/demo-readiness/LATEST_REVIEW.md)

> Bản vá trong repo cần được deploy riêng; link demo có thể còn chạy phiên bản trước. Corpus demo có đối chiếu nguồn tự động, chưa được chuyên gia pháp lý duyệt. Khớp đoạn trích không tự chứng minh kết luận pháp lý đúng.

## Xem trong 3 phút

1. Chọn **Dùng thử demo**, hỏi thời hạn nộp tờ khai nhập khẩu.
2. Chọn **Kiểm chứng nguồn**, sửa “30 ngày” thành “60 ngày” hoặc thử Điều 999.
3. Hỏi về máy tiện cũ từ Nhật, thiếu mã HS và nhập để bán lại: hệ thống phải hỏi thêm, không tự kết luận đủ điều kiện.
4. Xem nguồn và trạng thái tiền riêng. Chưa có explorer link xác nhận thì không coi là release/refund thật.

## Đã có và còn thiếu

| Thành phần | Bằng chứng / giới hạn |
|---|---|
| Web chat, Quick/Deep, factcheck | UI có sẵn; bản vá đưa factcheck về snapshot chính xác |
| Corpus rộng | 45 tài liệu / 2.581 đơn vị trong dữ liệu cũ; không đồng nghĩa 2.581 khoản đã được rà soát hiệu lực |
| Corpus demo được chọn | 6 văn bản / 34 đơn vị trích dẫn + PDF + SHA-256, mốc 17/11/2026 |
| LegalIR/LegalQA | Adapter có sẵn; `demo_api` là rule-based có giới hạn, chưa thay model của nhóm |
| Payment proof | RPC + calldata/events + token transfer + pending escrow + chữ ký ví; test Quick/Deep trên local EVM |
| HTTP 402 | Giao thức riêng `askpay-escrow-v2`; chưa chứng minh tương thích x402 facilitator chuẩn |
| Release/refund/timeout | Contract chạy được trong local EVM; cần explorer evidence Fuji cho bản thi |
| ReceiptLog | Có contract; own L1 phải có deployment/RPC/chain ID và receipt thực mới coi là hoàn thành |

## Cách hoạt động

Frontend đặt USDC vào AnswerEscrow trên C-Chain, rồi ký xác nhận request. Backend kiểm tra proof với RPC trước khi xử lý. LegalIR lấy căn cứ đúng phiên bản; LegalQA tạo câu trả lời; validator đối chiếu trích dẫn. Policy cho phép release hoặc refund; lỗi sau đặt cọc phải giữ trạng thái pending để đối soát. Receipt lưu hash câu hỏi/đáp án/citation/validator/corpus để tái kiểm tra; hash không thay cho nội dung và quy trình rà soát.

**Bản demo source-backed hiện chưa cho release câu trả lời pháp lý** vì chưa có rà soát chuyên môn. Contract release được kiểm tra bằng fixture trong test, ghi rõ khi trình bày.

## Chạy nhanh

```bash
npm ci
python -m pip install -r ai-service/requirements.txt
python -m uvicorn demo_api:app --app-dir ai-service --port 8000
```

Terminal khác: `npm run dev`. Xem [hướng dẫn cấu hình](docs/demo-readiness/README.md) cho URL backend, testnet và migration request hash.

```bash
python -m unittest discover -s ai-service/tests -q
npm run test:payment
npm run build
```

## Đường dẫn cho người review

- [Payment verifier](app/api/ask-and-settle/verify-payment.mjs) và [request commitment](app/lib/payment-request.mjs).
- [Corpus demo](corpus/demo-v1/manifest.json), [nguồn tải chính thức](corpus/demo-v1/sources/downloads.json).
- [Backend demo](ai-service/demo_api.py), [adapter LegalIR/LegalQA](ai-service/legal_pipeline.py).
- [Contract](contracts/AskPayEscrow.sol), [integration test local EVM](tests/payment-proof.integration.test.mjs).
- [Kế hoạch pitching và phần còn lại](docs/demo-readiness/PITCHING_PLAN.md).

Không công bố hallucination rate chỉ từ tỷ lệ excerpt khớp; cần bộ câu hỏi holdout và đánh giá relevance/support riêng. Không thêm bonus trước khi hoàn thiện corpus, proof và bằng chứng giao dịch.
