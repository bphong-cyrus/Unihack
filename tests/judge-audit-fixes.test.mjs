import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { computeExcerptSimilarity } from "../app/api/ask-and-settle/validator-core.mjs";
import { evaluateSettlementDecision } from "../app/api/ask-and-settle/escrow-guard.mjs";
import {
  buildX402Challenge,
  checkIdempotentReplay,
  clearIdempotencyCacheForTesting,
  getIdempotentResult,
  setIdempotentResult,
  verifyX402PaymentHeader
} from "../app/api/ask-and-settle/x402-protocol.mjs";
import { runDeterministicFactcheck } from "../app/api/ask-and-settle/factcheck.mjs";

test("validator-core matches Python similarity and blocks numeric/negation mutations", () => {
  const cases = [
    [
      "Đối với hàng hóa nhập khẩu, nộp trước ngày hàng hóa đến cửa khẩu hoặc trong thời hạn 30 ngày kể từ ngày hàng hóa đến cửa khẩu.",
      "Đối với hàng hóa nhập khẩu, nộp trước ngày hàng hóa đến cửa khẩu hoặc trong thời hạn 30 ngày kể từ ngày hàng hóa đến cửa khẩu.",
      true
    ],
    [
      "Đối với hàng hóa nhập khẩu, nộp trước ngày hàng hóa đến cửa khẩu hoặc trong thời hạn 60 ngày kể từ ngày hàng hóa đến cửa khẩu.",
      "Đối với hàng hóa nhập khẩu, nộp trước ngày hàng hóa đến cửa khẩu hoặc trong thời hạn 30 ngày kể từ ngày hàng hóa đến cửa khẩu.",
      false
    ],
    [
      "Phạt 10% tính trên số tiền thuế khai thiếu hoặc số tiền thuế được miễn giảm hoàn không thu cao hơn quy định.",
      "Phạt 20% tính trên số tiền thuế khai thiếu hoặc số tiền thuế được miễn, giảm, hoàn, không thu cao hơn so với quy định của pháp luật về thuế đối với hành vi khai sai mã số hàng hóa",
      false
    ],
    [
      "Doanh nghiệp được phép khai bổ sung hồ sơ hải quan sau khi cơ quan hải quan thông báo kiểm tra thực tế hàng hóa.",
      "Người khai hải quan không được khai bổ sung hồ sơ hải quan sau khi cơ quan hải quan thông báo việc kiểm tra thực tế hàng hóa.",
      false
    ],
    [
      "Doanh nghiệp nhập khẩu khai sai mã HS lần đầu được miễn phạt hoàn toàn và thông quan ngay.",
      "Phạt 20% tính trên số tiền thuế khai thiếu đối với hành vi khai sai mã số hàng hóa xuất khẩu, nhập khẩu.",
      false
    ]
  ];

  const pythonBin = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const pairs = cases.map(([a, b]) => [a, b]);
  const pyScores = JSON.parse(
    execFileSync(
      pythonBin,
      [
        "-c",
        `import json,sys; sys.path.insert(0,'ai-service'); from citation_text import compute_excerpt_similarity; pairs=json.loads(sys.argv[1]); print(json.dumps([compute_excerpt_similarity(a,b) for a,b in pairs]))`,
        JSON.stringify(pairs)
      ],
      { encoding: "utf8" }
    )
  );

  for (let i = 0; i < cases.length; i++) {
    const [excerpt, source, shouldPass] = cases[i];
    const jsScore = computeExcerptSimilarity(excerpt, source);
    const pyScore = pyScores[i];
    assert.equal(jsScore >= 0.9, shouldPass, `JS threshold mismatch at case ${i}: ${jsScore}`);
    assert.equal(pyScore >= 0.9, shouldPass, `PY threshold mismatch at case ${i}: ${pyScore}`);
    assert(Math.abs(jsScore - pyScore) <= 0.02, `Parity gap at case ${i}: JS=${jsScore} PY=${pyScore}`);
  }
});

test("escrow-guard handles no-escrow, settlement_eligible gate, and field bindings", () => {
  const baseReq = {
    questionId: "0x" + "a".repeat(64),
    tier: "quick",
    askerAddress: "0x1111111111111111111111111111111111111111"
  };
  const qHash = "0x" + "b".repeat(64);
  const validPendingEscrow = {
    asker: baseReq.askerAddress,
    amount: 50000n,
    tier: 0,
    status: 1,
    questionHash: qHash
  };

  // 1. No escrow deposit -> never claim refund or release
  const noEscrow = evaluateSettlementDecision({
    request: baseReq,
    expectedQuestionHash: qHash,
    escrowRecord: null,
    validation: { passed: false, settlement_eligible: false }
  });
  assert.equal(noEscrow.ok, true);
  assert.equal(noEscrow.action, "NO_ESCROW");
  assert.equal(noEscrow.settlementStatus, "NO_ESCROW_DEPOSIT");
  assert.equal(noEscrow.canRelease, false);

  // 2. Passed citations but settlement_eligible=false -> must NOT release to treasury
  const blocked = evaluateSettlementDecision({
    request: baseReq,
    expectedQuestionHash: qHash,
    escrowRecord: validPendingEscrow,
    validation: { passed: true, settlement_eligible: false }
  });
  assert.equal(blocked.ok, true);
  assert.equal(blocked.canRelease, false);
  assert.equal(blocked.action, "REFUND");
  assert.equal(blocked.settlementStatus, "SETTLEMENT_BLOCKED_INELIGIBLE");

  // 3. Passed AND settlement_eligible=true + matching escrow -> release allowed
  const released = evaluateSettlementDecision({
    request: baseReq,
    expectedQuestionHash: qHash,
    escrowRecord: validPendingEscrow,
    validation: { passed: true, settlement_eligible: true }
  });
  assert.equal(released.ok, true);
  assert.equal(released.canRelease, true);
  assert.equal(released.action, "RELEASE");
  assert.equal(released.settlementStatus, "RELEASED_TO_TREASURY");

  // 4. Reject non-pending, mismatched asker, tier, and questionHash
  assert.equal(
    evaluateSettlementDecision({
      request: baseReq,
      expectedQuestionHash: qHash,
      escrowRecord: { ...validPendingEscrow, status: 2 },
      validation: { passed: true, settlement_eligible: true }
    }).code,
    "ESCROW_NOT_PENDING"
  );
  assert.equal(
    evaluateSettlementDecision({
      request: { ...baseReq, askerAddress: "0x2222222222222222222222222222222222222222" },
      expectedQuestionHash: qHash,
      escrowRecord: validPendingEscrow,
      validation: { passed: true, settlement_eligible: true }
    }).code,
    "ESCROW_ASKER_MISMATCH"
  );
  assert.equal(
    evaluateSettlementDecision({
      request: { ...baseReq, tier: "deep" },
      expectedQuestionHash: qHash,
      escrowRecord: validPendingEscrow,
      validation: { passed: true, settlement_eligible: true }
    }).code,
    "ESCROW_TIER_MISMATCH"
  );
  assert.equal(
    evaluateSettlementDecision({
      request: baseReq,
      expectedQuestionHash: "0x" + "c".repeat(64),
      escrowRecord: validPendingEscrow,
      validation: { passed: true, settlement_eligible: true }
    }).code,
    "ESCROW_QUESTION_HASH_MISMATCH"
  );
});

test("x402-protocol issues 6-decimal USDC challenges, verifies proofs, and enforces idempotency", () => {
  clearIdempotencyCacheForTesting();
  const qId = "0x" + "d".repeat(64);
  const qHash = "0x" + "e".repeat(64);

  const quickChallenge = buildX402Challenge({
    questionId: qId,
    questionHash: qHash,
    tier: "quick",
    escrowAddress: "0xb4fc756871c6e1694f13d7692c8f714c47142108"
  });
  const deepChallenge = buildX402Challenge({
    questionId: qId,
    questionHash: qHash,
    tier: "deep",
    escrowAddress: "0xb4fc756871c6e1694f13d7692c8f714c47142108"
  });

  assert.equal(quickChallenge.x402Version, 1);
  assert.equal(quickChallenge.accepts[0].maxAmountRequired, "50000");
  assert.equal(deepChallenge.accepts[0].maxAmountRequired, "200000");

  const validHeader = Buffer.from(
    JSON.stringify({
      network: "avalanche-fuji",
      scheme: "exact-escrow",
      payload: {
        questionId: qId,
        questionHash: qHash,
        amount: "50000",
        payer: "0x1111111111111111111111111111111111111111",
        txHash: "0x" + "f".repeat(64)
      }
    })
  ).toString("base64");

  const ok = verifyX402PaymentHeader({
    headerValue: validHeader,
    expectedQuestionId: qId,
    expectedQuestionHash: qHash,
    expectedTier: "quick"
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.amount, "50000");

  const wrongAmount = verifyX402PaymentHeader({
    headerValue: validHeader,
    expectedQuestionId: qId,
    expectedQuestionHash: qHash,
    expectedTier: "deep"
  });
  assert.equal(wrongAmount.ok, false);
  assert(wrongAmount.reason.startsWith("X402_AMOUNT_MISMATCH"));

  setIdempotentResult(qId, { question_id: qId, cached: true }, { questionHash: qHash, tier: "quick" });
  assert.deepEqual(getIdempotentResult(qId), { question_id: qId, cached: true });

  // Reject empty authorization object without txHash
  const emptyAuthHeader = Buffer.from(
    JSON.stringify({
      network: "avalanche-fuji",
      scheme: "exact-escrow",
      payload: {
        questionId: qId,
        questionHash: qHash,
        amount: "50000",
        authorization: {}
      }
    })
  ).toString("base64");
  const emptyAuthCheck = verifyX402PaymentHeader({
    headerValue: emptyAuthHeader,
    expectedQuestionId: qId,
    expectedQuestionHash: qHash,
    expectedTier: "quick"
  });
  assert.equal(emptyAuthCheck.ok, false);
  assert.equal(emptyAuthCheck.reason, "INVALID_OR_EMPTY_PAYMENT_PROOF");

  // Idempotency conflict when questionId is reused with different questionHash or tier
  assert.equal(
    checkIdempotentReplay({ questionId: qId, questionHash: "0x" + "1".repeat(64), tier: "quick" }).conflict,
    true
  );
  assert.equal(
    checkIdempotentReplay({ questionId: qId, questionHash: qHash, tier: "deep" }).conflict,
    true
  );
  assert.equal(
    checkIdempotentReplay({ questionId: qId, questionHash: qHash, tier: "quick" }).hit,
    true
  );

  clearIdempotencyCacheForTesting();
});

test("factcheck isolates verification target without substituting another article", () => {
  const miniCorpus = [
    {
      doc_id: "54/2014/QH13",
      doc_title: "Luật Hải quan năm 2014",
      article: "25",
      clause: "1",
      status: "ACTIVE",
      raw_text:
        "Đối với hàng hóa nhập khẩu, nộp trước ngày hàng hóa đến cửa khẩu hoặc trong thời hạn 30 ngày kể từ ngày hàng hóa đến cửa khẩu."
    }
  ];

  // 1. Điều 999 khoản 9 must NOT substitute Điều 25 khoản 1
  const missingArt = runDeterministicFactcheck({
    questionId: "0x1",
    rawInput: "Điều 999 khoản 9 Luật 54/2014/QH13 có tồn tại không, đừng thay điều khác?",
    corpusEntries: miniCorpus,
    corpusSha256: "abc"
  });
  assert.equal(missingArt.validation.passed, false);
  assert.equal(missingArt.citations[0].article, "999");
  assert.equal(missingArt.validation.citation_checks[0].fail_reason, "ARTICLE_OR_CLAUSE_NOT_FOUND");

  // 2. Excerpt mutated from 30 ngày -> 60 ngày must fail and pinpoint the numeric mismatch
  const mutatedExcerpt = runDeterministicFactcheck({
    questionId: "0x2",
    rawInput:
      "Kiểm chứng Điều 25 Khoản 1 Luật 54/2014/QH13: Đối với hàng hóa nhập khẩu, nộp trước ngày hàng hóa đến cửa khẩu hoặc trong thời hạn 60 ngày kể từ ngày hàng hóa đến cửa khẩu.",
    corpusEntries: miniCorpus,
    corpusSha256: "abc"
  });
  assert.equal(mutatedExcerpt.validation.passed, false);
  assert(mutatedExcerpt.validation.citation_checks[0].fail_reason.startsWith("EXCERPT_MISMATCH"));
  assert(mutatedExcerpt.validation.mismatch_detail.includes("60"));
});
