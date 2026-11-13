# AskPay XNK: thiết kế và kế hoạch triển khai

## Mục tiêu và giới hạn

Tra cứu pháp luật XNK với trích dẫn có nguồn, kiểm tra độc lập và quyết toán theo hợp đồng. Giao diện Next.js hiện có được giữ làm điểm tương tác. Bản hiện tại chỉ là demo: bảy đoạn mẫu chưa được xác thực, câu trả lời theo từ khóa; không dùng để tư vấn hoặc quyết toán thật. Kiểm tra chuỗi trích dẫn không chứng minh câu trả lời đúng hay văn bản còn hiệu lực.

## Kiến trúc đích

1. **Nguồn luật và biên tập**: lưu bản gốc, URL cơ quan phát hành, thời điểm tải, hash, định dạng, lịch sử sửa đổi, ngày bắt đầu/kết thúc hiệu lực và bằng chứng cho từng điều/khoản/điểm. Nhập vào khu vực chờ; người có thẩm quyền đối chiếu văn bản gốc và duyệt từng phiên bản. Không tự suy ra tình trạng hiệu lực cấp khoản từ trạng thái cả văn bản. Ghi lại người duyệt, thời điểm và phiên bản. Thiếu bằng chứng, quá hạn kiểm tra hoặc xung đột sửa đổi phải đánh dấu chưa xác minh và không đủ điều kiện thu tiền.
2. **LegalIR**: index phiên bản đã duyệt theo điều/khoản/điểm và khoảng thời gian hiệu lực; lọc ngày áp dụng trước truy xuất, kết hợp tìm từ khóa và tìm ngữ nghĩa, gộp/xếp hạng, mở rộng tham chiếu. Tách tập đánh giá theo câu hỏi và thời gian; đo recall@k, MRR và độ bao phủ điều khoản liên quan.
3. **LegalQA**: adapter nhận câu hỏi, ngày áp dụng, tier và các đoạn đã truy xuất. Sinh câu trả lời kèm trích dẫn chứa định danh phiên bản và đoạn gốc. Không có bằng chứng phù hợp thì từ chối; không dùng câu trả lời mẫu làm căn cứ pháp lý. Phân biệt quote matching với đánh giá tính hỗ trợ của từng nhận định; câu trả lời vẫn cần người chuyên môn xem xét trong trường hợp cần thiết.
4. **Validator độc lập**: một implementation dùng chung cho `/ask` và `/validate`, không có bản TypeScript khác quy tắc. Kiểm tra tài liệu, điều/khoản/điểm, hiệu lực tại ngày hỏi và trích dẫn tối thiểu 10 từ, độ khớp >=0,90; tất cả trích dẫn phải đạt, không trích dẫn thì thất bại. Kết quả chứa lý do, phiên bản corpus/validator và hash dữ liệu đầu vào. Điểm trọng số 25/25/20/30 chỉ mô tả phép kiểm tra, không phải xác suất đúng hoặc bảo đảm pháp lý.
5. **API và UI**: giữ hợp đồng ba endpoint trong `REST_API_SPEC_FOR_RAG_TEAM.md`; bổ sung metadata nguồn, ngày áp dụng, phiên bản, trạng thái dữ liệu, và trạng thái settlement riêng với verdict trích dẫn. UI hiển thị nguồn và ngày, phân biệt kiểm tra trích dẫn với đúng nội dung, hiển thị lỗi khi dịch vụ không sẵn sàng. Các tình huống, luật sư và dữ liệu ví mẫu phải được đánh dấu demo.
6. **Thanh toán**: trước khi mở tiền thật, xác minh question ID, asker, tier, số tiền, chain, địa chỉ contract và hash câu hỏi so với escrow đã xác nhận; không để request bất kỳ tự kích hoạt oracle. Tách các trạng thái chưa nộp, pending, biên lai đã xác nhận, settlement đã xác nhận, thất bại và timeout. Kiểm tra receipt `success` và finality, xử lý retry idempotent và khôi phục khi một giao dịch thành công còn giao dịch khác thất bại; không tạo hash giao dịch giả hoặc báo hoàn tiền khi chưa có xác nhận. Thiết kế USDC/x402 thật cần token, chain và luồng ký tương ứng; AVAX testnet hiện tại không phải USDC hay x402.
7. **Vận hành và bảo mật**: xác thực và phân quyền người gọi/oracle, giới hạn tốc độ, quản lý secret, log không chứa câu hỏi nhạy cảm, theo dõi phiên bản corpus và mô hình, cảnh báo dữ liệu hết hạn, hàng đợi đối soát và timeout. Kiểm thử contract độc lập và audit trước khi dùng tiền thật.

## Thứ tự triển khai và điều kiện hoàn thành

- **A — loại bỏ giả định nguy hiểm:** kiểm thử trước rằng API lỗi khi dịch vụ mất và không trả giao dịch giả; UI không gửi tiền và báo demo. Xác minh bằng test, build và kiểm tra luồng chính/ lỗi.
- **B — corpus có xuất xứ:** nhập 30 văn bản được chỉ định bằng nguồn chính thức, lưu bản gốc/hash, tách điều khoản, quan hệ sửa đổi và lịch sử hiệu lực; người chuyên môn đối chiếu, kiểm thử trường hợp hết hiệu lực một phần và thời điểm quá khứ. Danh mục chưa rõ trong đặc tả (FTA và hai văn bản hết hiệu lực) cần được xác định bằng nguồn và duyệt.
- **C — retrieval và QA:** triển khai adapter index/retrieval/generator trên dữ liệu đã duyệt, test câu hỏi trong và ngoài phạm vi, không tìm được bằng chứng, văn bản sửa đổi, deep/quick; báo kết quả đánh giá trên bộ dữ liệu độc lập, không suy ra chất lượng từ test kỹ thuật.
- **D — kiểm chứng và API:** test bốn cổng với ranh giới 0,90, trích dẫn sai, nhiều trích dẫn, nguồn thiếu và hiệu lực theo ngày; đối chiếu cùng kết quả qua hai endpoint, version/hash ổn định. Định nghĩa hợp đồng dữ liệu và các thay đổi tương thích UI.
- **E — settlement:** test mạng cục bộ/testnet các ca gửi cọc, release, refund, timeout, sai hash/người hỏi/số tiền, gửi lặp, receipt thất bại và retry; chỉ mở sau khi kiểm toán hợp đồng và kết quả corpus/QA được phê duyệt. Không triển khai mainnet như một phần của demo.
- **F — tích hợp:** chạy test backend, frontend, hợp đồng, kiểm tra responsive và luồng trình duyệt, đối soát giao dịch testnet, cập nhật tài liệu triển khai. Đồng bộ lại nhánh chính trước khi hợp nhất, xử lý xung đột và kiểm thử lại.

## Các quyết định cần xác nhận trước khi vận hành thật

Nguồn và phiên bản corpus đã được chuyên gia duyệt; nhà cung cấp mô hình và chi phí; tập đánh giá và ngưỡng; chain/địa chỉ token USDC và phương án x402; chính sách lưu trữ dữ liệu khách hàng; chủ sở hữu ví và quy trình vận hành oracle. Không có các quyết định này, hệ thống không thể được coi là hoàn chỉnh để thu phí thật.
