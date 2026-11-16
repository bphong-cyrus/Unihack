# Kế hoạch sửa đánh giá AskPay

1. Bảo vệ thanh toán và cache: test proof rỗng, giả mạo, replay khác câu hỏi/tier và request đồng thời trước; endpoint phải từ chối proof chưa được xác thực trên Fuji và không trả cache sai request. Chỉ báo giao dịch sau receipt thật.
2. Tách factcheck khỏi hỏi đáp: test Điều/Khoản không tồn tại và đoạn 60 ngày so với nguồn 30 ngày; giữ nguyên đối tượng người dùng, hiển thị sai khác và từ chối khi không có nguồn được duyệt.
3. Corpus/database: tạo kho bền vững có nguồn, hash, status pháp lý, review và version; nhập dữ liệu có provenance, chỉ truy xuất VERIFIED, kiểm tra câu hỏi ngoài corpus và ngăn căn cứ lệch chủ đề. Không suy diễn OCR thành dữ liệu đã duyệt.
4. UI và history: nối ví, USDC/x402, API factcheck, ghi nhãn lịch sử cũ chưa xác minh; test các trạng thái và layout. Không gán RELEASED/REFUNDED chỉ từ validation.
5. Chạy unit/integration, build, compile contract; kiểm thử ba luồng Fuji bằng giao dịch xác nhận khi cấu hình/số dư có sẵn. Đối chiếu main mới nhất, commit và push nhánh khi các cổng đạt.

6. Áp dụng kinh nghiệm UIT: TDD với snapshot giả lập cho tokenizer NFC, bigram, đối chiếu Điều/Khoản, RRF và chặn UNREVIEWED; sau đó triển khai lexical BM25 + phrase fusion, dense Vietnamese legal embedding và cross-encoder local có cấu hình rõ. DoD: chỉ xếp hạng provision đủ điều kiện trước khi gọi model; thứ hạng ổn định, không đưa text ngoài snapshot vào citation, và có kiểm thử khi model không sẵn sàng. Đánh giá Recall@k/MRR với câu hỏi AskPay gán nhãn riêng, không suy ra chất lượng AskPay từ điểm UIT; thiếu snapshot/nhãn thì ghi rõ chưa benchmark. Edge cases: Điều/Khoản không tồn tại, câu hỏi thiếu căn cứ, hết hiệu lực, phủ định và model lỗi.
