/**
 * Escrow binding and settlement eligibility guard.
 * Enforces P0 invariants:
 * 1. Never release escrow funds unless validation.passed AND validation.settlement_eligible are both true.
 * 2. When an on-chain escrow exists, bind questionId, askerAddress, tier, and questionHash strictly.
 * 3. When no escrow deposit exists on-chain, never claim RELEASED or AUTO_REFUNDED.
 */

export function evaluateSettlementDecision({
  request,
  expectedQuestionHash,
  escrowRecord,
  validation
}) {
  if (!request || typeof request.questionId !== "string" || !request.questionId) {
    return {
      ok: false,
      httpStatus: 400,
      code: "INVALID_QUESTION_ID",
      error: "Mã questionId không hợp lệ."
    };
  }

  if (!["quick", "deep"].includes(request.tier)) {
    return {
      ok: false,
      httpStatus: 400,
      code: "INVALID_TIER",
      error: "Gói tra cứu (tier) không hợp lệ."
    };
  }

  const passed = Boolean(validation?.passed);
  const settlementEligible = Boolean(validation?.settlement_eligible);
  const canRelease = passed && settlementEligible;

  // No on-chain escrow record present (status === 0 / NONE)
  if (!escrowRecord || Number(escrowRecord.status) === 0) {
    return {
      ok: true,
      hasEscrow: false,
      action: "NO_ESCROW",
      canRelease: false,
      settlementStatus: "NO_ESCROW_DEPOSIT",
      blockReason: !passed
        ? "VALIDATION_FAILED"
        : !settlementEligible
        ? "SETTLEMENT_NOT_ELIGIBLE"
        : "NO_ESCROW_DEPOSIT"
    };
  }

  // On-chain escrow exists: verify status === 1 (PENDING)
  if (Number(escrowRecord.status) !== 1) {
    return {
      ok: false,
      httpStatus: 409,
      code: "ESCROW_NOT_PENDING",
      error: "Escrow cho questionId này không ở trạng thái PENDING để xử lý lại."
    };
  }

  const reqAsker = String(request.askerAddress || "").toLowerCase();
  const chainAsker = String(escrowRecord.asker || "").toLowerCase();
  if (!reqAsker || reqAsker !== chainAsker) {
    return {
      ok: false,
      httpStatus: 400,
      code: "ESCROW_ASKER_MISMATCH",
      error: "Địa chỉ ví người hỏi không khớp với ví đã đặt cọc trong Escrow."
    };
  }

  const expectedTierNum = request.tier === "deep" ? 1 : 0;
  if (Number(escrowRecord.tier) !== expectedTierNum) {
    return {
      ok: false,
      httpStatus: 400,
      code: "ESCROW_TIER_MISMATCH",
      error: "Gói câu hỏi (tier) trong request không khớp với giao dịch Escrow đã khóa."
    };
  }

  const chainQuestionHash = String(escrowRecord.questionHash || "").toLowerCase();
  const reqQuestionHash = String(expectedQuestionHash || "").toLowerCase();
  if (!reqQuestionHash || chainQuestionHash !== reqQuestionHash) {
    return {
      ok: false,
      httpStatus: 400,
      code: "ESCROW_QUESTION_HASH_MISMATCH",
      error: "Nội dung câu hỏi (questionHash) không khớp với cam kết đã khóa trong Escrow."
    };
  }

  if (canRelease) {
    return {
      ok: true,
      hasEscrow: true,
      action: "RELEASE",
      canRelease: true,
      settlementStatus: "RELEASED_TO_TREASURY",
      blockReason: null
    };
  }

  return {
    ok: true,
    hasEscrow: true,
    action: "REFUND",
    canRelease: false,
    settlementStatus: !passed ? "AUTO_REFUNDED_TO_USER" : "SETTLEMENT_BLOCKED_INELIGIBLE",
    blockReason: !passed ? "VALIDATION_FAILED" : "SETTLEMENT_NOT_ELIGIBLE"
  };
}
