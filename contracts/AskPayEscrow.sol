// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * @title AskPayEscrow
 * @notice Quản lý tiền cọc câu hỏi pháp luật XNK (x402 / Per-Answer Escrow trên Avalanche Fuji C-Chain)
 *         - Hỗ trợ thanh toán chuẩn USDC ERC-20 (6 decimals: 0.05 USDC = 50_000, 0.20 USDC = 200_000)
 *           và giữ tương thích AVAX testnet cho kiểm thử nhanh
 *         - "No Citation, No Pay — Wrong Citation, Auto-Refund"
 *         - Giải ngân tự động theo tín hiệu từ AI Validator Oracle
 *         - Hoàn tiền tự động nếu trích dẫn sai (<90%) hoặc quá hạn (Timeout)
 */
contract AskPayEscrow {
    enum Tier {
        QUICK, // Gói tra cứu nhanh (0.05 USDC = 50_000 base units / 0.005 AVAX demo)
        DEEP   // Gói phân tích chuyên sâu XNK (0.20 USDC = 200_000 base units / 0.020 AVAX demo)
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
        uint16 validatorScore; // Điểm kiểm định (ví dụ 9840 = 98.40%)
        bool isUsdc;           // true nếu khóa cọc bằng ERC-20 USDC, false nếu native AVAX
    }

    address public owner;
    address public aiOracle;   // Địa chỉ ví Server Backend được phép gọi resolveQuestion
    address public treasury;   // Ví nhận doanh thu khi câu trả lời PASS
    address public usdcToken;  // Địa chỉ ERC-20 USDC trên Avalanche Fuji / C-Chain

    uint256 public quickPrice = 0.005 ether;  // Fallback AVAX testnet demo
    uint256 public deepPrice  = 0.020 ether;  // Fallback AVAX testnet demo
    uint256 public quickPriceUsdc = 50_000;   // 0.05 USDC (6 decimals)
    uint256 public deepPriceUsdc  = 200_000;  // 0.20 USDC (6 decimals)
    uint256 public timeoutDuration = 5 minutes; // Quá 5 phút chưa trả lời thì cho phép rút lại cọc

    uint256 private _unlocked = 1;

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
        bool isUsdc,
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

    modifier nonReentrant() {
        require(_unlocked == 1, "ReentrancyGuard: reentrant call");
        _unlocked = 2;
        _;
        _unlocked = 1;
    }

    constructor(address _aiOracle, address _treasury, address _usdcToken) {
        owner = msg.sender;
        aiOracle = _aiOracle;
        treasury = _treasury;
        usdcToken = _usdcToken;
    }

    function askQuestion(
        bytes32 questionId,
        Tier tier,
        bytes32 questionHash
    ) external payable nonReentrant {
        require(escrows[questionId].status == Status.NONE, "Question ID already exists");

        uint256 requiredAmount = (tier == Tier.QUICK) ? quickPrice : deepPrice;
        require(msg.value == requiredAmount, "Exact escrow deposit required for selected tier");

        escrows[questionId] = QuestionEscrow({
            asker: msg.sender,
            amount: msg.value,
            tier: tier,
            status: Status.PENDING,
            createdAt: block.timestamp,
            questionHash: questionHash,
            l1ReceiptHash: bytes32(0),
            validatorScore: 0,
            isUsdc: false
        });

        totalQuestions += 1;

        emit QuestionAsked(
            questionId,
            msg.sender,
            tier,
            msg.value,
            questionHash,
            false,
            block.timestamp
        );
    }

    function askQuestionUsdc(
        bytes32 questionId,
        Tier tier,
        bytes32 questionHash,
        uint256 amount
    ) external nonReentrant {
        require(usdcToken != address(0), "USDC token not configured");
        require(escrows[questionId].status == Status.NONE, "Question ID already exists");

        uint256 requiredAmount = (tier == Tier.QUICK) ? quickPriceUsdc : deepPriceUsdc;
        require(amount == requiredAmount, "Exact USDC amount required for selected tier");

        bool transferred = IERC20(usdcToken).transferFrom(msg.sender, address(this), amount);
        require(transferred, "USDC transferFrom failed");

        escrows[questionId] = QuestionEscrow({
            asker: msg.sender,
            amount: amount,
            tier: tier,
            status: Status.PENDING,
            createdAt: block.timestamp,
            questionHash: questionHash,
            l1ReceiptHash: bytes32(0),
            validatorScore: 0,
            isUsdc: true
        });

        totalQuestions += 1;

        emit QuestionAsked(
            questionId,
            msg.sender,
            tier,
            amount,
            questionHash,
            true,
            block.timestamp
        );
    }

    function resolveQuestion(
        bytes32 questionId,
        bool passed,
        uint16 validatorScore,
        bytes32 l1ReceiptHash
    ) external onlyOracle nonReentrant {
        QuestionEscrow storage q = escrows[questionId];
        require(q.status == Status.PENDING, "Question is not pending");

        q.validatorScore = validatorScore;
        q.l1ReceiptHash = l1ReceiptHash;
        uint256 payout = q.amount;
        address recipient = passed ? treasury : q.asker;

        if (passed) {
            q.status = Status.RELEASED;
            totalVerifiedPassed += 1;
        } else {
            q.status = Status.REFUNDED_INVALID;
            totalAutoRefunded += 1;
        }

        _payoutEscrow(q.isUsdc, recipient, payout);

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

    function claimTimeoutRefund(bytes32 questionId) external nonReentrant {
        QuestionEscrow storage q = escrows[questionId];
        require(q.status == Status.PENDING, "Question is not pending");
        require(block.timestamp >= q.createdAt + timeoutDuration, "Timeout not reached yet");

        q.status = Status.REFUNDED_TIMEOUT;
        totalAutoRefunded += 1;
        uint256 refundAmount = q.amount;

        _payoutEscrow(q.isUsdc, q.asker, refundAmount);

        emit TimeoutRefundClaimed(questionId, q.asker, refundAmount);
    }

    function _payoutEscrow(bool isUsdc, address recipient, uint256 amount) internal {
        if (isUsdc) {
            bool ok = IERC20(usdcToken).transfer(recipient, amount);
            require(ok, "USDC transfer failed");
        } else {
            (bool ok, ) = payable(recipient).call{value: amount}("");
            require(ok, "Native transfer failed");
        }
    }

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

    function setUsdcConfig(
        address _usdcToken,
        uint256 _quickPriceUsdc,
        uint256 _deepPriceUsdc
    ) external onlyOwner {
        usdcToken = _usdcToken;
        quickPriceUsdc = _quickPriceUsdc;
        deepPriceUsdc = _deepPriceUsdc;
    }
}
