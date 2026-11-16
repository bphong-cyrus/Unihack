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

## Đối soát x402 v2

`ASKPAY_X402_ENABLED` mặc định tắt. Khi bật, `/api/v1/legal/ask` yêu cầu snapshot và dùng cấu hình facilitator + `AnswerEscrow` riêng; đây là luồng khác với `AskPayEscrow` đang dùng trong giao diện. Chưa bật trên môi trường triển khai cho tới khi thống nhất contract, UI và kiểm thử Fuji. `ASKPAY_PAYMENT_DB` phải nằm trên volume SQLite bền vững hỗ trợ locking; không dùng filesystem tạm của serverless. Endpoint `/api/v1/legal/recover` dùng header `x-askpay-recovery-token`; worker cũng chạy khi khởi động.

Đối soát `PAYMENT_INITIATED` cần endpoint trạng thái riêng do facilitator cung cấp trong `ASKPAY_FACILITATOR_STATUS_URL`. Adapter yêu cầu phản hồi khớp query, ví, nonce, mạng, tài sản, người nhận và số tiền; chỉ đánh dấu thất bại khi trạng thái phủ định có tính xác quyết sau hạn chữ ký. Nếu không thể xác định, giữ trạng thái chờ. Đặt token và private key trong secret manager, không commit.

Giao diện dùng địa chỉ `NEXT_PUBLIC_ANSWER_ESCROW_ADDRESS` để kiểm tra người nhận trước khi ký. Backend cần `ASKPAY_PUBLIC_LEGAL_URL` trùng URL công khai `/api/v1/legal/ask` để ràng buộc chữ ký với endpoint. Khi ví được bật nhưng chưa có hai cấu hình phù hợp, giao diện báo lỗi và không chuyển sang thanh toán AVAX; chế độ preview vẫn dùng riêng. Nếu phản hồi sau chữ ký không xác định được kết quả, giao diện hiển thị mã câu hỏi và không tự gửi lại chữ ký.

## Ứng viên Điều từ OCR

`ocr_article_candidates` là vùng chuẩn bị dữ liệu, không phải snapshot được phép truy xuất: bộ tách nhận diện dòng bắt đầu bằng `Điều`, lưu nguyên các dòng OCR dưới dạng NFC cùng đường dẫn trang, SHA-256 trang và chỉ số dòng. Các trang đã được người dùng xác nhận OCR, nhưng ranh giới Điều và tình trạng hiệu lực của từng ứng viên vẫn cần kiểm tra độc lập; vì vậy `structure_status=UNREVIEWED`, `legal_status=UNKNOWN`. Không tự suy ra Khoản hay hiệu lực từ OCR. Nhiều Điều trùng số có thể đến từ văn bản sửa đổi, phụ lục hoặc lỗi nhận diện.

```bash
python ai-service/ocr_candidates.py research/extracted data/askpay-source-registry.sqlite3
```

Lệnh kiểm tra lại hash trang và tệp nguồn; nếu trang không khớp xác nhận hoặc đã có quyết định review cấu trúc/hiệu lực trong bảng, lệnh dừng và giữ dữ liệu đang có. Mỗi bộ OCR được lưu riêng, kể cả khi cùng văn bản có nhiều bộ hoặc phần phụ lục.

## Quan sát hiệu lực ở cấp văn bản

`research/status-evidence/observations.json` ghi các quan sát có liên kết tới CSDL quốc gia về văn bản pháp luật. Các trang gốc không mở trực tiếp được trong môi trường thu thập; dữ liệu được đối chiếu qua kết quả tìm kiếm đã lập chỉ mục, nên `source_access=indexed_search_cache` và `recorded_at` chỉ là thời điểm ghi, không chứng minh trang gốc còn trạng thái đó tại thời điểm hiện tại. Cần tải và lưu bản gốc, kiểm tra lại trước khi dùng như bằng chứng phát hành.

Hai văn bản `127/2013/NĐ-CP` và `128/2013/TT-BTC` được gắn `EXPIRED` trong danh mục nguồn, lần lượt từ 10/12/2020 và 01/04/2015. Bốn văn bản có ghi nhận hết hiệu lực một phần chỉ được lưu là quan sát `PARTIALLY_EXPIRED`; không tự đánh dấu toàn văn `ACTIVE` hoặc `EXPIRED`. Những quan sát cấp văn bản này không tự duyệt ranh giới Điều/Khoản và chưa đưa nội dung OCR vào snapshot hoặc validator.

```bash
python ai-service/status_evidence.py data/askpay-source-registry.sqlite3 research/status-evidence/observations.json
```
