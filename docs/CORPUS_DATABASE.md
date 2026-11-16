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
