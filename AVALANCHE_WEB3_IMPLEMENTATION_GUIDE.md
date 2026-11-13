# Hướng Dẫn Toàn Tập Triển Khai AskPay Lên Avalanche (Dành Cho Dev Backend Lần Đầu Làm Web3)

Tài liệu này giải thích **bản chất luồng hoạt động (End-to-End Flow)** dựa trên đúng giải đáp của Ban Tổ Chức (BTC), kèm theo **code mẫu đầy đủ từ Smart Contract (`AskPayEscrow.sol`), cấu hình Avalanche Builder Hub L1, Backend Oracle Signer cho đến Frontend Next.js tích hợp ví Core Wallet / MetaMask**.

---

## Phần 1: Giải Mã Câu Trả Lời Của BTC — Bạn Cần Hiểu Flow Như Thế Nào?

Vì bạn xuất thân làm Backend truyền thống, hãy hình dung Blockchain như **एक Database công khai mà mỗi lệnh `INSERT/UPDATE` (Transaction) phải được ký bằng Private Key**:

1. **Khi nào dùng Ví User (Core Wallet / MetaMask trên trình duyệt)?**
   - Khi hành động đó **lấy tiền từ túi của User** (User bấm nút "Đặt câu hỏi & Cọc 0.05 AVAX/USDC" vào hợp đồng `AskPayEscrow`).
   - Lúc này Frontend (Next.js) sẽ bật popup ví **Core Wallet** để User bấm `Confirm`.
2. **Khi nào chỉ cần 1 Ví Server (Backend Signer) ký tự động?**
   - Sau khi User đã cọc tiền xong, Backend của bạn gọi sang **REST API LegalQA** (của bạn cùng nhóm).
   - Khi có kết quả từ bộ Validator (`PASSED` hay `FAILED`), **User không cần bấm ví lần 2!**
   - Thay vào đó, **Backend của bạn giữ sẵn 1 Private Key (`ORACLE_PRIVATE_KEY`)** trong file `.env`. Backend tự động dùng ví này bắn 2 transactions:
     - **Tx 1 (Gửi lên Fuji C-Chain):** Gọi hàm `resolveQuestion(questionId, passed, receiptHash)` trong `AskPayEscrow.sol`. Nếu `passed == true` $\rightarrow$ Tiền tự chảy về ví doanh thu của nhóm bạn. Nếu `passed == false` $\rightarrow$ Smart Contract **tự động bắn trả tiền về ví của User ngay lập tức (Auto-Refund)**.
     - **Tx 2 (Gửi lên mạng Avalanche L1 riêng của nhóm tạo trên Builder Hub):** Gọi hàm `logReceipt(...)` trong `AskPayReceiptLog.sol` để ghi biên lai kiểm toán (Hash câu hỏi, câu trả lời, trích dẫn, điểm Validator).

### Tại sao lại có cả Fuji C-Chain VÀ Avalanche L1? (Điểm ăn tiền tuyệt đối khi Pitching!)

| Thành phần | Chạy ở mạng nào? | Ai ký giao dịch? | Tại sao thiết kế như vậy? |
| :--- | :--- | :--- | :--- |
| **`AskPayEscrow.sol`** (Giữ tiền cọc & Giải ngân/Hoàn tiền) | **Avalanche Fuji C-Chain** (`Chain ID: 43113`, RPC: `https://api.avax-test.network/ext/bc/C/rpc`) | **User** (lúc đặt cọc) & **Ví Server Oracle** (lúc giải ngân/refund) | C-Chain là nơi có sẵn tiền (AVAX, USDC) và ví User đã kết nối sẵn, không bắt User phải cầu nối (bridge) tiền sang mạng lạ. |
| **`AskPayReceiptLog.sol`** (Lưu biên lai kiểm toán độ ảo giác AI) | **Own Avalanche L1** (Tạo miễn phí trên **Builder Hub**) | **Chỉ Ví Server Oracle** tự ghi ngầm từ Backend | Ghi log mỗi câu hỏi/trả lời tốn rất nhiều dữ liệu. Chạy trên L1 riêng giúp phí gas rẻ gần như bằng 0, tốc độ 1 giây, không làm nghẽn hay tốn tiền gas trên C-Chain! |

```
[Doanh nghiệp XNK (Browser + Core Wallet)]
       │
       │ 1. Bấm hỏi + Ký cọc 0.05 trên Fuji C-Chain (askQuestion)
       ▼
[AskPayEscrow.sol trên Fuji C-Chain (43113)]  ◄─── Giữ tiền cọc (Escrow)
       │
       │ 2. Gửi txHash + nội dung câu hỏi lên Backend
       ▼
[Next.js / Node.js Backend] ──(3. Gọi REST API)──► [FastAPI LegalIR + LegalQA + Validator]
       │                                                       │
       │ ◄──── 4. Trả về JSON {answer, citations, passed} ─────┘
       │
       ├──► 5a. (Ví Server ký) Ghi biên lai Hash lên [AskPayReceiptLog.sol trên Own L1]
       │
       └──► 5b. (Ví Server ký) Gọi resolveQuestion() trên [AskPayEscrow.sol (Fuji C-Chain)]
                  ├── Nếu passed = true  ──► Giải ngân tiền cho AskPay Treasury
                  └── Nếu passed = false ──► Tự động HOÀN TIỀN 100% về ví User!
```

---

## Phần 2: Chuẩn Bị Ví, Lấy Testnet AVAX & Tạo Avalanche L1 Trên Builder Hub

### Bước 2.1. Cài ví và chuẩn bị 2 địa chỉ ví
1. Cài tiện ích mở rộng **Core Wallet** (hoặc MetaMask) trên Chrome.
2. Bật chế độ **Testnet Mode** trong Core Wallet (Settings $\rightarrow$ Advanced $\rightarrow$ Testnet Mode).
3. Tạo 2 Account trong ví:
   - **Account 1 (`Oracle / Deployer Wallet`):** Dùng để deploy Smart Contract và lấy `Private Key` bỏ vào `.env` của Backend làm **AI Oracle Signer**.
   - **Account 2 (`User Demo Wallet`):** Dùng để đóng vai Doanh nghiệp XNK đặt câu hỏi lúc demo.

### Bước 2.2. Xin Testnet AVAX (Miễn phí)
- **Cách 1 (Nhanh nhất theo BTC chỉ):** Vào [http://team1vn.xyz/faucet.html](http://team1vn.xyz/faucet.html), dán địa chỉ ví của cả Account 1 và Account 2 để nhận Fuji Testnet AVAX.
- **Cách 2 (Lấy nhiều hơn - 0.5 AVAX):** Đăng nhập vào [https://build.avax.network/](https://build.avax.network/) (Avalanche Builder Hub) $\rightarrow$ vào mục **Faucet** để lấy 0.5 AVAX.

### Bước 2.3. Tạo Mạng Avalanche L1 Riêng Trên Builder Hub (Chạy `ReceiptLog`)
Theo giải đáp của BTC, nếu gấp bạn có thể deploy cả 2 contract lên Fuji C-Chain (`43113`) để chạy trước, sau đó vào **Builder Hub** tạo 1 mạng L1 miễn phí trong 3 phút để ăn trọn điểm tiêu chí **"Own L1"**:
1. Truy cập **Avalanche Builder Hub**: [https://build.avax.network/console](https://build.avax.network/console) và đăng nhập.
2. Chọn **Create L1** (hoặc **Testnet L1 / Managed Testnet Node**).
3. Đặt tên L1: `AskPayAuditL1`, Chain ID tự chọn (ví dụ: `778899`), Token gas ký hiệu: `ASK`.
4. Ở bước cấp phát số dư ban đầu (**Genesis Allocation**), dán địa chỉ **Account 1 (`Oracle / Deployer Wallet`)** của bạn vào để ví Server có sẵn `1,000,000 ASK` làm phí gas ghi biên lai miễn phí trọn đời!
5. Sau khi tạo xong, copy đường dẫn **L1 RPC URL** và **L1 Chain ID** bỏ vào file `.env`:
   ```env
   FUJI_RPC_URL="https://api.avax-test.network/ext/bc/C/rpc"
   FUJI_CHAIN_ID=43113

   ASKPAY_L1_RPC_URL="https://..." # Copy từ Builder Hub (nếu chưa tạo kịp thì điền tạm FUJI_RPC_URL)
   ASKPAY_L1_CHAIN_ID=778899       # Hoặc 43113 nếu chạy chung Fuji
   ```

---

## Phần 3: Code Đầy Đủ Smart Contracts (`AskPayEscrow.sol` & `AskPayReceiptLog.sol`)

Dưới đây là toàn bộ mã nguồn Solidity hoàn chỉnh, không phụ thuộc thư viện ngoài phức tạp để bạn có thể compile & deploy bằng **Remix IDE** (nhanh nhất trên trình duyệt, không cần cài đặt nặng) hoặc **Hardhat / Foundry**.

### 3.1. Hợp đồng `AskPayEscrow.sol` (Deploy lên Fuji C-Chain - Chain ID `43113`)

Hợp đồng này đáp ứng đầy đủ 3 yêu cầu của bạn:
1. **Quản lý tiền cọc câu hỏi theo 2 Tiers (`Quick` & `Deep`)** bằng native AVAX hoặc ERC20 USDC. (Để demo mượt nhất không bắt giám khảo phải mint Fake USDC trước, hợp đồng hỗ trợ đặt cọc trực tiếp bằng Testnet AVAX quy đổi tương đương `0.005 AVAX` cho Quick và `0.02 AVAX` cho Deep!).
2. **Giải ngân tự động hoặc Hoàn tiền tự động** ngay khi nhận tín hiệu từ ví `aiOracle` (Backend của bạn).
3. **Hoàn tiền nếu quá hạn (`claimTimeoutRefund`):** Nếu sau `10 phút` (có thể chỉnh thành `2 phút` khi demo) mà AI Oracle bị treo không phản hồi, User tự gọi hàm này để rút lại 100% tiền cọc.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AskPayEscrow
 * @notice Quản lý tiền cọc câu hỏi pháp luật XNK (x402 / Per-Answer Escrow trên Avalanche Fuji C-Chain)
 *         - "No Citation, No Pay — Wrong Citation, Auto-Refund"
 *         - Giải ngân tự động theo tín hiệu từ AI Validator Oracle
 *         - Hoàn tiền tự động nếu trích dẫn sai (<90%) hoặc quá hạn (Timeout)
 */
contract AskPayEscrow {
    enum Tier {
        QUICK, // Gói tra cứu nhanh (0.05 USDC tương đương 0.005 AVAX trên Testnet)
        DEEP   // Gói phân tích chuyên sâu XNK (0.20 USDC tương đương 0.02 AVAX trên Testnet)
    }

    enum Status {
        NONE,
        PENDING,          // Đang giữ tiền cọc, chờ RAG + Validator kiểm tra
        RELEASED,         // Trích dẫn đạt chuẩn (>=90%), đã giải ngân về Treasury
        REFUNDED_INVALID, // Trích dẫn sai/bịa luật, đã tự động hoàn tiền 100% cho User
        REFUNDED_TIMEOUT  // Quá hạn AI không trả lời, đã hoàn tiền 100% cho User
    }

    struct QuestionEscrow {
        address asker;
        uint256 amount;
        Tier tier;
        Status status;
        uint256 createdAt;
        bytes32 questionHash;
        bytes32 l1ReceiptHash; // Hash tham chiếu sang biên lai trên AskPay Own L1
        uint16 validatorScore; // Điểm chính xác (ví dụ 9840 = 98.40%)
    }

    address public owner;
    address public aiOracle;   // Địa chỉ ví Server Backend được phép gọi resolveQuestion
    address public treasury;   // Ví nhận doanh thu khi câu trả lời PASS

    uint256 public quickPrice = 0.005 ether; // 0.005 AVAX (~0.05 USDC để demo nhanh bằng Faucet AVAX)
    uint256 public deepPrice  = 0.020 ether; // 0.020 AVAX (~0.20 USDC)
    uint256 public timeoutDuration = 5 minutes; // Quá 5 phút chưa trả lời thì cho phép rút lại cọc

    // Thống kê minh bạch On-chain cho Dashboard
    uint256 public totalQuestions;
    uint256 public totalVerifiedPassed;
    uint256 public totalAutoRefunded;

    mapping(bytes32 => QuestionEscrow) public escrows;

    event QuestionAsked(
        bytes32 indexed questionId,
        address indexed asker,
        Tier tier,
        uint256 amount,
        bytes32 questionHash,
        uint256 timestamp
    );

    event QuestionResolved(
        bytes32 indexed questionId,
        address indexed asker,
        bool passed,
        Status finalStatus,
        uint256 amountTransferred,
        uint16 validatorScore,
        bytes32 l1ReceiptHash
    );

    event TimeoutRefundClaimed(
        bytes32 indexed questionId,
        address indexed asker,
        uint256 amountRefunded
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == aiOracle || msg.sender == owner, "Only AI Oracle");
        _;
    }

    constructor(address _aiOracle, address _treasury) {
        owner = msg.sender;
        aiOracle = _aiOracle;
        treasury = _treasury;
    }

    /**
     * @notice Bước 1: Doanh nghiệp XNK đặt câu hỏi và khóa tiền cọc vào Escrow
     * @param questionId Mã định danh câu hỏi (bytes32) tạo từ Frontend
     * @param tier 0 = QUICK, 1 = DEEP
     * @param questionHash Mã băm keccak256 nội dung câu hỏi
     */
    function askQuestion(
        bytes32 questionId,
        Tier tier,
        bytes32 questionHash
    ) external payable {
        require(escrows[questionId].status == Status.NONE, "Question ID already exists");

        uint256 requiredAmount = (tier == Tier.QUICK) ? quickPrice : deepPrice;
        require(msg.value >= requiredAmount, "Insufficient escrow deposit for selected tier");

        escrows[questionId] = QuestionEscrow({
            asker: msg.sender,
            amount: msg.value,
            tier: tier,
            status: Status.PENDING,
            createdAt: block.timestamp,
            questionHash: questionHash,
            l1ReceiptHash: bytes32(0),
            validatorScore: 0
        });

        totalQuestions += 1;

        emit QuestionAsked(
            questionId,
            msg.sender,
            tier,
            msg.value,
            questionHash,
            block.timestamp
        );
    }

    /**
     * @notice Bước 2: AI Oracle (Ví Backend) gửi kết quả từ Deterministic Validator lên để giải ngân hoặc hoàn tiền
     * @param questionId Mã câu hỏi
     * @param passed true nếu tất cả trích dẫn hợp lệ & khớp >= 90%, false nếu bất kỳ trích dẫn nào sai
     * @param validatorScore Điểm nhân 100 (VD: 9540 = 95.40%)
     * @param l1ReceiptHash Hash của biên lai đã ghi trên mạng Avalanche L1
     */
    function resolveQuestion(
        bytes32 questionId,
        bool passed,
        uint16 validatorScore,
        bytes32 l1ReceiptHash
    ) external onlyOracle {
        QuestionEscrow storage q = escrows[questionId];
        require(q.status == Status.PENDING, "Question is not pending");

        q.validatorScore = validatorScore;
        q.l1ReceiptHash = l1ReceiptHash;
        uint256 payout = q.amount;

        if (passed) {
            q.status = Status.RELEASED;
            totalVerifiedPassed += 1;
            (bool ok, ) = payable(treasury).call{value: payout}("");
            require(ok, "Transfer to treasury failed");
        } else {
            q.status = Status.REFUNDED_INVALID;
            totalAutoRefunded += 1;
            (bool ok, ) = payable(q.asker).call{value: payout}("");
            require(ok, "Auto-refund to asker failed");
        }

        emit QuestionResolved(
            questionId,
            q.asker,
            passed,
            q.status,
            payout,
            validatorScore,
            l1ReceiptHash
        );
    }

    /**
     * @notice Bước 3 (Bảo vệ User): Nếu quá hạn (Timeout) mà AI Oracle bị lỗi chưa phản hồi,
     *         User (hoặc bất kỳ ai) có thể bấm để hoàn tiền cọc về ví User.
     */
    function claimTimeoutRefund(bytes32 questionId) external {
        QuestionEscrow storage q = escrows[questionId];
        require(q.status == Status.PENDING, "Question is not pending");
        require(block.timestamp >= q.createdAt + timeoutDuration, "Timeout not reached yet");

        q.status = Status.REFUNDED_TIMEOUT;
        totalAutoRefunded += 1;
        uint256 refundAmount = q.amount;

        (bool ok, ) = payable(q.asker).call{value: refundAmount}("");
        require(ok, "Timeout refund failed");

        emit TimeoutRefundClaimed(questionId, q.asker, refundAmount);
    }

    // Các hàm cấu hình dành cho Admin khi cần tinh chỉnh lúc Demo
    function setConfig(
        address _aiOracle,
        address _treasury,
        uint256 _quickPrice,
        uint256 _deepPrice,
        uint256 _timeoutDuration
    ) external onlyOwner {
        aiOracle = _aiOracle;
        treasury = _treasury;
        quickPrice = _quickPrice;
        deepPrice = _deepPrice;
        timeoutDuration = _timeoutDuration;
    }
}
```

---

### 3.2. Hợp đồng `AskPayReceiptLog.sol` (Deploy lên mạng Avalanche L1 tạo trên Builder Hub)

Hợp đồng này lưu bằng chứng kiểm toán bất biến (Audit Trail) cho từng câu hỏi để bất kỳ ai cũng kiểm tra được tỉ lệ ảo giác (Hallucination Rate) của AI.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AskPayReceiptLog
 * @notice Chạy trên mạng Own Avalanche L1 (phí gas cực rẻ) để lưu biên lai kiểm định từng câu trả lời
 */
contract AskPayReceiptLog {
    struct AuditReceipt {
        bytes32 questionId;
        address asker;
        bytes32 questionHash;
        bytes32 answerHash;
        bytes32 citationsHash;
        bool passed;
        uint16 validatorScore; // Ví dụ: 9480 = 94.80%
        string citedDocuments; // Ví dụ: "128/2020/ND-CP#Art9#Cl1"
        uint256 timestamp;
    }

    address public oracleWriter;
    uint256 public totalReceipts;
    uint256 public passedReceipts;

    mapping(bytes32 => AuditReceipt) public receipts;
    bytes32[] public receiptIds;

    event ReceiptRecorded(
        bytes32 indexed questionId,
        address indexed asker,
        bool passed,
        uint16 validatorScore,
        string citedDocuments,
        uint256 timestamp
    );

    constructor(address _oracleWriter) {
        oracleWriter = _oracleWriter;
    }

    function recordReceipt(
        bytes32 questionId,
        address asker,
        bytes32 questionHash,
        bytes32 answerHash,
        bytes32 citationsHash,
        bool passed,
        uint16 validatorScore,
        string calldata citedDocuments
    ) external returns (bytes32 receiptHash) {
        require(msg.sender == oracleWriter, "Only Oracle Writer");

        receipts[questionId] = AuditReceipt({
            questionId: questionId,
            asker: asker,
            questionHash: questionHash,
            answerHash: answerHash,
            citationsHash: citationsHash,
            passed: passed,
            validatorScore: validatorScore,
            citedDocuments: citedDocuments,
            timestamp: block.timestamp
        });

        receiptIds.push(questionId);
        totalReceipts += 1;
        if (passed) {
            passedReceipts += 1;
        }

        emit ReceiptRecorded(
            questionId,
            asker,
            passed,
            validatorScore,
            citedDocuments,
            block.timestamp
        );

        return keccak256(
            abi.encodePacked(questionId, questionHash, answerHash, citationsHash, passed, validatorScore)
        );
    }

    function getHallucinationStats() external view returns (
        uint256 total,
        uint256 verified,
        uint256 hallucinated
    ) {
        return (totalReceipts, passedReceipts, totalReceipts - passedReceipts);
    }
}
```

---

## Phần 4: Cách Deploy Nhanh Nhất (5 Phút Bằng Remix IDE + Core Wallet)

Nếu bạn chưa quen cài Foundry/Hardhat, cách nhanh và ít lỗi nhất cho người mới là dùng **Remix IDE**:

1. Mở [https://remix.ethereum.org](https://remix.ethereum.org).
2. Tạo 2 file `AskPayEscrow.sol` và `AskPayReceiptLog.sol`, dán code ở Phần 3 vào.
3. Qua tab **Solidity Compiler** (biểu tượng chữ S bên trái) $\rightarrow$ chọn Compiler `0.8.20` $\rightarrow$ bấm **Compile**.
4. **Deploy `AskPayEscrow.sol` lên Avalanche Fuji C-Chain:**
   - Mở ví **Core Wallet / MetaMask**, chọn mạng **Avalanche Fuji Testnet** (`Chain ID: 43113`).
   - Trong Remix, qua tab **Deploy & Run Transactions** $\rightarrow$ mục **ENVIRONMENT** chọn `Injected Provider - MetaMask / Core`.
   - Chọn contract `AskPayEscrow`.
   - Điền 2 tham số Constructor:
     - `_aiOracle`: Địa chỉ ví Server của bạn (Account 1).
     - `_treasury`: Địa chỉ ví nhận tiền của nhóm bạn (có thể điền chính Account 1 luôn).
   - Bấm **Deploy** $\rightarrow$ Ký xác nhận trên ví $\rightarrow$ Copy địa chỉ contract vừa tạo lưu vào `NEXT_PUBLIC_ESCROW_ADDRESS`.
5. **Deploy `AskPayReceiptLog.sol` lên Avalanche L1 (hoặc Fuji):**
   - Chuyển mạng trên ví sang mạng **AskPay L1** (hoặc giữ nguyên Fuji nếu bạn muốn test nhanh trên 1 mạng trước).
   - Chọn contract `AskPayReceiptLog`, điền `_oracleWriter` là địa chỉ Account 1 $\rightarrow$ bấm **Deploy** $\rightarrow$ Copy địa chỉ lưu vào `NEXT_PUBLIC_RECEIPT_LOG_ADDRESS`.

---

## Phần 5: Tích Hợp Backend Oracle & Giao Diện Web App (Next.js + Core Wallet + AI API)

Dưới đây là cấu trúc tích hợp trong **Next.js (App Router)** dùng thư viện `viem` (chuẩn nhẹ và hiện đại nhất hiện nay cho Web3).

### 5.1. Cài đặt thư viện
```bash
npx create-next-app@latest askpay-web --typescript --tailwind --app
cd askpay-web
npm install viem
```

### 5.2. File cấu hình `.env.local`
```env
# RPC của Fuji C-Chain (theo đúng hướng dẫn của BTC)
NEXT_PUBLIC_FUJI_RPC_URL="https://api.avax-test.network/ext/bc/C/rpc"
NEXT_PUBLIC_ESCROW_ADDRESS="0x..." # Địa chỉ AskPayEscrow vừa deploy

# RPC của mạng Avalanche L1 tạo trên Builder Hub
ASKPAY_L1_RPC_URL="https://..." # Nếu chưa tạo L1 riêng thì điền https://api.avax-test.network/ext/bc/C/rpc
ASKPAY_L1_CHAIN_ID="43113"
NEXT_PUBLIC_RECEIPT_LOG_ADDRESS="0x..." # Địa chỉ AskPayReceiptLog vừa deploy

# Private Key của Ví Server (Account 1) để tự động ký giải ngân / hoàn tiền & ghi L1
ORACLE_PRIVATE_KEY="0x..."

# Đường dẫn tới REST API LegalIR/LegalQA của bạn cùng nhóm
LEGAL_RAG_API_URL="http://localhost:8000/api/v1/legal/ask"
```

### 5.3. Backend Route Handler (`app/api/ask-and-settle/route.ts`)
Đây là trái tim kết nối giữa **AI REST API** của bạn cùng nhóm và **2 mạng Blockchain (Fuji C-Chain + Own L1)**:

```typescript
import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, keccak256, toBytes, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";

const ESCROW_ABI = [
  {
    name: "resolveQuestion",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "questionId", type: "bytes32" },
      { name: "passed", type: "bool" },
      { name: "validatorScore", type: "uint16" },
      { name: "l1ReceiptHash", type: "bytes32" }
    ],
    outputs: []
  }
] as const;

const RECEIPT_ABI = [
  {
    name: "recordReceipt",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "questionId", type: "bytes32" },
      { name: "asker", type: "address" },
      { name: "questionHash", type: "bytes32" },
      { name: "answerHash", type: "bytes32" },
      { name: "citationsHash", type: "bytes32" },
      { name: "passed", type: "bool" },
      { name: "validatorScore", type: "uint16" },
      { name: "citedDocuments", type: "string" }
    ],
    outputs: [{ name: "receiptHash", type: "bytes32" }]
  }
] as const;

export async function POST(req: Request) {
  try {
    const { questionId, question, tier, askerAddress, simulateHallucination } = await req.json();

    // 1. Gọi sang REST API của bạn phụ trách LegalIR / LegalQA
    const ragRes = await fetch(process.env.LEGAL_RAG_API_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question_id: questionId,
        question,
        tier,
        domain: "import_export_customs",
        simulate_hallucination: Boolean(simulateHallucination)
      })
    });

    const ragData = await ragRes.json();
    const passed: boolean = ragData.validation.passed;
    const scoreInt = Math.round((ragData.validation.overall_score || 0) * 100); // VD: 98.4% -> 9840

    // 2. Tính các mã băm (Hashes) để ghi lên Avalanche L1 ReceiptLog
    const questionHash = keccak256(toBytes(question));
    const answerHash = keccak256(toBytes(ragData.answer || ""));
    const citationsHash = keccak256(toBytes(JSON.stringify(ragData.citations || [])));
    const citedDocsSummary = (ragData.citations || [])
      .map((c: any) => `${c.document}#Art${c.article}#Cl${c.clause}`)
      .join(";");

    // 3. Khởi tạo Ví Server (AI Oracle Signer) từ ORACLE_PRIVATE_KEY
    const oracleAccount = privateKeyToAccount(process.env.ORACLE_PRIVATE_KEY as `0x${string}`);

    // Cấu hình mạng Own L1
    const askPayL1 = defineChain({
      id: Number(process.env.ASKPAY_L1_CHAIN_ID || 43113),
      name: "AskPay Audit L1",
      nativeCurrency: { name: "ASK", symbol: "ASK", decimals: 18 },
      rpcUrls: { default: { http: [process.env.ASKPAY_L1_RPC_URL!] } }
    });

    const l1Wallet = createWalletClient({
      account: oracleAccount,
      chain: askPayL1,
      transport: http(process.env.ASKPAY_L1_RPC_URL!)
    });

    // 4. Ghi biên lai kiểm định lên mạng Own L1 (AskPayReceiptLog.sol)
    const l1TxHash = await l1Wallet.writeContract({
      address: process.env.NEXT_PUBLIC_RECEIPT_LOG_ADDRESS as `0x${string}`,
      abi: RECEIPT_ABI,
      functionName: "recordReceipt",
      args: [
        questionId as `0x${string}`,
        askerAddress as `0x${string}`,
        questionHash,
        answerHash,
        citationsHash,
        passed,
        scoreInt,
        citedDocsSummary
      ]
    });

    // 5. Gọi hàm resolveQuestion() trên Fuji C-Chain (AskPayEscrow.sol) để Giải ngân hoặc Tự động Hoàn tiền!
    const fujiWallet = createWalletClient({
      account: oracleAccount,
      chain: avalancheFuji,
      transport: http(process.env.NEXT_PUBLIC_FUJI_RPC_URL!)
    });

    const settlementTxHash = await fujiWallet.writeContract({
      address: process.env.NEXT_PUBLIC_ESCROW_ADDRESS as `0x${string}`,
      abi: ESCROW_ABI,
      functionName: "resolveQuestion",
      args: [
        questionId as `0x${string}`,
        passed,
        scoreInt,
        l1TxHash // Lưu luôn mã giao dịch biên lai L1 vào Escrow trên C-Chain để đối chiếu chéo!
      ]
    });

    return NextResponse.json({
      ...ragData,
      onchain: {
        l1ReceiptTxHash: l1TxHash,
        fujiSettlementTxHash: settlementTxHash,
        settlementStatus: passed ? "RELEASED_TO_TREASURY" : "AUTO_REFUNDED_TO_USER"
      }
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

---

### 5.4. Giao Diện Frontend Kết Nối Ví Core Wallet / MetaMask (`app/page.tsx`)

Đoạn code dưới đây giúp User:
1. Bấm **Kết nối ví Core Wallet / MetaMask** và tự động chuyển sang mạng **Avalanche Fuji (`43113`)**.
2. Chọn gói câu hỏi (`Quick - 0.005 AVAX` hoặc `Deep - 0.02 AVAX`), nhập câu hỏi pháp luật Xuất Nhập Khẩu.
3. Ký giao dịch đặt cọc vào `AskPayEscrow.sol` trên Fuji C-Chain.
4. Tự động gọi API `/api/ask-and-settle` để nhận câu trả lời kèm bảng chấm điểm trích dẫn và link kiểm chứng giao dịch **Giải ngân / Hoàn tiền tự động** trên Snowtrace!

```tsx
"use client";

import React, { useState } from "react";
import { createWalletClient, custom, keccak256, parseEther, toBytes } from "viem";
import { avalancheFuji } from "viem/chains";

const ESCROW_ABI = [
  {
    name: "askQuestion",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "questionId", type: "bytes32" },
      { name: "tier", type: "uint8" },
      { name: "questionHash", type: "bytes32" }
    ],
    outputs: []
  }
] as const;

export default function AskPayPage() {
  const [account, setAccount] = useState<string>("");
  const [question, setQuestion] = useState<string>(
    "Doanh nghiệp nhập khẩu lô hàng máy móc từ Nhật Bản nhưng khai sai mã HS dẫn đến thiếu thuế phải nộp, bị phát hiện khi kiểm tra sau thông quan thì bị phạt bao nhiêu phần trăm?"
  );
  const [tier, setTier] = useState<"quick" | "deep">("quick");
  const [simulateHallucination, setSimulateHallucination] = useState<boolean>(false);
  const [loadingStep, setLoadingStep] = useState<string>("");
  const [result, setResult] = useState<any>(null);

  // 1. Kết nối ví Core Wallet / MetaMask & Chuyển sang mạng Avalanche Fuji (43113)
  async function connectWallet() {
    const eth = (window as any).avalanche || (window as any).ethereum;
    if (!eth) {
      alert("Vui lòng cài đặt ví Core Wallet hoặc MetaMask!");
      return;
    }
    const accounts = await eth.request({ method: "eth_requestAccounts" });
    setAccount(accounts[0]);

    // Tự động chuyển sang mạng Avalanche Fuji C-Chain (43113 = 0xa869)
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xa869" }]
      });
    } catch (switchError: any) {
      if (switchError.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0xa869",
              chainName: "Avalanche Fuji C-Chain",
              nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
              rpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc"],
              blockExplorerUrls: ["https://testnet.snowtrace.io"]
            }
          ]
        });
      }
    }
  }

  // 2. Luồng Đặt cọc On-chain -> Gọi RAG + Validator -> Giải ngân / Hoàn tiền tự động
  async function handleAskAndPay() {
    if (!account) return alert("Hãy kết nối ví Core Wallet trước!");
    setResult(null);

    try {
      const eth = (window as any).avalanche || (window as any).ethereum;
      const walletClient = createWalletClient({
        chain: avalancheFuji,
        transport: custom(eth)
      });

      // Tạo mã questionId duy nhất (bytes32)
      const questionId = keccak256(toBytes(`${account}-${Date.now()}-${question}`));
      const questionHash = keccak256(toBytes(question));
      const depositValue = tier === "quick" ? parseEther("0.005") : parseEther("0.02");

      setLoadingStep("1/3: Đang mở ví Core Wallet để ký đặt cọc vào AskPayEscrow (Fuji C-Chain)...");
      const escrowTxHash = await walletClient.writeContract({
        account: account as `0x${string}`,
        address: process.env.NEXT_PUBLIC_ESCROW_ADDRESS as `0x${string}`,
        abi: ESCROW_ABI,
        functionName: "askQuestion",
        args: [questionId, tier === "quick" ? 0 : 1, questionHash],
        value: depositValue
      });

      setLoadingStep("2/3: Đang truy xuất 30 văn bản Luật Hải quan/XNK & Kiểm định trích dẫn (>=90%)...");
      const res = await fetch("/api/ask-and-settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId,
          question,
          tier,
          askerAddress: account,
          escrowTxHash,
          simulateHallucination
        })
      });

      const data = await res.json();
      setResult({ ...data, escrowTxHash });
      setLoadingStep("");
    } catch (err: any) {
      alert("Lỗi: " + err.message);
      setLoadingStep("");
    }
  }

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      <header className="flex justify-between items-center border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold">AskPay XNK — AI Pháp Lý Hải Quan & Xuất Nhập Khẩu</h1>
          <p className="text-sm text-gray-500">
            No Citation, No Pay • Sai trích dẫn (&lt;90%) = Smart Contract hoàn tiền tự động 100%
          </p>
        </div>
        <button
          onClick={connectWallet}
          className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium"
        >
          {account ? `Ví: ${account.slice(0, 6)}...${account.slice(-4)}` : "Kết nối Core Wallet"}
        </button>
      </header>

      <section className="space-y-4 bg-gray-50 p-5 rounded-xl border">
        <div className="flex gap-4">
          <button
            onClick={() => setTier("quick")}
            className={`px-4 py-2 rounded-lg border ${
              tier === "quick" ? "bg-black text-white" : "bg-white"
            }`}
          >
            Quick Tier (0.05 USDC / 0.005 AVAX)
          </button>
          <button
            onClick={() => setTier("deep")}
            className={`px-4 py-2 rounded-lg border ${
              tier === "deep" ? "bg-black text-white" : "bg-white"
            }`}
          >
            Deep XNK Analysis (0.20 USDC / 0.02 AVAX)
          </button>
        </div>

        <textarea
          rows={4}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="w-full p-3 border rounded-lg"
          placeholder="Nhập câu hỏi về Mã HS, C/O, Thủ tục Hải quan, Xử phạt XNK..."
        />

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={simulateHallucination}
              onChange={(e) => setSimulateHallucination(e.target.checked)}
            />
            <span>Giả lập AI trích dẫn sai (&lt;90%) để Demo tính năng Auto-Refund trên sân khấu</span>
          </label>

          <button
            onClick={handleAskAndPay}
            disabled={!!loadingStep}
            className="px-6 py-2.5 bg-red-600 text-white font-semibold rounded-lg disabled:opacity-50"
          >
            {loadingStep || "Đặt Cọc & Hỏi Ngay"}
          </button>
        </div>
      </section>

      {result && (
        <section className="p-5 rounded-xl border space-y-4">
          <div className="flex items-center justify-between">
            <span
              className={`px-3 py-1 rounded-full text-sm font-bold ${
                result.validation?.passed
                  ? "bg-green-100 text-green-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {result.validation?.passed
                ? `ĐÃ XÁC THỰC TRÍCH DẪN (${result.validation.overall_score}%) — ĐÃ THU PHÍ`
                : `PHÁT HIỆN TRÍCH DẪN KHÔNG ĐẠT (${result.validation?.overall_score}%) — ĐÃ HOÀN TIỀN 100%`}
            </span>
          </div>

          <p className="text-gray-800 whitespace-pre-line">{result.answer}</p>

          <div className="text-xs text-gray-600 space-y-1 border-t pt-3">
            <div>
              Tx Đặt cọc (Fuji):{" "}
              <a
                href={`https://testnet.snowtrace.io/tx/${result.escrowTxHash}`}
                target="_blank"
                className="underline text-blue-600"
              >
                {result.escrowTxHash}
              </a>
            </div>
            <div>
              Tx Giải ngân / Hoàn tiền (Fuji):{" "}
              <a
                href={`https://testnet.snowtrace.io/tx/${result.onchain?.fujiSettlementTxHash}`}
                target="_blank"
                className="underline text-blue-600"
              >
                {result.onchain?.fujiSettlementTxHash}
              </a>
            </div>
            <div>Tx Biên lai kiểm toán (AskPay L1): {result.onchain?.l1ReceiptTxHash}</div>
          </div>
        </section>
      )}
    </main>
  );
}
```

---

## Phần 6: Trả Lời 3 Câu Hỏi Pitching Trước Giám Khảo (Chuẩn Ngách Xuất Nhập Khẩu)

Đề bài yêu cầu phần thuyết trình phải trả lời 3 câu hỏi cốt lõi:

1. **Why On-chain? (Tại sao phải đưa lên Blockchain?)**
   - Trong tư vấn pháp lý Hải quan & Xuất nhập khẩu, lời hứa "hoàn tiền nếu AI trả lời sai" của một công ty Web2 là vô nghĩa vì chính công ty đó giữ tiền và tự chấm điểm.
   - Với `AskPayEscrow` + `ReceiptLog`, tiền nằm trong hợp đồng thông minh độc lập và mọi biên lai kiểm định (`questionHash, citationsHash, validatorScore`) được ghi công khai lên chuỗi. Bất kỳ doanh nghiệp XNK nào cũng có thể tự chạy lại bộ Deterministic Validator để kiểm chứng tỉ lệ ảo giác thực tế của hệ thống.
2. **Why Avalanche? (Tại sao phải là Avalanche?)**
   - Một câu hỏi tra cứu tờ khai hải quan chỉ tốn `0.05 USDC` (~1.250 VNĐ). Nếu chạy trên Ethereum hay các mạng phí cao, tiền gas cho 2 giao dịch (đặt cọc + tự động hoàn tiền) đã đắt gấp 20 lần giá trị câu hỏi.
   - Kiến trúc **C-Chain + Own Avalanche L1** giải quyết triệt để: C-Chain xử lý thanh khoản USDC/AVAX tức thì (finality ~1 giây), còn mạng **Own L1** của AskPay đóng vai trò một **Sổ cái kiểm toán pháp lý chuyên biệt (Dedicated Legal Audit Ledger)** ghi hàng triệu biên lai kiểm tra trích dẫn với chi phí gas bằng 0.
3. **Where does the money or yield come from? (Dòng tiền đến từ đâu?)**
   - **Nguồn thu 1:** Phí Pay-per-Verified-Answer (`0.05 USDC` / `0.20 USDC`) từ các doanh nghiệp XNK, đại lý hải quan, công ty Logistics (thay vì phải thuê gói pháp chế cố định đắt đỏ).
   - **Nguồn thu 2 (Tier 2 Expert Escrow):** Phí hoa hồng nền tảng `10%–15%` trên các ca phức tạp (`5–20 USDC`) khi doanh nghiệp nâng cấp câu hỏi lên Chuyên gia Hải quan / Luật sư Thương mại quốc tế xác nhận.
   - **Nguồn thu 3 (B2B API / MCP Server):** Các phần mềm khai báo hải quan điện tử (như ECUS5/VNACCS) hoặc AI Agent khác gọi qua AskPay MCP Server và trả phí tự động qua giao thức **x402**.
