import { decodeEventLog, parseAbiItem } from 'viem';
const token = '0x5425890298aed601595a70ab815c96711a31bc65';
const transfer = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const equal = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

export function hasFujiUsdcTransfer(receipt, payer, escrow, amount) {
  return receipt?.status === 'success' && Array.isArray(receipt.logs) && receipt.logs.some(log => {
    if (!equal(log.address, token)) return false;
    try {
      const { args } = decodeEventLog({ abi: [transfer], data: log.data, topics: log.topics });
      return equal(args.from, payer) && equal(args.to, escrow) && args.value === BigInt(amount);
    } catch { return false; }
  });
}
