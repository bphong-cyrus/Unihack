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
