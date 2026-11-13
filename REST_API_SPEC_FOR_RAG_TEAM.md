# AskPay (XNK Edition) — Tài Liệu Mục Tiêu & Đặc Tả REST API cho Team LegalIR / LegalQA

> **Tóm tắt gửi bạn phụ trách AI/RAG:** Tụi mình làm dự án **AskPay** cho cuộc thi trên hệ sinh thái Avalanche. Thay vì làm luật chung chung cho sinh viên (giá trị giao dịch thấp, khó thuyết phục giám khảo về bài toán dòng tiền thực tế), tụi mình **ngách hóa vào đối tượng Doanh nghiệp Xuất Nhập Khẩu (XNK), Logistics & Đại lý Hải quan**.
> 
> Bạn đã có sẵn **LegalIR (Information Retrieval)** và **LegalQA (Question Answering)**, tài liệu này quy định rõ:
> 1. **Mục tiêu sản phẩm & Tập dữ liệu (Corpus) ngành Xuất Nhập Khẩu**.
> 2. **Công thức chia tỉ lệ chính xác (Citation Validation Rules)** để quyết định **Thu tiền (Release)** hay **Hoàn tiền tự động (Auto-Refund)**.
> 3. **Chuẩn REST API Contract (JSON Schema)** bạn cần bọc ngoài mô hình LegalIR/LegalQA để ghép với hệ thống thanh toán x402 & Smart Contract của mình.

---

## 1. Mục Tiêu Ứng Dụng: Tại Sao Chọn Doanh Nghiệp Xuất Nhập Khẩu (XNK)?

### 1.1. Nỗi đau thực tế (Problem)
- Doanh nghiệp XNK, nhân viên khai báo hải quan (Customs Declarants) và công ty Forwarder/Logistics phải tra cứu pháp luật liên tục mỗi ngày: **Mã HS Code, thuế suất ưu đãi đặc biệt (C/O Form D, E, EUR.1, CPTPP), chính sách mặt hàng quản lý chuyên ngành, kiểm dịch, thủ tục thông quan, xử phạt vi phạm hành chính hải quan**.
- Nếu dùng ChatGPT/LLM thông thường: AI rất hay **bịa điều khoản (hallucinate)** hoặc **trích dẫn văn bản đã hết hiệu lực** (ví dụ: trích dẫn Thông tư cũ đã bị thay thế bởi Thông tư 39/2018/TT-BTC).
- Trong ngành XNK, **sai một căn cứ pháp lý = kẹt hàng tại cảng (demurrage/detention), khai sai mã/thuế bị phạt 20% sắc thuế trốn hoặc phạt hành chính hàng chục triệu đồng**. Người hỏi gánh 100% rủi ro khi AI trả lời sai, trong khi bên bán AI vẫn thu tiền thuê bao tháng.

### 1.2. Giải pháp AskPay (Solution)
- **Mô hình "No Citation, No Pay — Wrong Citation, Auto-Refund":**
  - Trả tiền theo từng câu hỏi qua chuẩn **x402** và hợp đồng thông minh **AnswerEscrow** trên Avalanche.
  - **2 gói câu hỏi (Tiers):**
    - **Quick Tier (`0.05 USDC`):** Tra cứu nhanh điều khoản, thủ tục hải quan, mức phạt, thời hạn nộp hồ sơ.
    - **Deep Tier (`0.20 USDC`):** Phân tích tình huống XNK phức tạp cần kết hợp nhiều văn bản (Luật Hải quan + Nghị định xử phạt + Thông tư hướng dẫn).
    - **Expert Escalation (Bonus - `5–20 USDC`):** Chuyển tiếp hồ sơ cho Chuyên gia Hải quan / Luật sư Thương mại Quốc tế xác nhận trong 48h.
- **Cam kết minh bạch bằng Deterministic Validator:**
  - Mọi câu trả lời từ hệ thống LegalQA **bắt buộc** phải đi kèm danh sách trích dẫn chuẩn `{document_id, article, clause, excerpt}`.
  - Bộ kiểm tra độc lập (**Citation Validator** — chạy bằng code thuật toán thuần, không dùng LLM chấm LLM) đối chiếu trực tiếp với Corpus gốc.
  - **Đạt chuẩn 100% các tiêu chí bắt buộc:** Giải ngân tiền từ Escrow về ví hệ thống.
  - **Trượt bất kỳ tiêu chí bắt buộc nào:** Smart Contract tự động hoàn trả **100% tiền cọc** cho doanh nghiệp, đồng thời gắn nhãn câu trả lời là `UNVERIFIED`.

---

## 2. Phạm Vi Corpus (30 Văn Bản Pháp Luật Xuất Nhập Khẩu Cốt Lõi)

Để phục vụ MVP và dễ đạt độ chính xác cao khi chunking theo `Điều (Article)` và `Khoản (Clause)`, hệ thống LegalIR chỉ cần index **30 văn bản pháp luật trọng tâm ngành XNK & Hải quan** (lấy từ Cổng thông tin Pháp điển / VBPL Chính phủ):

1. **Luật gốc (5 văn bản):**
   - Luật Hải quan 2014 (`54/2014/QH13`)
   - Luật Quản lý ngoại thương 2017 (`05/2017/QH14`)
   - Luật Thuế xuất khẩu, thuế nhập khẩu 2016 (`107/2016/QH13`)
   - Luật Thương mại 2005 (`36/2005/QH11`)
   - Luật Quản lý thuế 2019 (`38/2019/QH14`)
2. **Nghị định hướng dẫn & Xử phạt Hải quan (10 văn bản):**
   - Nghị định `08/2015/NĐ-CP` và Nghị định `59/2018/NĐ-CP` (Thủ tục hải quan, kiểm tra, giám sát hải quan)
   - Nghị định `69/2018/NĐ-CP` (Hướng dẫn Luật Quản lý ngoại thương — hàng cấm xuất/nhập, giấy phép)
   - Nghị định `134/2016/NĐ-CP` và Nghị định `18/2021/NĐ-CP` (Hướng dẫn Luật Thuế XK, Thuế NK)
   - Nghị định `128/2020/NĐ-CP` và Nghị định `102/2021/NĐ-CP` (Xử phạt vi phạm hành chính trong lĩnh vực Hải quan)
   - Nghị định `31/2018/NĐ-CP` (Quy định chi tiết về Xuất xứ hàng hóa - C/O)
   - Nghị định `126/2020/NĐ-CP` (Hướng dẫn Luật Quản lý thuế)
   - Nghị định `43/2017/NĐ-CP` và Nghị định `111/2021/NĐ-CP` (Nhãn hàng hóa xuất nhập khẩu)
3. **Thông tư nghiệp vụ & C/O (15 văn bản):**
   - Thông tư `38/2015/TT-BTC` và Thông tư `39/2018/TT-BTC` (Thủ tục hải quan, kiểm tra giám sát hải quan, thuế XNK — **văn bản quan trọng nhất**)
   - Thông tư `14/2015/TT-BTC` và Thông tư `17/2021/TT-BTC` (Phân loại hàng hóa, phân tích kiểm định HS Code)
   - Thông tư `39/2015/TT-BTC` và Thông tư `60/2019/TT-BTC` (Trị giá hải quan hàng xuất nhập khẩu)
   - Thông tư `06/2021/TT-BTC` (Quản lý thuế đối với hàng hóa XNK)
   - Thông tư `05/2018/TT-BCT` (Kê khai xuất xứ hàng hóa)
   - Thông tư `38/2018/TT-BCT` (Chứng nhận và kiểm tra chứng nhận xuất xứ hàng hóa)
   - Các Thông tư quy tắc xuất xứ FTA phổ biến (ATIGA Form D, ACFTA Form E, EVFTA EUR.1, CPTPP) + 2 văn bản đã **Hết hiệu lực / Bị thay thế** (đưa chủ đích vào DB với trạng thái `status: "EXPIRED"` để demo tính năng bắt lỗi trích dẫn văn bản hết hiệu lực và hoàn tiền!).

### Quy chuẩn Chunking trong Database / Vector DB
Mỗi record trong Corpus phải lưu kèm bảng Metadata chuẩn (SQL/JSON) để Validator truy vấn đối chiếu chính xác tuyệt đối (`O(1)` lookup):

```json
{
  "doc_id": "38/2015/TT-BTC",
  "doc_title": "Thông tư quy định về thủ tục hải quan; kiểm tra, giám sát hải quan; thuế xuất khẩu, thuế nhập khẩu",
  "article": "18",
  "clause": "1",
  "point": "a",
  "status": "ACTIVE",
  "effective_date": "2015-04-01",
  "replaced_by": null,
  "raw_text": "Người khai hải quan phải khai đầy đủ các thông tin trên tờ khai hải quan theo các chỉ tiêu thông tin quy định tại mẫu số 01 hoặc mẫu số 02 Phụ lục II ban hành kèm theo Thông tư này..."
}
```

---

## 3. Chia Tỉ Lệ Chính Xác & Quy Tắc Chấm Điểm (Citation Validator Rules)

Để đảm bảo đúng yêu cầu đề bài (**"The citation validator is ordinary code: the document exists in the corpus, the article and clause are real, the excerpt matches at least 90% of the source text, and the document is still in force. If any citation fails, the whole amount is refunded"**), hệ thống chấm điểm chia thành **4 Chốt Chặn Bắt Buộc (Hard Gates)** cho từng Citation, và **Điểm Chất Lượng Tổng Thể (Confidence Score)**.

### 3.1. Bốn Chốt Chặn Bắt Buộc Trên Mỗi Citation (Tất cả phải PASS = 100%)

Với mỗi phần tử `citation` trong mảng `citations[]` mà LegalQA trả về, bộ Validator (viết bằng Python thuần, không dùng AI) sẽ kiểm tra tuần tự 4 điều kiện sau:

| Bước | Tiêu chí kiểm tra | Cách đo lường (Code thuần) | Ngưỡng đạt (Threshold) | Hậu quả nếu trượt |
| :--- | :--- | :--- | :--- | :--- |
| **Gate 1** | **Tồn tại văn bản (`Document Exists`)** | Chuẩn hóa `doc_id` (uppercase, xóa khoảng trắng thừa) và tìm khớp chính xác (`Exact Match`) trong danh mục 30 văn bản. | **100% Exact Match** (`doc_id in CORPUS`) | `FAIL` $\rightarrow$ **Refund 100%** |
| **Gate 2** | **Tồn tại Điều & Khoản (`Article & Clause Exist`)** | Kiểm tra cặp `(doc_id, article, clause)` có tồn tại thật trong cây cấu trúc văn bản đó hay không (nếu Điều không chia Khoản thì `clause = "0"` hoặc `"all"`). | **100% Exact Match** trong cấu trúc văn bản | `FAIL` $\rightarrow$ **Refund 100%** |
| **Gate 3** | **Tình trạng hiệu lực (`Still In Force`)** | Kiểm tra trường `status` của văn bản hoặc điều khoản đó tại thời điểm truy vấn (ví dụ điều khoản đã bị sửa đổi/bãi bỏ bởi Thông tư 39/2018/TT-BTC thì `status != "ACTIVE"`). | `status == "ACTIVE"` (**100%**) | `FAIL` $\rightarrow$ **Refund 100%** |
| **Gate 4** | **Độ khớp trích dẫn nguyên văn (`Excerpt Similarity`)** | So sánh chuỗi `excerpt` mà LLM trích ra với nội dung gốc `raw_text` của đúng `(doc_id, article, clause)` đó trong Corpus. | **$\ge 90.0\%$ (`0.90`)** | `FAIL` $\rightarrow$ **Refund 100%** |

### 3.2. Công Thức Tính Độ Khớp `Excerpt Similarity` ($\ge 90\%$)
Vì một Khoản (`raw_text`) trong luật Hải quan có thể dài 300 chữ, nhưng LLM chỉ trích dẫn câu cốt lõi dài 60 chữ (`excerpt`), nếu dùng Levenshtein toàn chuỗi sẽ bị thấp oan. Do đó, công thức chuẩn trong code Validator được quy định như sau:

1. **Tiền xử lý chuỗi (`normalize_vn_text`):**
   - Chuyển về chữ thường (`lowercase`), chuẩn hóa bảng mã Unicode tổ hợp/dựng sẵn (`unicodedata.normalize('NFC', text)`).
   - Loại bỏ dấu câu đặc biệt (`, . ; : " ' ( ) -`) và gộp nhiều khoảng trắng liên tiếp thành 1 khoảng trắng.
   - Yêu cầu độ dài tối thiểu: `excerpt` phải có **ít nhất 10 từ (words)** để chống lách luật bằng cách trích 1-2 chữ.
2. **Tính tỉ lệ khớp (`excerpt_match_score`):**
   - Dùng thuật toán **Partial Ratio / Substring Longest Common Subsequence** (`rapidfuzz.fuzz.partial_ratio(norm_excerpt, norm_raw_text) / 100.0`) kết hợp **Token Overlap Ratio** (số từ trong `excerpt` xuất hiện đúng thứ tự trong `raw_text` chia cho tổng số từ của `excerpt`):
   $$\text{Excerpt Score} = \max\left(\text{SubsequenceRatio}(\text{excerpt}, \text{raw\_text}), \text{PartialRatio}(\text{excerpt}, \text{raw\_text})\right)$$
   - **Điều kiện đạt Gate 4:** $\text{Excerpt Score} \ge 0.90$ (tức **tối thiểu 90%**).

### 3.3. Quy Tắc Tổng Hợp Cho Toàn Bộ Câu Trả Lời (Answer-Level Verdict)
- **Điều kiện 1 (Không khống trích dẫn):** Mảng `citations` phải có **ít nhất 1 phần tử** (`len(citations) >= 1`). Nếu `citations == []` $\rightarrow$ Miễn phí / Hoàn tiền ngay lập tức.
- **Điều kiện 2 (Strict All-Pass Rule của đề bài):**
  - Đề bài quy định: *"If any citation fails, the whole amount is refunded and the answer is labelled unverified."*
  - Nghĩa là nếu LLM trả về 2 citations, **cả 2 citations đều phải đạt cả 4 Gates (100% citations hợp lệ)**. Chỉ cần 1 citation bịa hoặc dưới 90% $\rightarrow$ Toàn bộ câu trả lời bị đánh trạng thái `REFUNDED` / `UNVERIFIED`.
  - **Mẹo tối ưu cho bạn làm LegalQA:** Hãy thiết kế Prompt / Reranker chỉ giữ lại **1 đến 3 citations chắc chắn nhất** (có điểm trích xuất cao nhất từ LegalIR), tuyệt đối không nhồi thêm các điều khoản mơ hồ vào mảng `citations[]`.

### 3.4. Trọng Số Điểm Tin Cậy Hiển Thị Lên UI & On-chain Receipt (`Validator Score`)
Ngoài kết quả nhị phân `PASSED` (thu tiền) / `FAILED` (hoàn tiền), API cần trả về một con số tổng hợp `overall_confidence` (thang `0–100%`) để hiển thị lên giao diện Web và lưu vào Receipt trên Avalanche L1:

$$\text{Overall Score} = 25\% \times S_{\text{doc}} + 25\% \times S_{\text{art\_clause}} + 20\% \times S_{\text{active}} + 30\% \times \overline{S_{\text{excerpt}}}$$

Trong đó:
- $S_{\text{doc}} \in \{0, 100\}$: Tỉ lệ văn bản tồn tại trong Corpus.
- $S_{\text{art\_clause}} \in \{0, 100\}$: Tỉ lệ Điều/Khoản tồn tại thật.
- $S_{\text{active}} \in \{0, 100\}$: Tỉ lệ văn bản còn hiệu lực pháp luật.
- $\overline{S_{\text{excerpt}}} \in [0, 100]$: Điểm khớp văn bản trung bình của các `excerpt`.
- **Ngưỡng giải ngân (Payout Condition):**
  $$\text{is\_verified} = (\text{len(citations)} \ge 1) \land (\forall c \in \text{citations}: \text{Gate}_1 \land \text{Gate}_2 \land \text{Gate}_3 \land \text{Score}_{\text{excerpt}}(c) \ge 0.90)$$

---

## 4. Đặc Tả REST API Cho Bạn Làm LegalIR / LegalQA

Bạn chỉ cần dựng một **FastAPI service** (ví dụ chạy ở port `8000`) với 3 endpoints dưới đây. Toàn bộ phần Blockchain (x402, ký ví Oracle, gọi Smart Contract hoàn tiền, ghi log lên Avalanche L1) phía mình sẽ đảm nhận hoặc gọi qua API của bạn.

### Endpoint 1: `POST /api/v1/legal/ask` (Core RAG + Citation Validator)

Nhận câu hỏi từ doanh nghiệp XNK, chạy **LegalIR $\rightarrow$ LegalQA $\rightarrow$ Deterministic Validator**, và trả về kết quả kèm chi tiết kiểm định.

#### Request Body (`application/json`)
```json
{
  "question_id": "0x8f3c...9a1b",
  "question": "Doanh nghiệp nhập khẩu lô hàng máy móc cũ từ Nhật Bản nhưng khai sai mã HS dẫn đến thiếu số tiền thuế phải nộp, bị cơ quan hải quan phát hiện khi kiểm tra sau thông quan thì bị phạt bao nhiêu phần trăm?",
  "tier": "quick",
  "domain": "import_export_customs"
}
```
- `tier`: `"quick"` (trả lời ngắn gọn, tập trung 1-2 căn cứ trực tiếp, top-k = 3) hoặc `"deep"` (phân tích sâu đa chiều, quy trình xử lý, top-k = 8).

#### Response Body (`200 OK` - `application/json`)
```json
{
  "question_id": "0x8f3c...9a1b",
  "tier": "quick",
  "answer": "Theo quy định tại Khoản 1 Điều 9 Nghị định 128/2020/NĐ-CP, trường hợp người khai hải quan khai sai mã số hàng hóa (mã HS) dẫn đến thiếu số tiền thuế phải nộp mà bị cơ quan hải quan phát hiện trong quá trình kiểm tra sau thông quan thì bị phạt 20% tính trên số tiền thuế khai thiếu (nếu không thuộc trường hợp tự nguyện khắc phục trước khi có quyết định kiểm tra).",
  "citations": [
    {
      "document": "128/2020/NĐ-CP",
      "document_title": "Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan",
      "article": "9",
      "clause": "1",
      "excerpt": "Phạt 20% tính trên số tiền thuế khai thiếu hoặc số tiền thuế được miễn, giảm, hoàn, không thu cao hơn so với quy định của pháp luật về thuế đối với một trong các hành vi vi phạm sau đây"
    }
  ],
  "validation": {
    "passed": true,
    "verdict": "VERIFIED_RELEASE",
    "overall_score": 98.4,
    "citation_checks": [
      {
        "document": "128/2020/NĐ-CP",
        "article": "9",
        "clause": "1",
        "doc_exists": true,
        "article_clause_exists": true,
        "is_in_force": true,
        "excerpt_similarity": 0.948,
        "threshold_required": 0.90,
        "status": "PASS",
        "fail_reason": null
      }
    ]
  },
  "hashes": {
    "question_hash": "0x1a2b...",
    "answer_hash": "0x3c4d...",
    "citations_hash": "0x5e6f...",
    "validator_hash": "0x7a8b..."
  },
  "latency_ms": 2150
}
```

#### Response Mẫu Khi Bị Hoàn Tiền Tự Động (Để Demo Trên Sân Khấu!)
Để giám khảo thấy rõ tính năng **Auto-Refund**, bạn hãy hỗ trợ một tham số debug hoặc một câu hỏi gài bẫy (ví dụ hỏi về một quy định cũ hoặc bật cờ `"simulate_hallucination": true` trong request) để API trả về:
```json
{
  "question_id": "0x9999...aaaa",
  "tier": "quick",
  "answer": "Theo Khoản 3 Điều 99 Thông tư 38/2015/TT-BTC, doanh nghiệp được miễn kiểm tra thực tế hàng hóa 100%...",
  "citations": [
    {
      "document": "38/2015/TT-BTC",
      "article": "99",
      "clause": "3",
      "excerpt": "Doanh nghiệp xuất nhập khẩu được miễn kiểm tra thực tế hàng hóa hoàn toàn tại cửa khẩu"
    }
  ],
  "validation": {
    "passed": false,
    "verdict": "UNVERIFIED_REFUND",
    "overall_score": 61.5,
    "citation_checks": [
      {
        "document": "38/2015/TT-BTC",
        "article": "99",
        "clause": "3",
        "doc_exists": true,
        "article_clause_exists": true,
        "is_in_force": true,
        "excerpt_similarity": 0.383,
        "threshold_required": 0.90,
        "status": "FAIL",
        "fail_reason": "EXCERPT_MISMATCH_BELOW_90_PERCENT"
      }
    ]
  }
}
```

---

### Endpoint 2: `POST /api/v1/legal/validate` (Standalone Deterministic Validator)
Cho phép người dùng hoặc bất kỳ bên thứ 3 nào gửi độc lập bộ `{citations}` lên để kiểm tra lại xem kết quả của Validator có đúng là deterministic hay không.

### Endpoint 3: `GET /api/v1/legal/corpus` (Tra cứu danh sách 30 văn bản XNK)
Trả về danh sách 30 văn bản pháp luật đang có trong Corpus kèm trạng thái `ACTIVE` / `EXPIRED`, tổng số Điều/Khoản đã chunking để hiển thị lên Dashboard của Web App.

---

## 5. Code Mẫu Bộ Validator Bằng Python Thuần (Gửi Bạn Copy Vào FastAPI)

Bạn có thể cài `pip install rapidfuzz` và dùng ngay hàm kiểm tra chuẩn này trong project LegalQA:

```python
import re
import unicodedata
from rapidfuzz import fuzz

def normalize_vn_text(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFC", text).lower()
    # Giữ lại chữ cái tiếng Việt, chữ số và khoảng trắng
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def compute_excerpt_similarity(excerpt: str, source_text: str) -> float:
    norm_excerpt = normalize_vn_text(excerpt)
    norm_source = normalize_vn_text(source_text)
    
    # Chống trích dẫn quá ngắn (dưới 8 từ)
    if len(norm_excerpt.split()) < 8 or not norm_source:
        return 0.0
    
    # Nếu chuỗi chuẩn hóa nằm nguyên vẹn trong văn bản gốc -> 1.0 (100%)
    if norm_excerpt in norm_source:
        return 1.0
        
    # Dùng partial_ratio của RapidFuzz (đo mức khớp chuỗi con tốt nhất, thang 0-100)
    score = fuzz.partial_ratio(norm_excerpt, norm_source) / 100.0
    return round(score, 4)

def validate_citations(citations: list[dict], corpus_index: dict) -> dict:
    """
    corpus_index: dict có key là (doc_id, article, clause) -> {
        "doc_exists": True,
        "status": "ACTIVE" | "EXPIRED",
        "raw_text": "..."
    }
    """
    if not citations:
        return {
            "passed": False,
            "verdict": "UNVERIFIED_REFUND",
            "overall_score": 0.0,
            "citation_checks": [],
            "fail_reason": "NO_CITATION_PROVIDED"
        }

    checks = []
    all_passed = True
    total_scores = []

    for c in citations:
        doc_id = c.get("document", "").strip().upper()
        article = str(c.get("article", "")).strip()
        clause = str(c.get("clause", "")).strip()
        excerpt = c.get("excerpt", "").strip()

        doc_exists = any(k[0] == doc_id for k in corpus_index.keys())
        record = corpus_index.get((doc_id, article, clause))
        art_clause_exists = record is not None
        is_in_force = bool(record and record.get("status") == "ACTIVE")
        
        similarity = (
            compute_excerpt_similarity(excerpt, record["raw_text"])
            if record else 0.0
        )

        # Kiểm tra 4 Hard Gates
        fail_reason = None
        if not doc_exists:
            fail_reason = "DOCUMENT_NOT_IN_CORPUS"
        elif not art_clause_exists:
            fail_reason = "ARTICLE_OR_CLAUSE_NOT_FOUND"
        elif not is_in_force:
            fail_reason = "DOCUMENT_EXPIRED_OR_REPLACED"
        elif similarity < 0.90:
            fail_reason = f"EXCERPT_SIMILARITY_TOO_LOW ({similarity*100:.1f}% < 90%)"

        passed_this = fail_reason is None
        if not passed_this:
            all_passed = False

        item_score = (
            (25.0 if doc_exists else 0.0)
            + (25.0 if art_clause_exists else 0.0)
            + (20.0 if is_in_force else 0.0)
            + (30.0 * similarity)
        )
        total_scores.append(item_score)

        checks.append({
            "document": doc_id,
            "article": article,
            "clause": clause,
            "doc_exists": doc_exists,
            "article_clause_exists": art_clause_exists,
            "is_in_force": is_in_force,
            "excerpt_similarity": similarity,
            "threshold_required": 0.90,
            "status": "PASS" if passed_this else "FAIL",
            "fail_reason": fail_reason
        })

    return {
        "passed": all_passed,
        "verdict": "VERIFIED_RELEASE" if all_passed else "UNVERIFIED_REFUND",
        "overall_score": round(sum(total_scores) / len(total_scores), 2),
        "citation_checks": checks
    }
```
