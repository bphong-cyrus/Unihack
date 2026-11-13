# Dữ liệu tách từ văn bản gốc

`122019ttbct-candidates.json` là kết quả tách tự động từ tệp Word của Bộ Công Thương trong `../legal-sources/122019ttbct/01.rar`. File ghi SHA-256 của RAR và Word, tên thành viên, các đoạn văn và ranh giới điều theo quy tắc nhận diện tiêu đề. Bản này chưa được đối chiếu với chữ ký số, phụ lục, sửa đổi hay hiệu lực; không được sử dụng như corpus được duyệt. Nội dung Word có thể chứa định dạng hoặc phần tử mà bộ tách chưa biểu diễn; kiểm tra thủ công trước khi chia khoản.

`../KIEM_TRA_TRICH_XUAT.json` ghi số ký tự trích xuất tại trang đầu, giữa và cuối từng PDF bằng pypdf. Đây chỉ là phép lấy mẫu kỹ thuật, không phải kết quả OCR hay kiểm tra đầy đủ toàn văn. Tệp RAR và RTF không nằm trong kết quả này. Cần OCR tiếng Việt và so sánh với ảnh gốc cho những PDF không có lớp chữ.
