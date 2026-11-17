import { keccak256, toBytes } from 'viem';

export const PAYMENT_SCHEME = 'askpay-escrow-v2';
export const PRICES = Object.freeze({ quick: '50000', deep: '200000' });
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

export function paymentContext(body, config) {
  if (!body || !PRICES[body.tier] || typeof body.question !== 'string' ||
      !body.question.trim() || body.question.length > 12000 || !HASH.test(body.questionId || '') ||
      !ADDRESS.test(body.askerAddress || '') || !ADDRESS.test(config.escrowAddress || '') ||
      !ADDRESS.test(config.usdcAddress || '') || !Number.isSafeInteger(config.chainId) || config.chainId <= 0) {
    throw new Error('INVALID_PAYMENT_REQUEST');
  }
  if ((body.mode && body.mode !== body.tier) || body.simulateHallucination || body.simulateExpiredLaw) {
    throw new Error('PAID_MODE_NOT_SUPPORTED');
  }
  const asOf = body.asOf || config.asOf;
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
      !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 10) !== asOf) {
    throw new Error('INVALID_AS_OF');
  }
  const corpusHash = String(config.corpusHash || '').replace(/^0x/, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(corpusHash)) throw new Error('PAYMENT_CORPUS_NOT_PINNED');
  if (body.corpusHash && String(body.corpusHash).replace(/^0x/, '').toLowerCase() !== corpusHash) {
    throw new Error('CORPUS_VERSION_CONFLICT');
  }
  return {
    version: 2, scheme: PAYMENT_SCHEME, chainId: config.chainId,
    escrow: config.escrowAddress.toLowerCase(), asset: config.usdcAddress.toLowerCase(),
    payer: body.askerAddress.toLowerCase(), questionId: body.questionId.toLowerCase(),
    question: body.question.trim(), tier: body.tier, mode: body.tier,
    asOf, corpusHash, amount: PRICES[body.tier]
  };
}

export function requestHash(context) {
  return keccak256(toBytes(JSON.stringify(context)));
}

export function paymentProofMessage(context, txHash) {
  if (!HASH.test(txHash || '')) throw new Error('INVALID_TX_HASH');
  return [
    'AskPay escrow proof v2',
    'Authorize processing this request only. This signature does not transfer tokens.',
    `Chain: ${context.chainId}`, `Escrow: ${context.escrow}`,
    `Asset: ${context.asset}`, `Amount (base units): ${context.amount}`,
    `Question ID: ${context.questionId}`, `Request hash: ${requestHash(context)}`,
    `Deposit transaction: ${txHash.toLowerCase()}`
  ].join('\n');
}
