# Hướng phát triển để tăng cơ hội vào top pitching

Không thể bảo đảm vào top khi chưa có rubric và chất lượng đội khác. Mục tiêu thực tế: khiến giám khảo tự kiểm chứng được lời hứa cốt lõi trong 3 phút.

## Chốt phạm vi và lời hứa

Chọn **pháp lý xuất nhập khẩu cho sinh viên/logistics intern và doanh nghiệp nhỏ** cho bản thi. Không mở đầu bằng thuê trọ/lao động/giao thông nếu demo chỉ có XNK.

Lời giới thiệu đề xuất:
> AskPay giúp tra cứu quy định xuất nhập khẩu có nguồn đối chiếu. Khoản phí được giữ trong escrow, và được hoàn khi kiểm tra trích dẫn không đạt. Hệ thống nói rõ khi chưa đủ căn cứ để trả lời.

Không nói “không hallucination”, “AI đảm bảo đúng luật”, “L1 chứng minh đáp án đúng”. Hash tạo cam kết về dữ liệu đã dùng; muốn audit phải có nội dung tương ứng, verifier version và cách tái tạo. Không đăng câu hỏi pháp lý riêng tư lên dashboard. Public metrics phải dựa trên denominator/cases rõ ràng, không chỉ tỷ lệ excerpt khớp.

## Việc làm tiếp theo, theo thứ tự

| Mức | Việc | Đầu ra phải có mới coi là xong |
|---|---|---|
| P0 | Áp dụng proof verifier và bỏ nâng quyền settlement | Proof rỗng/giả, approve-only, sai payer/token/tier/date/corpus đều bị chặn; có request/receipt khớp |
| P0 | Chốt corpus demo | 6 văn bản/34 đơn vị có PDF, hash, phạm vi, amendment chain; chuyên gia ký xác nhận phần dùng để thu phí |
| P0 | Demo ba giao dịch Fuji | Link explorer deposit + release; deposit + refund; deposit + timeout claim; có số dư trước/sau và chain ID |
| P0 | Ghi receipt đúng chain | RPC/chain ID/contract tách biệt; own L1 chỉ nhận là hoàn thành khi có explorer/receipt thực tế |
| P1 | Nối LegalIR/LegalQA thật | Adapter hoạt động; 20–30 câu không trùng prompt mẫu; chặn irrelevant answer; thiếu dữ kiện thì hỏi lại |
| P1 | Chạy lại sau lỗi | Durable answer journal + worker lock + reconcile receipt/settlement; restart server không xử lý trùng hoặc làm mất đáp án đã trả tiền |
| P1 | UI recovery | Hiện trạng thái pending; xem giao dịch; thử lại request cũ; nút claimTimeoutRefund sau timeout; không tạo cọc mới khi retry |
| P1 | Chuẩn x402 nếu bắt buộc | Chọn SDK/scheme/facilitator chuẩn; bài test client khác gọi thành công. Custom HTTP 402 hiện tại phải ghi rõ |
| P2 | Đóng gói bằng chứng và slide | README 1 màn hình, video 2–3 phút, bảng case có kết quả, proof links; 6 slide |

**Không thêm lawyer marketplace, biology pack hay doanh thu chia sẻ ở vòng này.** Những chức năng đó chưa giải quyết lỗi tin cậy cốt lõi.

## 5 buổi triển khai đề xuất

1. **Buổi 1:** áp dụng bản vá trên branch; chạy tests; dựng backend demo; khóa phiên bản corpus. Giữ nguyên web đang chạy đến khi test đủ.
2. **Buổi 2:** chuyên gia/giảng viên luật đối chiếu các điều khoản dùng trong demo; ghi người rà soát, ngày, nguồn sửa đổi. Không chỉ sửa cờ `verified` thành true. Khóa policy release và đánh giá relevance.
3. **Buổi 3:** chạy EVM cục bộ rồi Fuji: đúng/sai/timeout; lưu bằng chứng. Demo timeout có thể dùng deployment test với timeout ngắn công khai, không giả vờ chờ 48h. Answer escrow hiện mặc định 5 phút; lawyer escrow 48h là bonus khác.
4. **Buổi 4:** nối model qua adapter, kiểm thử holdout, thêm worker/recovery nếu còn thời gian. Nếu model chưa đủ tốt, giới hạn phạm vi công khai, không đổi nhãn rule-based thành RAG.
5. **Buổi 5:** quay video một lần liền mạch, cập nhật README/slide theo bằng chứng thật. Nhờ người ngoài repo thử theo README trong 3 phút.

## LegalIR / LegalQA: triển khai gì trước

**IR:** index theo document/article/clause/point/version. Lọc ngày trước retrieval. BM25 + embedding có thể hybrid, rerank sau; score ngưỡng phải được hiệu chỉnh trên bộ holdout. Khi người dùng chỉ rõ điều khoản, ưu tiên exact lookup, không cho semantic retrieval thay thế đối tượng.

**QA:** prompt phải tách dữ kiện người dùng cung cấp, dữ kiện còn thiếu và kết luận có điều kiện. Không tự suy “từ Nhật” thành “sản xuất tại Nhật”; không suy “máy tiện” thành HS 84.58 đã được xác nhận. Output status và citations có schema. Deep thêm phân tích điều kiện có căn cứ, không chỉ tăng số trích dẫn.

**Validator:** nguyên văn/numeric/negation/existence/date là deterministic. Relevance, entailment và áp dụng luật là đánh giá khác; nếu dùng LLM judge thì ghi rõ xác suất và cách đo. Đừng cộng điểm citation thành “độ chính xác pháp lý”.

**Release policy:** dùng manifest đã được duyệt thực sự, ngày nằm trong review horizon, citations pass, answer status phù hợp và quality gate pass. Backend phải chịu trách nhiệm policy; BFF không được tự nâng quyền từ metadata có cùng document ID. Policy/version/hash phải đi cùng receipt.

**Durability:** bảng request lưu request hash + payer + deposit tx + state; unique question ID, unique deposit tx. Dùng compare-and-set hoặc transaction lock khi nhận job. Lưu câu trả lời và validation trước khi gửi receipt. Worker retry đọc trạng thái contract trước khi gửi lại. Cache chỉ tăng tốc, không làm nguồn quyết định thanh toán.

## Demo 3 phút: cho giám khảo thấy đủ

- **0:00–0:20:** login cũ + “Dùng thử demo”; nói rõ XNK, Quick/Deep và testnet.
- **0:20–0:50:** hỏi thời hạn tờ khai, mở nguồn đúng Điểm b Khoản 1 Điều 25. Tách “nguồn khớp” và “trạng thái tiền”.
- **0:50–1:15:** đổi 30→60 hoặc Điều 999; đối tượng giữ nguyên, chỉ ra lỗi. Mở giao dịch refund thực đã xác nhận (nếu không diễn trực tiếp, gắn nhãn replay/video).
- **1:15–1:45:** máy tiện cũ: trả đúng lĩnh vực, hỏi thêm HS/mục đích/nước sản xuất; không kết luận đủ điều kiện khi chưa biết.
- **1:45–2:15:** NĐ 128/2020 tại 17/11/2026: nhận biết hết hiệu lực và dẫn NĐ 169/2026; mở corpus version.
- **2:15–3:00:** explorer receipt + release/refund/timeout; cho thấy một proof giả bị từ chối. Nêu rõ phần chưa hoàn thành và kế hoạch pilot.

## GitHub → demo → slide

README đầu trang nên có: một câu sản phẩm, link video, nút demo, 3 case tiêu biểu, trạng thái thực/giả lập và bảng bằng chứng. Không để giám khảo tìm qua nhiều tài liệu cũ.

Thư mục `evidence/` của nhóm nên chứa `demo-results.json`, `payment-proofs.json`, video URL, commit SHA và corpus SHA. Chưa có giao dịch thì để null + “NOT_RUN”; không điền hash minh họa trông như thật.

Slide 6 trang:
1. Người dùng + tình huống sai luật gây chi phí cụ thể (phỏng vấn thật, không bịa số liệu).
2. Luồng hỏi → giữ phí → kiểm nguồn → release/refund.
3. Demo pass/fail và giới hạn “citation đúng ≠ kết luận đúng”.
4. Kiến trúc C-Chain / own L1 / off-chain và vai trò oracle.
5. Bằng chứng: holdout, citation false accept, irrelevant answer rate, abstention, latency p50/p95, gas đo thực tế, chi phí model/retrieval.
6. Pilot nhỏ + việc cần hoàn thiện. Quick 0,05 và Deep 0,20 USDC là giá thử nghiệm; chưa nói có lãi khi chưa đo model cost + chain cost + refund rate.

## UI cần sửa ít nhưng đúng

Giữ màn login theo ý bạn; thêm **Dùng thử miễn phí** rõ ràng. Chat mở bằng “Bạn muốn hỏi gì về xuất nhập khẩu?” và 3 ví dụ demo. Đưa danh mục văn bản vào nút **Nguồn đối chiếu**, không bày toàn bộ ngay trang đầu. Trong câu trả lời: kết luận ngắn → dữ kiện còn thiếu → nguồn có thể mở → trạng thái phí riêng. Một dấu xanh không đại diện cho cả 4 việc đó.
