/**
 * x402 HTTP Payment Required protocol helper for AskPay USDC micropayments (6 decimals)
 * + idempotent replay cache keyed by questionId so retries never charge or settle twice.
 */

export const USDC_DECIMALS = 6;
export const X402_PRICES_USDC_UNITS = {
  quick: "50000",  // 0.05 USDC
  deep: "200000"   // 0.20 USDC
};

const FUJI_USDC_DEFAULT = "0x5425890298aed601595a70AB815c96711a31Bc65";

const idempotencyCache = new Map();

export function buildX402Challenge({
  questionId,
  questionHash,
  tier,
  escrowAddress,
  usdcAddress,
  resourceUrl = "/api/ask-and-settle"
}) {
  const safeTier = tier === "deep" ? "deep" : "quick";
  const maxAmountRequired = X402_PRICES_USDC_UNITS[safeTier];
  const asset = usdcAddress || FUJI_USDC_DEFAULT;
  const payTo = escrowAddress || "0x0000000000000000000000000000000000000000";

  return {
    x402Version: 1,
    error: "X-PAYMENT header or USDC escrow proof required for this query tier.",
    accepts: [
      {
        scheme: "exact-escrow",
        network: "avalanche-fuji",
        chainId: 43113,
        maxAmountRequired,
        humanAmount: safeTier === "deep" ? "0.20 USDC" : "0.05 USDC",
        resource: resourceUrl,
        description: `AskPay XNK (${safeTier}) gated by deterministic citation validation`,
        mimeType: "application/json",
        payTo,
        maxTimeoutSeconds: 300,
        asset,
        extra: {
          name: "USD Coin",
          decimals: USDC_DECIMALS,
          questionId,
          questionHash,
          tier: safeTier
        }
      }
    ]
  };
}

export function parseX402PaymentInput(headerValue, bodyProof) {
  if (bodyProof && typeof bodyProof === "object") {
    return bodyProof;
  }
  if (typeof headerValue === "string" && headerValue.trim()) {
    const raw = headerValue.trim();
    try {
      const decoded = raw.startsWith("{")
        ? raw
        : Buffer.from(raw, "base64").toString("utf8");
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

export function verifyX402PaymentHeader({
  headerValue,
  paymentProof,
  expectedQuestionId,
  expectedQuestionHash,
  expectedTier
}) {
  const proof = parseX402PaymentInput(headerValue, paymentProof);
  if (!proof) {
    return { ok: false, reason: "MISSING_OR_MALFORMED_X_PAYMENT" };
  }

  const safeTier = expectedTier === "deep" ? "deep" : "quick";
  const expectedAmount = X402_PRICES_USDC_UNITS[safeTier];

  if (proof.network && proof.network !== "avalanche-fuji") {
    return { ok: false, reason: "UNSUPPORTED_X402_NETWORK" };
  }

  const payload = proof.payload || proof;
  if (
    expectedQuestionId &&
    String(payload.questionId || "").toLowerCase() !== String(expectedQuestionId).toLowerCase()
  ) {
    return { ok: false, reason: "X402_QUESTION_ID_MISMATCH" };
  }

  if (
    expectedQuestionHash &&
    String(payload.questionHash || "").toLowerCase() !== String(expectedQuestionHash).toLowerCase()
  ) {
    return { ok: false, reason: "X402_QUESTION_HASH_MISMATCH" };
  }

  if (String(payload.amount || "") !== expectedAmount) {
    return { ok: false, reason: `X402_AMOUNT_MISMATCH (expected ${expectedAmount} USDC base units)` };
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(String(payload.txHash || "")) ||
      !/^0x[0-9a-fA-F]{40}$/.test(String(payload.payer || payload.from || ""))) {
    return { ok: false, reason: "MISSING_X402_SETTLEMENT_PROOF" };
  }

  return {
    ok: true,
    scheme: proof.scheme || "exact-escrow",
    network: proof.network || "avalanche-fuji",
    amount: expectedAmount,
    asset: payload.asset || FUJI_USDC_DEFAULT,
    payer: payload.payer || payload.from || "",
    txHash: payload.txHash || ""
  };
}

export function getIdempotentResult(questionId) {
  if (!questionId) return null;
  return idempotencyCache.get(String(questionId).toLowerCase()) || null;
}

export function setIdempotentResult(questionId, resultPayload) {
  if (!questionId) return;
  if (idempotencyCache.size > 500) {
    const oldestKey = idempotencyCache.keys().next().value;
    if (oldestKey) idempotencyCache.delete(oldestKey);
  }
  idempotencyCache.set(String(questionId).toLowerCase(), resultPayload);
}

export function clearIdempotencyCacheForTesting() {
  idempotencyCache.clear();
}
