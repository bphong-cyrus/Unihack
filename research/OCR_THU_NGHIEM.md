# Thử nghiệm OCR trên tài liệu quét

Trang 1 của `legal-sources/1282020ndcp/01.pdf` được render bằng MuPDF ở 150 DPI và đối chiếu trực quan với kết quả EasyOCR tiếng Việt/tiếng Anh trên CPU. Với bốn luồng PyTorch và model có sẵn, lần chạy mẫu mất khoảng 16 giây. Một lần chạy không giới hạn luồng bị dừng sau hơn hai phút vì dùng quá nhiều CPU.

Kết quả nhận dạng được phần lớn bố cục chữ, nhưng có lỗi quan trọng: ngày `19` được nhận thành `49`, và cụm `hành vi` bị nhận thành `hành vị`. Đây là thử nghiệm một trang, không phải đánh giá độ chính xác trên toàn corpus. Không dùng OCR này để tự động xác nhận nguyên văn hoặc hiệu lực; cần giữ ảnh gốc, vị trí trang và quy trình sửa/duyệt bởi người có chuyên môn. Chưa chạy OCR toàn bộ tài liệu.
