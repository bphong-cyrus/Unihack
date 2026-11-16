// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20AskPay {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
}

/**
 * @title AnswerEscrow
 * @notice Holds Fuji USDC settled by x402 until deterministic citation validation completes.
 */
contract AnswerEscrow {
    enum Tier { QUICK, DEEP }
    enum Status { NONE, PENDING, RELEASED, REFUNDED_INVALID, REFUNDED_TIMEOUT }

    struct Question {
        address payer;
        uint256 amount;
        Tier tier;
        Status status;
        uint64 createdAt;
        bytes32 questionHash;
        bytes32 paymentTxHash;
        bytes32 answerHash;
        uint16 validatorScore;
    }

    address public owner;
    address public oracle;
    address public treasury;
    IERC20AskPay public immutable usdc;
    uint256 public quickPrice;
    uint256 public deepPrice;
    uint256 public timeoutDuration;
    uint256 public totalEscrowed;
    mapping(bytes32 => Question) public questions;
    mapping(bytes32 => bool) public usedPaymentTransactions;

    event QuestionLocked(
        bytes32 indexed queryId,
        address indexed payer,
        Tier tier,
        uint256 amount,
        bytes32 questionHash,
        bytes32 paymentTxHash
    );
    event QuestionResolved(
        bytes32 indexed queryId,
        address indexed payer,
        bool released,
        Status status,
        uint256 amount,
        uint16 validatorScore,
        bytes32 answerHash
    );
    event TimeoutRefund(bytes32 indexed queryId, address indexed payer, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == oracle, "Only oracle");
        _;
    }

    constructor(
        address usdcAddress,
        address oracleAddress,
        address treasuryAddress,
        uint256 quickPriceUsdc,
        uint256 deepPriceUsdc,
        uint256 timeoutSeconds
    ) {
        require(usdcAddress != address(0), "USDC address is zero");
        require(oracleAddress != address(0), "Oracle address is zero");
        require(treasuryAddress != address(0), "Treasury address is zero");
        require(quickPriceUsdc > 0 && deepPriceUsdc > quickPriceUsdc, "Invalid tier prices");
        require(timeoutSeconds > 0, "Invalid timeout");
        owner = msg.sender;
        usdc = IERC20AskPay(usdcAddress);
        oracle = oracleAddress;
        treasury = treasuryAddress;
        quickPrice = quickPriceUsdc;
        deepPrice = deepPriceUsdc;
        timeoutDuration = timeoutSeconds;
    }

    function registerPayment(
        bytes32 queryId,
        address payer,
        Tier tier,
        bytes32 questionHash,
        bytes32 paymentTxHash
    ) external onlyOracle {
        require(queryId != bytes32(0), "Query ID is zero");
        require(payer != address(0), "Payer is zero");
        require(questionHash != bytes32(0), "Question hash is zero");
        require(paymentTxHash != bytes32(0), "Payment transaction is zero");
        require(questions[queryId].status == Status.NONE, "Query already registered");
        require(!usedPaymentTransactions[paymentTxHash], "Payment already registered");
        uint256 amount = tier == Tier.QUICK ? quickPrice : deepPrice;
        require(usdc.balanceOf(address(this)) >= totalEscrowed + amount, "USDC payment not received");

        questions[queryId] = Question({
            payer: payer,
            amount: amount,
            tier: tier,
            status: Status.PENDING,
            createdAt: uint64(block.timestamp),
            questionHash: questionHash,
            paymentTxHash: paymentTxHash,
            answerHash: bytes32(0),
            validatorScore: 0
        });
        totalEscrowed += amount;
        usedPaymentTransactions[paymentTxHash] = true;
        emit QuestionLocked(queryId, payer, tier, amount, questionHash, paymentTxHash);
    }

    function resolveQuestion(bytes32 queryId, bool passed, uint16 validatorScore, bytes32 answerHash)
        external
        onlyOracle
    {
        Question storage question = questions[queryId];
        require(question.status == Status.PENDING, "Question is not pending");
        require(validatorScore <= 10000, "Score exceeds 100 percent");
        question.validatorScore = validatorScore;
        question.answerHash = answerHash;
        question.status = passed ? Status.RELEASED : Status.REFUNDED_INVALID;
        totalEscrowed -= question.amount;
        address recipient = passed ? treasury : question.payer;
        _safeTransfer(recipient, question.amount);
        emit QuestionResolved(queryId, question.payer, passed, question.status, question.amount, validatorScore, answerHash);
    }

    function claimTimeoutRefund(bytes32 queryId) external {
        Question storage question = questions[queryId];
        require(question.status == Status.PENDING, "Question is not pending");
        require(msg.sender == question.payer, "Only payer");
        require(block.timestamp >= uint256(question.createdAt) + timeoutDuration, "Timeout not reached");
        question.status = Status.REFUNDED_TIMEOUT;
        totalEscrowed -= question.amount;
        _safeTransfer(question.payer, question.amount);
        emit TimeoutRefund(queryId, question.payer, question.amount);
    }

    function setConfig(address oracleAddress, address treasuryAddress, uint256 quick, uint256 deep, uint256 timeout)
        external
        onlyOwner
    {
        require(oracleAddress != address(0) && treasuryAddress != address(0), "Address is zero");
        require(quick > 0 && deep > quick && timeout > 0, "Invalid config");
        oracle = oracleAddress;
        treasury = treasuryAddress;
        quickPrice = quick;
        deepPrice = deep;
        timeoutDuration = timeout;
    }

    function _safeTransfer(address recipient, uint256 amount) private {
        (bool success, bytes memory result) = address(usdc).call(
            abi.encodeWithSelector(IERC20AskPay.transfer.selector, recipient, amount)
        );
        require(success && (result.length == 0 || abi.decode(result, (bool))), "USDC transfer failed");
    }
}
