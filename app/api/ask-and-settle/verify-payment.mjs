import { decodeFunctionData, parseAbi, parseEventLogs, recoverMessageAddress } from 'viem';
import { PAYMENT_SCHEME, paymentProofMessage, requestHash } from '../../lib/payment-request.mjs';

export const DEPOSIT_ABI = parseAbi([
  'function askQuestionUsdc(bytes32 questionId,uint8 tier,bytes32 questionHash,uint256 amount)',
  'function escrows(bytes32) view returns (address asker,uint256 amount,uint8 tier,uint8 status,uint256 createdAt,bytes32 questionHash,bytes32 l1ReceiptHash,uint16 validatorScore,bool isUsdc)',
  'function usdcToken() view returns (address)',
  'function timeoutDuration() view returns (uint256)',
  'event QuestionAsked(bytes32 indexed questionId,address indexed asker,uint8 tier,uint256 amount,bytes32 questionHash,bool isUsdc,uint256 timestamp)'
]);
export const TRANSFER_ABI = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const HASH = /^0x[0-9a-fA-F]{64}$/;
const eq = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

export class PaymentError extends Error {
  constructor(code, status = 402) { super(code); this.code = code; this.status = status; }
}
function ensure(ok, code, status) { if (!ok) throw new PaymentError(code, status); }

export function parsePaymentProof(header) {
  ensure(typeof header === 'string' && header.length > 0 && header.length <= 20000, 'INVALID_PAYMENT_PROOF');
  let proof;
  try {
    proof = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch { throw new PaymentError('INVALID_PAYMENT_PROOF'); }
  ensure(proof && !Array.isArray(proof) && proof.scheme === PAYMENT_SCHEME && proof.version === 2,
    'UNSUPPORTED_PAYMENT_SCHEME');
  ensure(HASH.test(proof.txHash || '') && /^0x[0-9a-fA-F]{130}$/.test(proof.signature || ''),
    'INVALID_PAYMENT_PROOF');
  return proof;
}

export async function verifyEscrowPayment({ client, context, proof, confirmations = 2 }) {
  ensure(Number.isSafeInteger(confirmations) && confirmations >= 1, 'INVALID_CONFIRMATION_POLICY', 503);
  ensure(proof?.scheme === PAYMENT_SCHEME && proof.version === 2 && HASH.test(proof.txHash || ''),
    'UNSUPPORTED_PAYMENT_SCHEME');
  ensure(proof.chainId === context.chainId && eq(proof.asset, context.asset) && eq(proof.escrow, context.escrow),
    'PAYMENT_DOMAIN_MISMATCH');
  ensure(eq(proof.requestHash, requestHash(context)), 'PAYMENT_REQUEST_MISMATCH');
  let signer;
  try { signer = await recoverMessageAddress({ message: paymentProofMessage(context, proof.txHash), signature: proof.signature }); }
  catch { throw new PaymentError('INVALID_PAYER_SIGNATURE'); }
  ensure(eq(signer, context.payer), 'PAYER_SIGNATURE_MISMATCH');

  try {
    ensure(await client.getChainId() === context.chainId, 'RPC_CHAIN_MISMATCH', 503);
    const [receipt, tx, head] = await Promise.all([
      client.getTransactionReceipt({ hash: proof.txHash }),
      client.getTransaction({ hash: proof.txHash }),
      client.getBlock({ blockTag: 'latest' })
    ]);
    ensure(receipt.status === 'success', 'DEPOSIT_REVERTED');
    ensure(eq(receipt.transactionHash, proof.txHash) && eq(tx.hash, proof.txHash), 'TX_HASH_MISMATCH');
    ensure(eq(tx.to, context.escrow) && eq(receipt.to, context.escrow), 'WRONG_ESCROW');
    ensure(eq(tx.from, context.payer) && eq(receipt.from, context.payer), 'WRONG_PAYER');
    ensure(tx.value === 0n, 'NATIVE_PAYMENT_NOT_ACCEPTED');
    ensure(receipt.blockNumber != null && head.number >= receipt.blockNumber &&
      head.number - receipt.blockNumber + 1n >= BigInt(confirmations), 'PAYMENT_NOT_FINAL', 425);
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    ensure(eq(block.hash, receipt.blockHash) && eq(tx.blockHash, receipt.blockHash), 'DEPOSIT_REORGED', 425);

    let decoded;
    try { decoded = decodeFunctionData({ abi: DEPOSIT_ABI, data: tx.input }); }
    catch { throw new PaymentError('INVALID_DEPOSIT_CALL'); }
    const tier = context.tier === 'deep' ? 1 : 0;
    const committedHash = requestHash(context);
    const amount = BigInt(context.amount);
    ensure(decoded.functionName === 'askQuestionUsdc' &&
      eq(decoded.args[0], context.questionId) && Number(decoded.args[1]) === tier &&
      eq(decoded.args[2], committedHash) && decoded.args[3] === amount, 'DEPOSIT_ARGUMENT_MISMATCH');

    const events = parseEventLogs({ abi: DEPOSIT_ABI, eventName: 'QuestionAsked', strict: true,
      logs: receipt.logs.filter(log => eq(log.address, context.escrow) && !log.removed) });
    ensure(events.length === 1, 'QUESTION_EVENT_MISSING_OR_AMBIGUOUS');
    const event = events[0].args;
    ensure(eq(event.questionId, context.questionId) && eq(event.asker, context.payer) &&
      Number(event.tier) === tier && event.amount === amount && event.isUsdc === true &&
      eq(event.questionHash, committedHash) && event.timestamp === block.timestamp, 'QUESTION_EVENT_MISMATCH');

    const transfers = parseEventLogs({ abi: TRANSFER_ABI, eventName: 'Transfer', strict: true,
      logs: receipt.logs.filter(log => eq(log.address, context.asset) && !log.removed) });
    ensure(transfers.filter(log => eq(log.args.from, context.payer) && eq(log.args.to, context.escrow) &&
      log.args.value === amount).length === 1, 'USDC_TRANSFER_NOT_FOUND');

    const read = (functionName, args, blockNumber) => client.readContract({
      address: context.escrow, abi: DEPOSIT_ABI, functionName, args, blockNumber
    });
    const [tokenAtDeposit, tokenNow, q, timeout] = await Promise.all([
      read('usdcToken', [], receipt.blockNumber), read('usdcToken', [], head.number),
      read('escrows', [context.questionId], head.number), read('timeoutDuration', [], head.number)
    ]);
    ensure(eq(tokenAtDeposit, context.asset) && eq(tokenNow, context.asset), 'ESCROW_TOKEN_CHANGED');
    ensure(eq(q[0], context.payer) && q[1] === amount && Number(q[2]) === tier &&
      eq(q[5], committedHash) && q[8] === true && q[4] === event.timestamp, 'ESCROW_STATE_MISMATCH');
    ensure(Number(q[3]) === 1, 'ESCROW_ALREADY_RESOLVED', 409);
    ensure(head.timestamp < q[4] + timeout, 'ESCROW_TIMEOUT_REACHED', 409);
    return {
      verified: true, scheme: PAYMENT_SCHEME, chainId: context.chainId,
      network: `eip155:${context.chainId}`, amount: context.amount,
      asset: context.asset, payer: context.payer, txHash: proof.txHash,
      requestHash: committedHash, blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber.toString(), confirmations: Number(head.number - receipt.blockNumber + 1n),
      escrowRecord: { asker: q[0], amount: q[1].toString(), tier: Number(q[2]), status: Number(q[3]),
        createdAt: q[4].toString(), questionHash: q[5], isUsdc: true }
    };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    if (['TransactionNotFoundError', 'TransactionReceiptNotFoundError'].includes(error?.name)) {
      throw new PaymentError('PAYMENT_NOT_FOUND');
    }
    throw new PaymentError('PAYMENT_RPC_UNAVAILABLE', 503);
  }
}
