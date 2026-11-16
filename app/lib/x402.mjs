import { sha256, toBytes } from 'viem';
const FUJI_USDC = '0x5425890298aed601595a70ab815c96711a31bc65';

export async function signFujiPayment(encodedChallenge, tier, questionId, question, payer, expectedEscrow, expectedResource, provider) {
  let challenge;
  try { challenge = JSON.parse(atob(encodedChallenge)); } catch { throw new Error('Yêu cầu thanh toán không hợp lệ.'); }
  const requirement = challenge?.accepts?.find(item => item.scheme === 'exact' && item.network === 'eip155:43113');
  const amount = tier === 'deep' ? '200000' : '50000';
  if (challenge?.x402Version !== 2 || !requirement || requirement.amount !== amount ||
      requirement.asset?.toLowerCase() !== FUJI_USDC.toLowerCase() || !/^0x[0-9a-fA-F]{40}$/.test(expectedEscrow || '') || /^0x0{40}$/i.test(expectedEscrow) ||
      requirement.payTo?.toLowerCase() !== expectedEscrow.toLowerCase() ||
      !/^0x[0-9a-fA-F]{40}$/.test(payer || '') ||
      requirement.extra?.askpayQuestionHash?.toLowerCase() !== sha256(toBytes(question.trim())).toLowerCase() ||
      challenge.resource?.url !== expectedResource ||
      requirement.extra?.askpayQueryId !== questionId || requirement.extra?.askpayTier !== tier ||
      requirement.extra?.assetTransferMethod !== 'eip3009' || requirement.extra?.name !== 'USD Coin' ||
      requirement.extra?.version !== '2' || requirement.extra?.paymentFlow !== 'upfront' ||
      !/^0x[0-9a-fA-F]{64}$/.test(requirement.extra?.askpayPaymentNonce || '') || !Number.isInteger(requirement.maxTimeoutSeconds) ||
      requirement.maxTimeoutSeconds < 1 || requirement.maxTimeoutSeconds > 300 || !challenge.resource?.url) {
    throw new Error('Thông tin thanh toán Fuji không khớp gói hoặc câu hỏi.');
  }
  const nonce = requirement.extra.askpayPaymentNonce;
  const authorization = {
    from: payer, to: requirement.payTo, value: amount, validAfter: '0',
    validBefore: String(Math.floor(Date.now() / 1000) + requirement.maxTimeoutSeconds), nonce
  };
  const typedData = {
    types: {
      EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
      TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }]
    },
    primaryType: 'TransferWithAuthorization',
    domain: { name: requirement.extra.name, version: requirement.extra.version, chainId: 43113, verifyingContract: requirement.asset },
    message: authorization
  };
  const signature = await provider.request({ method: 'eth_signTypedData_v4', params: [payer, JSON.stringify(typedData)] });
  return btoa(JSON.stringify({ x402Version: 2, resource: challenge.resource, accepted: requirement, payload: { signature, authorization } }));
}
