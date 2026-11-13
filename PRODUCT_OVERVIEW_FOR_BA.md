# Tài Liệu Tổng Quan Sản Phẩm — AskPay XNK (Dành Cho Business Analyst & Thiết Kế Slide)

> **Mục tiêu tài liệu:** Cung cấp góc nhìn toàn diện về mục đích sản phẩm, bài toán kinh doanh, công nghệ tích hợp, cách trích xuất/kiểm định dữ liệu và cơ chế định giá để bạn **BA** xây dựng **Value Proposition (Tuyên ngôn giá trị)** và **Slide Pitching** thuyết phục nhất trước ban giám khảo.

---

## 1. Tóm Tắt Sản Phẩm Trong 1 Câu
**AskPay XNK** là trợ lý AI tra cứu pháp luật **Hải quan & Xuất Nhập Khẩu Việt Nam** theo mô hình trả phí theo từng câu trả lời (**Pay-per-Answer**), với cam kết bảo chứng bằng hợp đồng thông minh trên Avalanche: **Mọi câu trả lời bắt buộc phải có trích dẫn đúng Điều/Khoản còn hiệu lực và khớp $\ge 90\%$ văn bản gốc — nếu sai hoặc thiếu căn cứ, hệ thống tự động hoàn trả 100% tiền cho doanh nghiệp.**

---

## 2. Bài Toán Thực Tế & Đối Tượng Khách Hàng (Problem & Target Users)

### 2.1. Đối tượng mục tiêu (Target Persona)
1. **Nhân viên chứng từ / Khai báo hải quan (Customs Declarants)** tại các công ty xuất nhập khẩu, Forwarder, Logistics.
2. **Kế toán xuất nhập khẩu & Pháp chế doanh nghiệp** cần kiểm tra thuế suất, điều kiện hoàn thuế, chứng nhận xuất xứ (C/O).
3. **Chủ doanh nghiệp XNK vừa và nhỏ (SMEs)** không có đội ngũ luật sư riêng nhưng thường xuyên gặp rủi ro khi làm thủ tục thông quan.

### 2.2. Nỗi đau lớn nhất của khách hàng (Pain Points)
- **Áp lực tra cứu liên tục:** Quy định về Mã HS, thuế XK/NK, C/O ưu đãi (Form D, E, EUR.1, CPTPP), nhãn hàng hóa, kiểm tra sau thông quan thay đổi liên tục qua nhiều tầng văn bản (**Luật $\rightarrow$ Nghị định $\rightarrow$ Thông tư $\rightarrow$ Thông tư sửa đổi**).
- **Rủi ro "AI ảo giác" (AI Hallucination) khi dùng ChatGPT thông thường:** LLM phổ thông rất hay **bịa điều khoản** hoặc **trích dẫn văn bản đã hết hiệu lực** (ví dụ trích dẫn Nghị định `127/2013/NĐ-CP` đã bị thay thế bởi `128/2020/NĐ-CP`) với giọng điệu cực kỳ tự tin.
- **Bất đối xứng rủi ro (Risk Asymmetry):** Trong ngành XNK, một trích dẫn sai có thể khiến doanh nghiệp **kẹt container tại cảng (phí lưu kho/DEM/DET hàng chục triệu đồng)** hoặc **bị phạt 20% số thuế khai thiếu**, nhưng nhà cung cấp AI truyền thống vẫn thu đủ tiền thuê bao tháng và không chịu trách nhiệm gì.

---

## 3. Tuyên Ngôn Giá Trị (Value Proposition Cho BA Làm Slide)

| Khía cạnh | Giải pháp cũ (ChatGPT / Thuê bao / Tư vấn truyền thống) | Giải pháp **AskPay XNK** |
| :--- | :--- | :--- |
| **Cam kết trách nhiệm** | Người dùng chịu 100% rủi ro nếu AI bịa luật. | **Rủi ro bằng 0 cho người hỏi:** Trích dẫn sai ($<90\%$) hoặc hết hiệu lực $\rightarrow$ **Hoàn tiền tự động 100%**. |
| **Cơ chế thu phí** | Thuê bao cố định theo tháng (tốn kém nếu hỏi ít) hoặc phí tư vấn luật sư đắt đỏ. | **Pay-per-Answer (`0.05 – 0.20 USDC`/câu):** Dùng câu nào trả tiền câu đó, tối ưu chi phí cho SME. |
| **Tính minh bạch** | Lời hứa hoàn tiền kiểu Web2 tự chấm, khách hàng không kiểm chứng được. | Tiền giữ trong **Smart Contract độc lập** + lưu **Biên lai kiểm toán công khai** trên mạng Avalanche L1 riêng. |
| **Trải nghiệm người dùng** | Nhiều công cụ Web3 rườm rà, khó tiếp cận với kế toán/nhân viên XNK. | Giao diện tối giản kiểu trợ lý AI (ChatGPT/Perplexity), ngôn ngữ đời thường, chỉ cần 1 nút xác nhận thanh toán. |

---

## 4. Giải Thích Chính Xác Về 2 Gói Giá (`0.05 USDC` vs `0.20 USDC`) & Vai Trò Của Ngưỡng `90%`

*(Đây là điểm rất quan trọng giúp BA giải thích mạch lạc khi giám khảo hỏi: "Tại sao đã cần chính xác > 90% rồi thì người ta dùng gói 0.05 đô chứ cần gì gói 0.20 đô?")*

### 4.1. Ngưỡng $\ge 90\%$ KHÔNG PHẢI là "gói cao thì chính xác hơn gói thấp"
- Ngưỡng $\ge 90\%$ là **tiêu chuẩn kiểm định trích dẫn tối thiểu (Anti-Hallucination Gate)** áp dụng **BẮT BUỘC và NHƯ NHAU cho cả 2 gói**.
- Dù khách hàng trả `0.05 USDC` hay `0.20 USDC`, nếu AI không trích xuất được đúng Điều, Khoản đang còn hiệu lực và khớp nguyên văn ít nhất `90%` với văn bản gốc $\rightarrow$ **Đều bị đánh rớt và hoàn tiền 100%.**

### 4.2. Sự khác biệt thực sự giữa `0.05 USDC` và `0.20 USDC` nằm ở ĐỘ PHỨC TẠP & PHẠM VI PHÂN TÍCH (Scope)

| Tiêu chí | Gói 1: **Tra cứu nhanh (`0.05 USDC`)** | Gói 2: **Phân tích chuyên sâu (`0.20 USDC`)** |
| :--- | :--- | :--- |
| **Bản chất** | Tra cứu đơn điểm (*Single-Clause Lookup*) | Đối chiếu đa văn bản (*Multi-Document Cross-Analysis*) |
| **Đối tượng câu hỏi** | Hỏi trực tiếp 1 quy định, mức phạt, thời hạn, thủ tục đơn lẻ. | Tình huống thực tế phức tạp có nhiều điều kiện đan xen. |
| **Ví dụ thực tế** | *"Thời hạn nộp tờ khai hàng nhập khẩu là bao nhiêu ngày?"* hoặc *"Khai sai mã HS kiểm tra sau thông quan bị phạt bao nhiêu %?"* | *"Lô máy móc cũ nhập từ Nhật có C/O nhưng sai mô tả hàng hóa trên Invoice thì xử lý khai bổ sung, thuế và chế tài ra sao?"* |
| **Cách AI xử lý** | Truy xuất ít ngữ cảnh (`top-k` hẹp), trả lời ngắn gọn, bám sát 1–2 điều khoản trực tiếp. | Truy xuất sâu (`top-k` rộng), tổng hợp nhiều văn bản (Luật + Nghị định + Thông tư hướng dẫn + lưu ý quy trình cho bộ phận XNK). |

### 4.3. Ý tưởng mở rộng cho phần Roadmap trên Slide (Nếu BA muốn đề xuất thêm tính năng định giá theo độ chính xác)
- Trong phiên bản MVP hiện tại, hợp đồng `AskPayEscrow.sol` áp dụng **cơ chế giải ngân nhị phân** đúng yêu cầu đề bài: đạt 4 chốt chặn ($\ge 90\%$) $\rightarrow$ thu 100% phí của gói; trượt bất kỳ chốt chặn nào $\rightarrow$ hoàn 100% tiền cọc.
- Ở **Giai đoạn mở rộng (Roadmap)**, sản phẩm có thể bổ sung:
  - **Tier 3 — Chuyển tiếp Chuyên gia Hải quan / Luật sư (`5–20 USDC`):** Khi câu hỏi vượt ngoài kho văn bản hoặc bị AI hoàn tiền, người dùng bấm nâng cấp để chuyên gia thật trả lời trong 48h.
  - **Dynamic Rebate:** Thưởng hoàn một phần phí nếu độ tin cậy nằm ở vùng cận biên.

---

## 5. Phương Pháp Xây Dựng & Công Cụ Tích Hợp (Architecture & Tech Stack)

Sản phẩm được chia thành **3 lớp tách biệt (Off-chain AI + Web Bridge + On-chain Avalanche)** để vừa đảm bảo tốc độ AI, vừa đảm bảo tính bất biến tài chính:

### 5.1. Lớp Phân Tích & Trích Xuất Dữ Liệu Pháp Luật (Off-chain AI Service — `ai-service/`)
- **Kho dữ liệu (Legal Corpus):** Hướng tới 30+ văn bản cốt lõi ngành Hải quan & XNK (Luật Hải quan `54/2014/QH13`, Luật Thuế XK-NK `107/2016/QH13`, Nghị định `128/2020/NĐ-CP`, Nghị định `31/2018/NĐ-CP`, Thông tư `38/2015/TT-BTC`, `39/2018/TT-BTC`, v.v. — bao gồm cả văn bản đã hết hiệu lực như `127/2013/NĐ-CP` để kiểm thử bộ lọc hiệu lực).
- **Phương pháp bóc tách dữ liệu (Chunking Strategy):** Thay vì cắt văn bản theo số ký tự ngẫu nhiên, văn bản pháp luật được phân rã theo **cấu trúc pháp lý tự nhiên: Văn bản $\rightarrow$ Điều (`Article`) $\rightarrow$ Khoản (`Clause`)**, lưu kèm Metadata trạng thái hiệu lực (`ACTIVE` / `EXPIRED`) và nội dung gốc (`raw_text`).
- **Pipeline Truy xuất & Trả lời (`LegalIR` + `LegalQA`):**
  - Chạy trên **Python FastAPI**.
  - **LegalIR** tìm kiếm các Điều/Khoản liên quan nhất đến câu hỏi.
  - **LegalQA** sinh câu trả lời kèm cấu trúc trích dẫn bắt buộc dạng JSON: `{document, article, clause, excerpt}`.
- **Bộ Kiểm Định Thuật Toán Thuần (`Deterministic Citation Validator`):**
  - Không dùng AI để tự chấm AI, mà dùng **code Python/TypeScript thuần** kết hợp chuẩn hóa tiếng Việt (`Unicode NFC`) và thư viện **`RapidFuzz` (`partial_ratio`)** để chấm qua **4 chốt chặn bắt buộc**:
    1. **Tồn tại văn bản (`25%`):** Mã hiệu văn bản phải khớp chính xác trong Corpus.
    2. **Đúng Điều & Khoản (`25%`):** Cặp `(document, article, clause)` phải có thật.
    3. **Còn hiệu lực (`20%`):** Trường `status` phải là `ACTIVE` (loại bỏ văn bản đã bị thay thế/bãi bỏ).
    4. **Độ khớp nguyên văn (`30%`):** Đoạn `excerpt` (tối thiểu 8 từ) phải khớp $\ge 90.0\%$ so với `raw_text` trong nguồn gốc.
  - **Quy tắc Strict All-Pass:** Tất cả trích dẫn trong câu trả lời phải qua cả 4 chốt chặn. Trượt 1 chốt $\rightarrow$ `passed = false` $\rightarrow$ Hoàn tiền 100%.

### 5.2. Lớp Giao Diện Người Dùng & Cầu Nối Backend (`Next.js 14` + `Viem`)
- **Giao diện Web (`app/page.tsx`):** Thiết kế tối giản theo phong cách trợ lý AI hiện đại (tông xanh dương Hải quan + trắng), ẩn toàn bộ thuật ngữ Web3 phức tạp với người dùng cuối; hỗ trợ kết nối **Core Wallet / MetaMask** trên mạng Avalanche Fuji.
- **Backend Settlement (`app/api/ask-and-settle/route.ts`):**
  - Nhận câu hỏi, gọi sang REST API `LegalIR/LegalQA` (có sẵn cơ chế fallback nội bộ để demo mượt mà kể cả khi chưa nối server AI ngoài).
  - Băm (`Keccak256`) câu hỏi, câu trả lời, trích dẫn và dùng **Ví Server Oracle** tự động ký 2 giao dịch lên Blockchain mà không bắt người dùng thao tác ví lần thứ hai.

### 5.3. Lớp Thanh Toán & Kiểm Toán Phi Tập Trung (On-chain Avalanche)
Tại sao dùng **kiến trúc Dual-Chain trên Avalanche (Fuji C-Chain + Own L1)**?

- **Avalanche Fuji C-Chain (`Chain ID: 43113`) — Hợp đồng `AskPayEscrow.sol`:**
    - *Địa chỉ đã triển khai:* `0xb4fc756871c6e1694f13d7692c8f714c47142108`
    - *Công việc:* Giữ tiền cọc của người hỏi ở trạng thái `PENDING`. Nhận tín hiệu từ Oracle để tự động giải ngân cho hệ thống nếu `passed = true`, hoặc **hoàn tiền 100% về ví người dùng** nếu `passed = false`. Ngoài ra có hàm `claimTimeoutRefund` bảo vệ người dùng rút lại 100% tiền nếu hệ thống AI bị treo quá thời gian quy định.
- **AskPay Own Avalanche L1 (`Chain ID: 663010`) — Hợp đồng `AskPayReceiptLog.sol`:**
    - *Địa chỉ đã triển khai:* `0xb4fc756871c6e1694f13d7692c8f714c47142108`
    - *Công việc:* Khởi tạo qua **Avalanche Builder Hub**, đóng vai trò **Sổ cái kiểm toán pháp lý riêng (Audit Ledger)**. Lưu lại toàn bộ Hash của câu hỏi, câu trả lời, trích dẫn và điểm kiểm định với phí gas gần như bằng 0, giúp bất kỳ doanh nghiệp hay đối tác nào cũng kiểm tra được **tỉ lệ ảo giác thực tế** của hệ thống.

---

## 6. Luồng Trải Nghiệm Người Dùng (End-to-End Flow Cho Slide Minh Họa)

1. **Bước 1 — Đặt câu hỏi & Thanh toán đảm bảo:** Nhân viên XNK nhập tình huống (ví dụ: *"Khai sai mã HS khi kiểm tra sau thông quan bị xử lý thế nào?"*), chọn gói **Tra cứu nhanh (`0.05 USDC`)** hoặc **Phân tích chuyên sâu (`0.20 USDC`)** và xác nhận trên Core Wallet. Tiền được khóa an toàn trong `AskPayEscrow.sol` trên Fuji C-Chain.
2. **Bước 2 — Truy xuất & Kiểm định (Off-chain):** Hệ thống RAG tìm đúng Điều/Khoản trong kho luật XNK, sinh câu trả lời kèm trích dẫn. Bộ `Deterministic Validator` kiểm tra 4 chốt chặn và chấm độ khớp nguyên văn $\ge 90\%$.
3. **Bước 3 — Ghi biên lai kiểm toán (Own L1):** Backend ghi nhận mã băm bằng chứng kết quả kiểm định lên mạng **AskPay Own L1 (`663010`)**.
4. **Bước 4 — Tự động thanh toán hoặc Hoàn tiền (Fuji C-Chain):**
    - Nếu trích dẫn hợp lệ ($\ge 90\%$, còn hiệu lực): Hợp đồng giải ngân phí tư vấn, giao diện hiển thị câu trả lời kèm thẻ căn cứ pháp lý chuẩn xác.
    - Nếu trích dẫn sai hoặc không tìm thấy căn cứ: Hợp đồng **tự động hoàn trả 100% tiền cọc về ví người dùng ngay lập tức**.

---

## 7. Trả Lời 3 Câu Hỏi Bắt Buộc Trong Pitching (Gợi Ý Cho BA)

1. **Why On-chain? (Tại sao phải dùng Blockchain?)**
    - Lời hứa *"hoàn tiền nếu AI trả lời sai"* của các nền tảng Web2 truyền thống không đáng tin vì chính bên bán vừa giữ tiền vừa tự chấm điểm. Đưa tiền cọc vào **Smart Contract Escrow** và lưu biên lai kiểm định lên chuỗi đảm bảo bên bán không thể can thiệp vào kết quả hoàn tiền, đồng thời công khai minh bạch tỉ lệ ảo giác của AI.
2. **Why Avalanche? (Tại sao chọn Avalanche?)**
    - Với mức phí siêu nhỏ **`0.05 USDC`/câu (~1.250 VNĐ)**, các mạng phí gas cao sẽ làm chi phí giao dịch đắt hơn giá trị câu hỏi. Avalanche cho tốc độ xác nhận tức thì (~1 giây) để người dùng nhận câu trả lời mượt như Web2, đồng thời cho phép mở **Own L1 riêng (`Chain ID: 663010`)** để ghi hàng triệu biên lai kiểm toán gần như miễn phí mà không làm nghẽn C-Chain.
3. **Where does the money / yield come from? (Dòng tiền đến từ đâu?)**
    - **Doanh thu trực tiếp (Pay-per-Answer):** Phí tra cứu `0.05 – 0.20 USDC` mỗi lượt từ doanh nghiệp XNK, kế toán, đại lý khai báo hải quan.
    - **Hoa hồng kết nối chuyên gia (Tier 3 Escalation - Roadmap):** Thu `10%–15%` phí nền tảng trên các ca phức tạp (`5–20 USDC`) chuyển sang luật sư/chuyên gia hải quan thật.
    - **Tích hợp B2B / API & MCP Server (Roadmap):** Cho phép các phần mềm khai báo hải quan điện tử hoặc AI Agent doanh nghiệp khác gọi API tra cứu pháp luật XNK và thanh toán tự động theo từng request qua chuẩn **x402**.
