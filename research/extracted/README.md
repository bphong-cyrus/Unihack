# Dữ liệu tách từ văn bản gốc

`122019ttbct-candidates.json` là kết quả tách tự động từ tệp Word của Bộ Công Thương trong `../legal-sources/122019ttbct/01.rar`. File ghi SHA-256 của RAR và Word, tên thành viên, các đoạn văn và ranh giới điều theo quy tắc nhận diện tiêu đề. Bản này chưa được đối chiếu với chữ ký số, phụ lục, sửa đổi hay hiệu lực; không được sử dụng như corpus được duyệt. Nội dung Word có thể chứa định dạng hoặc phần tử mà bộ tách chưa biểu diễn; kiểm tra thủ công trước khi chia khoản.

`../KIEM_TRA_TRICH_XUAT.json` ghi số ký tự trích xuất tại trang đầu, giữa và cuối từng PDF bằng pypdf. Đây chỉ là phép lấy mẫu kỹ thuật, không phải kết quả OCR hay kiểm tra đầy đủ toàn văn. Tệp RAR và RTF không nằm trong kết quả này. Cần OCR tiếng Việt và so sánh với ảnh gốc cho những PDF không có lớp chữ.

`122019ttbct-review-queue.json` chia các đoạn thành 126 mục ứng viên theo số khoản; `source_paragraph_indexes` là vị trí không tính lại theo một điều trong tệp candidates gốc (bắt đầu từ 0). Mục `preamble` là phần dẫn trước khoản đầu tiên, `0` là điều không phát hiện khoản đánh số. Nhãn, điểm, bảng, phụ lục, sửa đổi và nội dung giáp ranh vẫn cần soát thủ công; tất cả mục đều `UNREVIEWED` và không tự động nạp vào API.

Để tạo trang đối chiếu chỉ đọc cho một trang OCR đã có, chạy `python3 ai-service/ocr_review.py research/extracted/ocr-1282020ndcp/page-001.json --out research/extracted/ocr-1282020ndcp/page-001-review.html`, sau đó mở HTML trong trình duyệt. Công cụ kiểm tra SHA-256 PDF trước khi tạo trang; điểm OCR không phải xác nhận nội dung. Nếu trình duyệt chặn PDF ở URL `file:`, có thể dùng máy chủ HTTP cục bộ cho riêng thư mục dự án trong lúc rà soát.

Để tạo danh mục và trang đối chiếu cho toàn bộ trang đã OCR, chạy `python3 ai-service/ocr_review_batch.py research/extracted/ocr-112020ttbct-02 /tmp/askpay-review-112020-02` rồi mở `index.html` trong thư mục đầu ra. Thư mục đầu ra phải chưa tồn tại; công cụ không ghi đè dữ liệu cũ và kiểm tra toàn bộ nguồn trước khi tạo trang. Đây là công cụ đọc, không ghi nhận phê duyệt.

Để tiếp tục nhận dạng một PDF gốc: `python3 ai-service/ocr_batch.py research/legal-sources/232025ttbct/01.pdf research/extracted/ocr-232025ttbct --document-id '23/2025/TT-BCT'`. Công cụ yêu cầu `mutool`, `pypdf`, `torch`, EasyOCR và bộ model tiếng Việt/Anh đã cài sẵn; không tự tải model. Có thể chạy lại cùng lệnh sau khi gián đoạn: các trang đã lưu được kiểm tra hash, đường dẫn nguồn, số trang và cấu hình trước khi xử lý tiếp. Không trộn trang từ nguồn hoặc cấu hình khác trong cùng thư mục. Kết quả vẫn là OCR chưa duyệt, không xác nhận chữ ký hoặc hiệu lực pháp luật; phải đối chiếu từng trang với bản gốc và kiểm tra văn bản sửa đổi trước khi sử dụng.

Với Thông tư 11/2020/TT-BCT, `ocr-112020ttbct-01/` và `ocr-112020ttbct-02/` lần lượt chứa kết quả nhận dạng hai tệp nguồn (2 và 78 trang). Kết quả chưa được đối chiếu với bản gốc, chưa xác minh bố cục bảng, nội dung phụ lục hay hiệu lực.

`542014qh13-heading-candidates.json` là chỉ mục tự động các dòng có dạng tiêu đề điều trong OCR Luật Hải quan 2014, giữ số trang và chỉ số dòng bắt đầu từ 0 để đối chiếu. Công cụ `python3 ai-service/ocr_headings.py research/extracted/ocr-542014qh13 --out <tệp-mới.json>` chỉ xử lý bộ trang đầy đủ và khớp hash. Việc tìm kiếm bỏ qua khác biệt dấu nhưng giữ nguyên dòng OCR gốc. Chỉ mục hiện có ứng viên cho các số 1–104; điều này không chứng minh các vị trí đúng hay đầy đủ. Đây không phải phân đoạn điều khoản đã duyệt: OCR có thể bỏ sót, nhận nhầm tiêu đề hoặc coi điều được sửa đổi trong nội dung là điều của văn bản.

`1072016qh13-heading-candidates.json` tương tự cho Luật Thuế xuất khẩu, thuế nhập khẩu 2016: có 22 dòng ứng viên mang số 1–22, chưa được đối chiếu bản gốc hoặc rà soát hiệu lực. Không dùng chỉ mục này như nội dung luật đã duyệt.

`312018ndcp-heading-candidates.json` là chỉ mục tương tự cho Nghị định 31/2018/NĐ-CP. Có 33 dòng ứng viên; trong dải số 1–35, công cụ chưa nhận ra số 7 và 8. Kết quả có thể thiếu hoặc nhầm dòng và chưa được đối chiếu bản gốc hay rà soát hiệu lực.
