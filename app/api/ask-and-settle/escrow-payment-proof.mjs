import { decodeEventLog, parseAbi, parseAbiItem } from 'viem';

const questionAsked = parseAbiItem('event QuestionAsked(bytes32 indexed questionId, address indexed asker, uint8 tier, uint256 amount, bytes32 questionHash, bool isUsdc, uint256 timestamp)');
const escrowAbi = parseAbi([
  'function usdcToken() view returns (address)',
  'function escrows(bytes32) view returns (address asker,uint256 amount,uint8 tier,uint8 status,uint256 createdAt,bytes32 questionHash,bytes32 l1ReceiptHash,uint16 validatorScore,bool isUsdc)'
]);
const fujiUsdc = '0x5425890298aed601595a70ab815c96711a31bc65';
const equal = (left, right) => String(left || '').toLowerCase() === String(right || '').toLowerCase();
const bytes32 = value => /^0x[0-9a-fA-F]{64}$/.test(String(value || ''));
const address = value => /^0x[0-9a-fA-F]{40}$/.test(String(value || ''));

export async function verifyEscrowPayment(proof, expected, client) {
  const fail = reason => ({ ok: false, reason });
  const amount = expected.tier === 'quick' ? 50000n : expected.tier === 'deep' ? 200000n : null;
  if (!amount || !bytes32(proof?.txHash) || !bytes32(expected.questionId) || !bytes32(expected.questionHash) ||
      !address(expected.payer) || !address(expected.escrowAddress) || /^0x0{40}$/i.test(expected.escrowAddress) ||
      !equal(expected.usdcAddress, fujiUsdc) || !equal(proof.questionId, expected.questionId) ||
      !equal(proof.questionHash, expected.questionHash) || !equal(proof.payer, expected.payer) ||
      String(proof.amount) !== amount.toString()) return fail('PAYMENT_REQUIREMENTS_MISMATCH');
  try {
    if (await client.getChainId() !== 43113) return fail('WRONG_CHAIN');
    const receipt = await client.getTransactionReceipt({ hash: proof.txHash });
    if (receipt.status !== 'success' || !equal(receipt.from, expected.payer) || !equal(receipt.to, expected.escrowAddress) ||
        (receipt.transactionHash && !equal(receipt.transactionHash, proof.txHash))) return fail('INVALID_PAYMENT_RECEIPT');
    const matched = receipt.logs.some(log => {
      if (!equal(log.address, expected.escrowAddress)) return false;
      try {
        const { args } = decodeEventLog({ abi: [questionAsked], data: log.data, topics: log.topics });
        return equal(args.questionId, expected.questionId) && equal(args.asker, expected.payer) &&
          Number(args.tier) === (expected.tier === 'deep' ? 1 : 0) && args.amount === amount &&
          equal(args.questionHash, expected.questionHash) && args.isUsdc === true;
      } catch { return false; }
    });
    if (!matched) return fail('ESCROW_EVENT_NOT_FOUND');
    const token = await client.readContract({ address: expected.escrowAddress, abi: escrowAbi, functionName: 'usdcToken' });
    if (!equal(token, fujiUsdc)) return fail('WRONG_USDC_TOKEN');
    const state = await client.readContract({ address: expected.escrowAddress, abi: escrowAbi, functionName: 'escrows', args: [expected.questionId] });
    if (!equal(state[0], expected.payer) || state[1] !== amount || Number(state[2]) !== (expected.tier === 'deep' ? 1 : 0) ||
        Number(state[3]) !== 1 || !equal(state[5], expected.questionHash) || state[8] !== true) return fail('ESCROW_STATE_MISMATCH');
    return { ok: true, txHash: proof.txHash, payer: expected.payer, amount: amount.toString(), network: 'eip155:43113' };
  } catch {
    return fail('PAYMENT_VERIFICATION_UNAVAILABLE');
  }
}
