# Tài Liệu Tổng Quan Sản Phẩm — AskPay XNK (Dành Cho Business Analyst & Thiết Kế Slide)

> **Mục tiêu tài liệu:** Cung cấp góc nhìn toàn diện về mục đích sản phẩm, bài toán kinh doanh, công nghệ tích hợp, cách trích xuất/kiểm định dữ liệu và cơ chế định giá để bạn **BA** xây dựng **Value Proposition (Tuyên ngôn giá trị)** và **Slide Pitching** thuyết phục nhất trước ban giám khảo.

---

## 1. Tóm Tắt Sản Phẩm Trong 1 Câu
**AskPay XNK** là trợ lý AI tra cứu pháp luật **Hải quan & Xuất Nhập Khẩu Việt Nam** theo mô hình trả phí theo từng câu trả lời (**Pay-per-Answer / x402**), kết hợp **Smart Contract Escrow** trên Avalanche: **Mọi câu trả lời bắt buộc phải đi kèm trích dẫn đúng Điều/Khoản và khớp $\ge 90\%$ văn bản gốc theo bộ kiểm định quy tắc — nếu trích dẫn không đạt tiêu chí (hoặc hết hiệu lực), hệ thống hoàn phí câu trả lời cho người hỏi.**

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
| **Cam kết trách nhiệm** | Người dùng chịu chi phí ngay cả khi AI trích sai nguồn luật. | **Hoàn phí câu trả lời khi trích dẫn không đạt tiêu chí:** Trích dẫn lỗi ($<90\%$, sai số liệu/phủ định hoặc hết hiệu lực) $\rightarrow$ **Hoàn tiền cọc câu hỏi**. |
| **Kiểm soát ảo giác** | LLM phổ thông có thể tự tin bịa Điều/Khoản mà không kiểm tra. | **Kiểm tra lỗi trích dẫn xác định được bằng quy tắc:** Đối chiếu nguồn và phiên bản; chất lượng kết luận pháp lý vẫn được tách bạch và khuyến nghị đối chiếu nguồn. |
| **Cơ chế thu phí** | Thuê bao cố định theo tháng (tốn kém nếu hỏi ít) hoặc phí tư vấn luật sư đắt đỏ. | **Pay-per-Answer (`0.05 – 0.20 USDC`/câu qua x402):** Dùng câu nào trả tiền câu đó, tối ưu chi phí cho SME. |
| **Tính minh bạch** | Tự hứa hoàn tiền kiểu Web2, khách hàng không kiểm chứng được tỷ lệ lỗi. | Cọc giữ trong **Smart Contract Escrow** (kèm cơ chế **Timeout Refund** nếu Oracle chậm) + công khai **Biên lai & Tỷ lệ lỗi trích dẫn (Citation Failure Rate)** bằng hash đối chiếu độc lập. |
| **Trải nghiệm người dùng** | Nhiều công cụ Web3 rườm rà, khó tiếp cận với kế toán/nhân viên XNK. | Giao diện tối giản kiểu trợ lý AI, ngôn ngữ đời thường; chế độ mô phỏng không đặt cọc sẽ ghi rõ *"Không phát sinh thu phí"*. |

> **Lưu ý trung thực khi bảo vệ trước Giám khảo (Trust Model MVP):** Smart Contract không đọc trực tiếp văn bản pháp luật ngoài chuỗi nên MVP vẫn sử dụng dịch vụ Oracle xác nhận kết quả kiểm định; tính minh bạch đến từ việc **công khai quy tắc kiểm định, mã băm (Q/A/Citations/Validator/Corpus), phiên bản validator**, chống ghi đè trùng `questionId`, và cho phép bên thứ ba chạy lại kiểm định độc lập để phát hiện sai lệch nếu có.

---

## 4. Giải Thích Chính Xác Về 2 Gói Giá (`0.05 USDC` vs `0.20 USDC`) & Vai Trò Của Ngưỡng `90%`

*(Đây là điểm rất quan trọng giúp BA giải thích mạch lạc khi giám khảo hỏi: "Tại sao đã cần chính xác > 90% rồi thì người ta dùng gói 0.05 đô chứ cần gì gói 0.20 đô?")*

### 4.1. Ngưỡng $\ge 90\%$ KHÔNG PHẢI là "gói cao thì chính xác hơn gói thấp"
- Ngưỡng $\ge 90\%$ là **tiêu chuẩn kiểm định trích dẫn tối thiểu (Deterministic Citation Gate)** áp dụng **BẮT BUỘC và NHƯ NHAU cho cả 2 gói** (kèm kiểm tra giữ nguyên số liệu/tỉ lệ/thời hạn và từ phủ định).
- Dù khách hàng trả `0.05 USDC` hay `0.20 USDC`, nếu AI không trích xuất được đúng Điều, Khoản khớp nguồn theo quy định kiểm tra $\rightarrow$ **Đều không đủ điều kiện giải ngân (nếu có đặt cọc thật sẽ kích hoạt hoàn cọc).**

### 4.2. Sự khác biệt thực sự giữa `0.05 USDC` và `0.20 USDC` nằm ở ĐỘ PHỨC TẠP & PHẠM VI PHÂN TÍCH (Scope)

| Tiêu chí | Gói 1: **Hỏi Nhanh (`0.05 USDC`)** | Gói 2: **Phân tích Tình huống (`0.20 USDC`)** |
| :--- | :--- | :--- |
| **Bản chất** | Tra cứu đơn điểm (*Single-Clause Lookup*) | Đối chiếu đa nguồn, chỉ rõ điều kiện áp dụng & liệt kê dữ kiện còn thiếu |
| **Đối tượng câu hỏi** | Hỏi trực tiếp 1 quy định, mức phạt, thời hạn, thủ tục đơn lẻ. | Tình huống thực tế phức tạp có nhiều điều kiện đan xen. |
| **Ví dụ thực tế** | *"Thời hạn nộp tờ khai hàng nhập khẩu là bao nhiêu ngày?"* hoặc *"Khai sai mã HS kiểm tra sau thông quan bị phạt bao nhiêu %?"* | *"Lô máy móc cũ nhập từ Nhật có C/O nhưng sai mô tả hàng hóa trên Invoice thì xử lý khai bổ sung, thuế và chế tài ra sao?"* |
| **Cách AI xử lý** | Trả lời ngắn gọn kết luận + 1 trích dẫn trực tiếp nhất. | Truy xuất sâu (`top-8`), đính kèm nhiều căn cứ, nêu rõ **① Đối chiếu nguồn quy định, ② Điều kiện áp dụng & Ngoại lệ, ③ Dữ kiện hồ sơ cần xác nhận thêm**. |

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
  - Không dùng AI để tự chấm AI, mà dùng **thuật toán Python (`citation_text.py`) và JavaScript (`validator-core.mjs`) đồng bộ** (chuẩn hóa `Unicode NFC` + `partial_ratio` có chặn theo độ dài + kiểm tra lệch số liệu/phủ định) để chấm qua **4 chốt chặn bắt buộc**:
    1. **Tồn tại văn bản (`25%`):** Mã hiệu văn bản phải khớp chính xác trong Corpus.
    2. **Đúng Điều & Khoản (`25%`):** Cặp `(document, article, clause)` phải có thật.
    3. **Còn hiệu lực (`20%`):** Trường `status` phải là `ACTIVE` theo ngày tra cứu `as_of`.
    4. **Độ khớp nguyên văn (`30%`):** Đoạn `excerpt` (tối thiểu 10 từ) phải khớp $\ge 90.0\%$ và không sai lệch số liệu/từ phủ định so với `raw_text` gốc.
  - **Quy tắc Strict All-Pass + Settlement Eligibility Gate:** Tất cả trích dẫn phải đạt cả 4 chốt chặn và corpus phải có cờ `settlement_eligible: true` mới đủ điều kiện giải ngân.

### 5.2. Lớp Giao Diện Người Dùng & Cầu Nối Backend (`Next.js 14` + `Viem`)
- **Giao diện Web (`app/page.tsx`):** Thiết kế tối giản theo phong cách trợ lý AI hiện đại (tông xanh dương Hải quan + trắng), hỗ trợ kết nối **Core Wallet / MetaMask** trên mạng Avalanche Fuji và chế độ mô phỏng không thu phí.
- **Backend Settlement (`app/api/ask-and-settle/route.ts`):**
  - Nhận câu hỏi, hỗ trợ luồng **HTTP 402 (`x402`)** với đơn vị USDC (6 decimals: `50000` / `200000`) và cơ chế chống trùng `questionId` khi retry.
  - Băm (`Keccak256` / `SHA-256`) câu hỏi, câu trả lời, trích dẫn, kết quả validator (`validatorHash`), phiên bản corpus (`corpusHash`) để đối chiếu; chỉ đánh dấu `LIVE_AVALANCHE` khi giao dịch thật được xác nhận trên chain.

### 5.3. Lớp Thanh Toán & Kiểm Toán Phi Tập Trung (On-chain Avalanche)
Kiến trúc **Dual-Chain trên Avalanche (Fuji C-Chain + Own L1)**:

- **Avalanche Fuji C-Chain — Hợp đồng `AskPayEscrow.sol`:**
    - *Công việc:* Giữ tiền cọc (hỗ trợ ERC-20 USDC `50_000`/`200_000` đơn vị chuẩn 6 decimals và AVAX testnet demo) ở trạng thái `PENDING`, ràng buộc chặt `asker`, `tier` và `questionHash`. Nhận tín hiệu từ Oracle để giải ngân nếu đủ điều kiện, hoặc **hoàn cọc 100%** khi trích dẫn không đạt / quá hạn `claimTimeoutRefund`.
- **AskPay Own Avalanche L1 — Hợp đồng `AskPayReceiptLog.sol`:**
    - *Công việc:* Đóng vai trò **Sổ cái biên lai kiểm định (Audit Ledger)**, chống ghi đè trùng `questionId` và lưu đủ `questionHash`, `answerHash`, `citationsHash`, `validatorHash`, `corpusHash`, `validatorVersion` để bên thứ ba chạy lại kiểm tra và theo dõi **tỷ lệ lỗi trích dẫn thực tế (Citation Failure Rate)**.

---

## 6. Luồng Trải Nghiệm Người Dùng (End-to-End Flow Cho Slide Minh Họa)

1. **Bước 1 — Đặt câu hỏi & Khóa cọc Escrow:** Nhân viên XNK nhập tình huống, chọn gói (`0.05 USDC` / `0.20 USDC`) và ký giao dịch vào `AskPayEscrow.sol` trên Fuji C-Chain (nếu dùng chế độ khách không nối ví, hệ thống chạy mô phỏng và ghi rõ *"Không thu phí"*).
2. **Bước 2 — Truy xuất & Kiểm định (Off-chain):** Dịch vụ tra cứu tìm Điều/Khoản liên quan; `Deterministic Validator` kiểm tra 4 chốt chặn và xuất các mã băm đối chiếu.
3. **Bước 3 — Ghi biên lai kiểm toán (Own L1):** Nếu có giao dịch thật, Oracle ghi biên lai gồm hash Q/A/citations/validator/corpus lên `AskPayReceiptLog.sol`.
4. **Bước 4 — Tự động giải ngân hoặc Hoàn cọc (Fuji C-Chain):**
    - Nếu trích dẫn đạt tiêu chí và `settlement_eligible = true`: Hợp đồng giải ngân phí tư vấn.
    - Nếu trích dẫn không đạt tiêu chí hoặc không tìm thấy căn cứ: Hợp đồng **tự động hoàn trả 100% tiền cọc về ví người hỏi** (chỉ hiển thị thông báo hoàn phí khi giao dịch hoàn cọc thực tế đã xác nhận).

---

## 7. Trả Lời 3 Câu Hỏi Bắt Buộc Trong Pitching (Gợi Ý Cho BA)

1. **Why On-chain? (Tại sao phải dùng Blockchain?)**
    - Lời hứa *"hoàn tiền nếu trích dẫn sai"* của nền tảng Web2 truyền thống thiếu tính kiểm chứng vì bên bán vừa giữ tiền vừa tự chấm điểm. Đưa tiền cọc vào **Smart Contract Escrow** (có `Timeout Refund`) và lưu bộ hash (Q/A/Citations/Validator/Corpus) lên chuỗi giúp người dùng và bên thứ ba **tự chạy lại validator để phát hiện sai lệch** của Oracle nếu có.
2. **Why Avalanche? (Tại sao chọn Avalanche?)**
    - Giao dịch vi mô **`0.05 – 0.20 USDC`/câu** đòi hỏi chi phí settlement thấp và xác nhận nhanh (~1–2 giây trên C-Chain) để không làm chi phí gas vượt quá phí tra cứu. Việc tách biên lai sang **Own L1** giúp không làm nghẽn luồng thanh toán chính (vẫn tính toán đầy đủ chi phí vận hành validator L1 trong mô hình kinh tế).
3. **Where does the money / yield come from? (Dòng tiền đến từ đâu?)**
    - **Doanh thu trực tiếp (Pay-per-Answer):** Phí tra cứu `0.05 – 0.20 USDC` mỗi lượt từ doanh nghiệp XNK, kế toán, đại lý khai báo hải quan; lợi nhuận kỳ vọng phải trừ đi chi phí AI, chi phí chain cho cả lượt pass lẫn lượt hoàn phí và chi phí vận hành validator.
    - **Hoa hồng kết nối chuyên gia (Tier 3 Escalation - Roadmap):** Thu `10%–15%` phí nền tảng trên các ca phức tạp (`5–20 USDC`) chuyển sang luật sư/chuyên gia hải quan thật.
    - **Tích hợp B2B / API & MCP Server (Roadmap):** Cho phép các phần mềm khai báo hải quan điện tử hoặc AI Agent doanh nghiệp khác gọi API tra cứu pháp luật XNK và thanh toán tự động theo từng request qua chuẩn **x402**.
