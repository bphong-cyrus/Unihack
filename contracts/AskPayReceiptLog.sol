// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AskPayReceiptLog
 * @notice Chạy trên mạng Own Avalanche L1 để lưu biên lai kiểm định từng câu trả lời,
 *         chống ghi đè trùng questionId và lưu đủ validatorHash, corpusHash, validatorVersion.
 */
contract AskPayReceiptLog {
    struct AuditReceipt {
        bytes32 questionId;
        address asker;
        bytes32 questionHash;
        bytes32 answerHash;
        bytes32 citationsHash;
        bytes32 validatorHash;
        bytes32 corpusHash;
        bool passed;
        uint16 validatorScore; // Ví dụ: 9480 = 94.80%
        string citedDocuments; // Ví dụ: "128/2020/ND-CP#Art9#Cl1"
        string validatorVersion;
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
        bytes32 validatorHash,
        bytes32 corpusHash,
        string citedDocuments,
        string validatorVersion,
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
        bytes32 validatorHash,
        bytes32 corpusHash,
        bool passed,
        uint16 validatorScore,
        string calldata citedDocuments,
        string calldata validatorVersion
    ) external returns (bytes32 receiptHash) {
        bytes32[5] memory h = [
            questionHash,
            answerHash,
            citationsHash,
            validatorHash,
            corpusHash
        ];
        return _storeReceipt(
            questionId,
            asker,
            h,
            passed,
            validatorScore,
            citedDocuments,
            validatorVersion
        );
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
        bytes32[5] memory h = [
            questionHash,
            answerHash,
            citationsHash,
            bytes32(0),
            bytes32(0)
        ];
        return _storeReceipt(
            questionId,
            asker,
            h,
            passed,
            validatorScore,
            citedDocuments,
            "legacy-v1"
        );
    }

    function _storeReceipt(
        bytes32 questionId,
        address asker,
        bytes32[5] memory h,
        bool passed,
        uint16 validatorScore,
        string memory citedDocuments,
        string memory validatorVersion
    ) internal returns (bytes32 receiptHash) {
        require(msg.sender == oracleWriter, "Only Oracle Writer");
        require(receipts[questionId].timestamp == 0, "Receipt already exists for questionId");

        AuditReceipt storage r = receipts[questionId];
        r.questionId = questionId;
        r.asker = asker;
        r.questionHash = h[0];
        r.answerHash = h[1];
        r.citationsHash = h[2];
        r.validatorHash = h[3];
        r.corpusHash = h[4];
        r.passed = passed;
        r.validatorScore = validatorScore;
        r.citedDocuments = citedDocuments;
        r.validatorVersion = validatorVersion;
        r.timestamp = block.timestamp;

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
            h[3],
            h[4],
            citedDocuments,
            validatorVersion,
            block.timestamp
        );

        return keccak256(
            abi.encodePacked(
                questionId,
                h[0],
                h[1],
                h[2],
                h[3],
                h[4],
                passed,
                validatorScore,
                validatorVersion
            )
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
