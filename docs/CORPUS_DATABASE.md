# Kho nguồn và snapshot AskPay

`data/askpay-source-registry.sqlite3` là database danh mục nguồn, được tạo từ `research/legal-sources/manifest.json` bằng `source_registry.py`. Database ghi mã văn bản, URL, tên tệp tương đối, SHA-256, kích thước và trạng thái kiểm tra chữ ký. Nó không biến nguồn hoặc OCR thành nội dung đã duyệt, không xác nhận tình trạng hiệu lực pháp luật và không bao gồm toàn văn đã duyệt. Mục không có tệp vẫn nằm trong danh mục.

Tạo lại database sau khi nhận manifest nguồn:

```bash
python ai-service/source_registry.py research/legal-sources/manifest.json data/askpay-source-registry.sqlite3
```

Import một snapshot đã đối chiếu vào database:

```bash
python ai-service/corpus_cli.py import-db /duong-dan/snapshot.json data/askpay-source-registry.sqlite3
python ai-service/corpus_cli.py check-db data/askpay-source-registry.sqlite3 TEN_SNAPSHOT
```

Manifest dùng cấu trúc trong `KHO_LUAT_PHIEN_BAN.md`; mỗi khoản phải khai báo `review_status` là `VERIFIED` hoặc `UNREVIEWED` và `legal_status` là `ACTIVE`, `EXPIRED` hoặc `UNKNOWN`. Khoản `VERIFIED` cần đầy đủ người duyệt, thời điểm duyệt, bằng chứng hiệu lực và `verified_through`. Tệp nguồn phải có trong danh mục và đúng SHA-256. Snapshot ID không thể dùng lại với nội dung khác.

Đặt `ASKPAY_CORPUS_DATABASE` trỏ tới database và `ASKPAY_CORPUS_SNAPSHOT_ID` là ID snapshot để FastAPI dùng database. Khi đọc, dịch vụ kiểm tra lại manifest và tệp nguồn, rồi đối chiếu các khoản trong database với snapshot; lỗi toàn vẹn trả HTTP 503. Retriever chỉ chọn khoản `VERIFIED`, `ACTIVE`, có review còn giá trị và đúng khoảng hiệu lực cho ngày tra cứu. Nếu chưa có snapshot đã duyệt thì cần đưa snapshot vào trước. Xác nhận OCR bên dưới không tự tạo snapshot hoặc xác nhận hiệu lực pháp luật.

Database và manifest/tệp nguồn phải được triển khai cùng nhau, giữ nguyên quan hệ đường dẫn tương đối. Không cấu hình một bản SQLite cục bộ không bền vững làm nguồn thanh toán cho nhiều instance serverless; cần storage dùng chung có locking và backup phù hợp.

## Xác nhận đã duyệt OCR

Theo xác nhận của người dùng, bảng `ocr_review_attestations` ghi `VERIFIED` cho từng trang OCR dựa trên SHA-256 của chính trang và tệp nguồn. Nội dung gốc không bị sửa; thay đổi trang sẽ làm xác nhận cũ không còn khớp. Xác nhận này phản ánh lời xác nhận của người dùng, không khẳng định tình trạng hiệu lực pháp luật hoặc tự đưa trang vào retriever.

```bash
python ai-service/ocr_attestation.py research/extracted data/askpay-source-registry.sqlite3 --statement 'tất cả ocr đều đã đọc rồi verifed dùm'
```

## Truy xuất với mô hình UIT

Retriever mặc định dùng BM25. Để bật xếp hạng kết hợp, cài `ai-service/requirements-retrieval.txt`, rồi đặt `ASKPAY_EMBEDDING_MODEL` và/hoặc `ASKPAY_RERANKER_MODEL` thành đường dẫn thư mục mô hình cục bộ; `ASKPAY_MODEL_DEVICE` mặc định là `cpu`. Có thể dùng các mô hình `bqbbao6_vietnamese-legal-embedding` và `thanhtantran_Vietnamese_Reranker` trong thư mục UIT. Trọng số mô hình không được đưa vào Git. Khi cấu hình đường dẫn sai hoặc không tải được mô hình, API trả 503; không tự tải mô hình từ mạng.

Chỉ các điều khoản đã qua lọc trạng thái review và ngày hiệu lực mới được gửi tới mô hình; BM25 tạo tập ứng viên và RRF kết hợp thứ hạng embedding và cross-encoder. API trả `retrieval_method` để phân biệt `BM25` và `HYBRID`. Chưa có bộ câu hỏi gán nhãn AskPay để đo chất lượng thực tế; kết quả đánh giá UIT không đại diện cho corpus AskPay.

## LegalQA JSON có cấu trúc

Mặc định API trả đoạn nguyên văn (`ASKPAY_LEGALQA_MODE=extractive`). Đặt `ASKPAY_LEGALQA_MODE=llm`, cấu hình `LLM_API_KEY` và `LLM_QUICK_MODEL`/`LLM_DEEP_MODEL` để bật chế độ LLM. Chỉ các đoạn đã truy xuất và còn đủ điều kiện mới được gửi cho nhà cung cấp mô hình. Phản hồi phải theo JSON schema, trích ít nhất 10 từ nguyên văn và khớp một đoạn duy nhất; sau đó citation vẫn được validator kiểm tra. Danh sách citation rỗng được validator đánh trượt. Không bật chế độ này trước khi đã đánh giá nhà cung cấp, dữ liệu gửi đi và chi phí sử dụng.
