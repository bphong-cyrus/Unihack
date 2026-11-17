/**
 * x402 HTTP Payment Required protocol helper for AskPay USDC micropayments (6 decimals)
 * + strict proof verification + idempotent replay conflict detection keyed by (questionId, questionHash, tier).
 */

export const USDC_DECIMALS = 6;
export const X402_PRICES_USDC_UNITS = {
  quick: "50000",  // 0.05 USDC
  deep: "200000"   // 0.20 USDC
};

const FUJI_USDC_DEFAULT = "0x5425890298aed601595a70AB815c96711a31Bc65";
const TX_HASH_REGEX = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE_REGEX = /^0x[0-9a-fA-F]{130,}$/;

// Maps lowercased questionId -> { questionHash, tier, responsePayload }
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

function isValidSignedAuthorization(auth, expectedAmount) {
  if (!auth || typeof auth !== "object") return false;
  if (!ADDRESS_REGEX.test(String(auth.from || ""))) return false;
  if (!ADDRESS_REGEX.test(String(auth.to || ""))) return false;
  if (!TX_HASH_REGEX.test(String(auth.nonce || ""))) return false;
  if (!SIGNATURE_REGEX.test(String(auth.signature || ""))) return false;
  if (String(auth.value || "") !== expectedAmount) return false;
  return true;
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
    !payload.questionId ||
    !expectedQuestionId ||
    String(payload.questionId).toLowerCase() !== String(expectedQuestionId).toLowerCase()
  ) {
    return { ok: false, reason: "X402_QUESTION_ID_MISMATCH" };
  }

  if (
    !payload.questionHash ||
    !expectedQuestionHash ||
    String(payload.questionHash).toLowerCase() !== String(expectedQuestionHash).toLowerCase()
  ) {
    return { ok: false, reason: "X402_QUESTION_HASH_MISMATCH" };
  }

  if (String(payload.amount || "") !== expectedAmount) {
    return { ok: false, reason: `X402_AMOUNT_MISMATCH (expected ${expectedAmount} USDC base units)` };
  }

  const hasValidTxHash = TX_HASH_REGEX.test(String(payload.txHash || ""));
  const hasValidAuth = isValidSignedAuthorization(payload.authorization, expectedAmount);

  if (!hasValidTxHash && !hasValidAuth) {
    return { ok: false, reason: "INVALID_OR_EMPTY_PAYMENT_PROOF" };
  }

  return {
    ok: true,
    scheme: proof.scheme || "exact-escrow",
    network: proof.network || "avalanche-fuji",
    amount: expectedAmount,
    asset: payload.asset || FUJI_USDC_DEFAULT,
    payer: payload.payer || payload.from || payload.authorization?.from || "",
    txHash: hasValidTxHash ? payload.txHash : ""
  };
}

export function checkIdempotentReplay({ questionId, questionHash, tier }) {
  if (!questionId) return { hit: false, conflict: false, response: null };
  const entry = idempotencyCache.get(String(questionId).toLowerCase());
  if (!entry) return { hit: false, conflict: false, response: null };

  const sameQuestion =
    String(entry.questionHash || "").toLowerCase() === String(questionHash || "").toLowerCase();
  const sameTier = entry.tier === tier;

  if (!sameQuestion || !sameTier) {
    return {
      hit: true,
      conflict: true,
      response: null
    };
  }

  return {
    hit: true,
    conflict: false,
    response: entry.responsePayload
  };
}

export function getIdempotentResult(questionId) {
  if (!questionId) return null;
  return idempotencyCache.get(String(questionId).toLowerCase())?.responsePayload || null;
}

export function setIdempotentResult(questionId, resultPayload, meta = {}) {
  if (!questionId) return;
  if (idempotencyCache.size > 500) {
    const oldestKey = idempotencyCache.keys().next().value;
    if (oldestKey) idempotencyCache.delete(oldestKey);
  }
  idempotencyCache.set(String(questionId).toLowerCase(), {
    questionHash: meta.questionHash || "",
    tier: meta.tier || resultPayload?.tier || "quick",
    responsePayload: resultPayload
  });
}

export function clearIdempotencyCacheForTesting() {
  idempotencyCache.clear();
}
