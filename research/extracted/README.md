# Dữ liệu tách từ văn bản gốc

`122019ttbct-candidates.json` là kết quả tách tự động từ tệp Word của Bộ Công Thương trong `../legal-sources/122019ttbct/01.rar`. File ghi SHA-256 của RAR và Word, tên thành viên, các đoạn văn và ranh giới điều theo quy tắc nhận diện tiêu đề. Bản này chưa được đối chiếu với chữ ký số, phụ lục, sửa đổi hay hiệu lực; không được sử dụng như corpus được duyệt. Nội dung Word có thể chứa định dạng hoặc phần tử mà bộ tách chưa biểu diễn; kiểm tra thủ công trước khi chia khoản.

`../KIEM_TRA_TRICH_XUAT.json` ghi số ký tự trích xuất tại trang đầu, giữa và cuối từng PDF bằng pypdf. Đây chỉ là phép lấy mẫu kỹ thuật, không phải kết quả OCR hay kiểm tra đầy đủ toàn văn. Tệp RAR và RTF không nằm trong kết quả này. Cần OCR tiếng Việt và so sánh với ảnh gốc cho những PDF không có lớp chữ.

`122019ttbct-review-queue.json` chia các đoạn thành 126 mục ứng viên theo số khoản; `source_paragraph_indexes` là vị trí không tính lại theo một điều trong tệp candidates gốc (bắt đầu từ 0). Mục `preamble` là phần dẫn trước khoản đầu tiên, `0` là điều không phát hiện khoản đánh số. Nhãn, điểm, bảng, phụ lục, sửa đổi và nội dung giáp ranh vẫn cần soát thủ công; tất cả mục đều `UNREVIEWED` và không tự động nạp vào API.

Để tạo trang đối chiếu chỉ đọc cho một trang OCR đã có, chạy `python3 ai-service/ocr_review.py research/extracted/ocr-1282020ndcp/page-001.json --out research/extracted/ocr-1282020ndcp/page-001-review.html`, sau đó mở HTML trong trình duyệt. Công cụ kiểm tra SHA-256 PDF trước khi tạo trang; điểm OCR không phải xác nhận nội dung. Nếu trình duyệt chặn PDF ở URL `file:`, có thể dùng máy chủ HTTP cục bộ cho riêng thư mục dự án trong lúc rà soát.

Để tiếp tục nhận dạng một PDF gốc: `python3 ai-service/ocr_batch.py research/legal-sources/232025ttbct/01.pdf research/extracted/ocr-232025ttbct --document-id '23/2025/TT-BCT'`. Công cụ yêu cầu `mutool`, `pypdf`, `torch`, EasyOCR và bộ model tiếng Việt/Anh đã cài sẵn; không tự tải model. Có thể chạy lại cùng lệnh sau khi gián đoạn: các trang đã lưu được kiểm tra hash, đường dẫn nguồn, số trang và cấu hình trước khi xử lý tiếp. Không trộn trang từ nguồn hoặc cấu hình khác trong cùng thư mục. Kết quả vẫn là OCR chưa duyệt, không xác nhận chữ ký hoặc hiệu lực pháp luật; phải đối chiếu từng trang với bản gốc và kiểm tra văn bản sửa đổi trước khi sử dụng.

Với Thông tư 11/2020/TT-BCT, `ocr-112020ttbct-01/` và `ocr-112020ttbct-02/` lần lượt chứa kết quả nhận dạng hai tệp nguồn (2 và 78 trang). Kết quả chưa được đối chiếu với bản gốc, chưa xác minh bố cục bảng, nội dung phụ lục hay hiệu lực.
