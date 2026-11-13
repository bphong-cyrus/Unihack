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
