import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import solc from 'solc';
import { createPublicClient, createWalletClient, custom, defineChain, parseAbi, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { paymentContext, requestHash, paymentProofMessage, PAYMENT_SCHEME } from '../app/lib/payment-request.mjs';
import { parsePaymentProof, verifyEscrowPayment } from '../app/api/ask-and-settle/verify-payment.mjs';

test('real local EVM: USDC proof, adversarial inputs, release/refund/timeout', async t => {
  const rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 43113, hardfork: 'shanghai' },
    wallet: { deterministic: true } });
  t.after(() => rpc.disconnect());
  const accounts = Object.values(rpc.getInitialAccounts()).slice(0, 3).map(a => privateKeyToAccount(a.secretKey));
  const [payer, oracle, treasury] = accounts;
  const chain = defineChain({ id: 43113, name: 'LOCAL EVM ONLY', nativeCurrency: { name: 'TEST', symbol: 'TEST', decimals: 18 },
    rpcUrls: { default: { http: ['http://127.0.0.1'] } } });
  const client = createPublicClient({ chain, transport: custom(rpc), cacheTime: 0 });
  const wallets = accounts.map(account => createWalletClient({ account, chain, transport: custom(rpc) }));
  const tokenSource = `pragma solidity ^0.8.20;
contract TestUsdc {
  mapping(address=>uint) public balanceOf;
  mapping(address=>mapping(address=>uint)) public allowance;
  event Transfer(address indexed from,address indexed to,uint256 value);
  constructor(){balanceOf[msg.sender]=100000000; emit Transfer(address(0),msg.sender,100000000);}
  function approve(address to,uint n) external returns(bool){allowance[msg.sender][to]=n;return true;}
  function transfer(address to,uint n) external returns(bool){require(balanceOf[msg.sender]>=n);balanceOf[msg.sender]-=n;balanceOf[to]+=n;emit Transfer(msg.sender,to,n);return true;}
  function transferFrom(address from,address to,uint n) external returns(bool){require(balanceOf[from]>=n&&allowance[from][msg.sender]>=n);allowance[from][msg.sender]-=n;balanceOf[from]-=n;balanceOf[to]+=n;emit Transfer(from,to,n);return true;}
}`;
  const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: {
    'TestUsdc.sol': { content: tokenSource },
    'AskPayEscrow.sol': { content: fs.readFileSync(new URL('../contracts/AskPayEscrow.sol', import.meta.url), 'utf8') }
  }, settings: { evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  assert.equal((compiled.errors || []).filter(e => e.severity === 'error').length, 0);
  const token = compiled.contracts['TestUsdc.sol'].TestUsdc;
  const escrow = compiled.contracts['AskPayEscrow.sol'].AskPayEscrow;
  async function mined(hash) { return client.waitForTransactionReceipt({ hash, pollingInterval: 10 }); }
  const tokenAddr = (await mined(await wallets[0].deployContract({ abi: token.abi, bytecode: `0x${token.evm.bytecode.object}` }))).contractAddress;
  const escrowAddr = (await mined(await wallets[0].deployContract({ abi: escrow.abi, bytecode: `0x${escrow.evm.bytecode.object}`,
    args: [oracle.address, treasury.address, tokenAddr] }))).contractAddress;
  await mined(await wallets[0].writeContract({ address: tokenAddr, abi: token.abi, functionName: 'approve', args: [escrowAddr, 100000000n] }));
  let sequence = 0;
  const config = { chainId: 43113, escrowAddress: escrowAddr, usdcAddress: tokenAddr, corpusHash: 'a'.repeat(64), asOf: '2026-11-17' };
  async function proofFor(context, txHash, account = payer) {
    return { version: 2, scheme: PAYMENT_SCHEME, chainId: 43113, asset: tokenAddr, escrow: escrowAddr,
      requestHash: requestHash(context), txHash, signature: await account.signMessage({ message: paymentProofMessage(context, txHash) }) };
  }
  async function deposit(tier = 'quick', badAmount = false) {
    const context = paymentContext({ questionId: keccak256(toBytes(`case-${++sequence}`)), question: 'Thời hạn nộp tờ khai?',
      tier, askerAddress: payer.address }, config);
    const txHash = await wallets[0].writeContract({ address: escrowAddr, abi: escrow.abi, functionName: 'askQuestionUsdc',
      args: [context.questionId, tier === 'deep' ? 1 : 0, requestHash(context), BigInt(context.amount) + (badAmount ? 1n : 0n)], gas: 600000n });
    await mined(txHash);
    return { context, proof: await proofFor(context, txHash) };
  }
  const verify = (d, c = client, confirmations = 1) => verifyEscrowPayment({ client: c, ...d, confirmations });
  const fails = (fn, code) => assert.rejects(fn, e => e.code === code, code);
  const d = await deposit();
  await t.test('quick funded USDC succeeds', async () => assert.equal((await verify(d)).amount, '50000'));
  await t.test('deep funded USDC succeeds', async () => assert.equal((await verify(await deposit('deep'))).amount, '200000'));
  await t.test('empty and signature-only proof rejected', () => {
    for (const proof of [{}, { authorization: {} }]) assert.throws(() => parsePaymentProof(Buffer.from(JSON.stringify(proof)).toString('base64')));
  });
  await t.test('fake tx hash never counts as payment', async () => {
    const proof = await proofFor(d.context, '0x' + 'f'.repeat(64));
    await fails(() => verify({ context: d.context, proof }), 'PAYMENT_NOT_FOUND');
  });
  await t.test('wrong scheme rejected', () => fails(() => verify({ ...d, proof: { ...d.proof, scheme: 'anything' } }), 'UNSUPPORTED_PAYMENT_SCHEME'));
  await t.test('wrong token rejected', () => fails(() => verify({ ...d, proof: { ...d.proof, asset: treasury.address } }), 'PAYMENT_DOMAIN_MISMATCH'));
  await t.test('wrong chain rejected', () => fails(() => verify(d, { ...client, getChainId: async () => 1 }), 'RPC_CHAIN_MISMATCH'));
  await t.test('changed date conflicts', () => fails(() => verify({ ...d, context: { ...d.context, asOf: '2026-11-16' } }), 'PAYMENT_REQUEST_MISMATCH'));
  await t.test('changed corpus conflicts', () => fails(() => verify({ ...d, context: { ...d.context, corpusHash: 'b'.repeat(64) } }), 'PAYMENT_REQUEST_MISMATCH'));
  await t.test('changed tier conflicts', () => fails(() => verify({ ...d, context: { ...d.context, tier: 'deep', amount: '200000' } }), 'PAYMENT_REQUEST_MISMATCH'));
  await t.test('payer signature must match', async () => {
    const proof = await proofFor(d.context, d.proof.txHash, oracle);
    await fails(() => verify({ context: d.context, proof }), 'PAYER_SIGNATURE_MISMATCH');
  });
  await t.test('forged context with fresh signature still fails onchain binding', async () => {
    const context = { ...d.context, asOf: '2026-11-15' };
    const proof = await proofFor(context, d.proof.txHash);
    await fails(() => verify({ context, proof }), 'DEPOSIT_ARGUMENT_MISMATCH');
  });
  await t.test('receipt must have enough confirmations', () => fails(() => verify(d, client, 10000), 'PAYMENT_NOT_FINAL'));
  await t.test('receipt reorg detected', () => fails(() => verify(d, { ...client,
    getBlock: async args => { const b = await client.getBlock(args); return args.blockNumber !== undefined ? { ...b, hash: '0x' + 'b'.repeat(64) } : b; }
  }), 'DEPOSIT_REORGED'));
  await t.test('receipt without real USDC transfer rejected', () => fails(() => verify(d, { ...client,
    getTransactionReceipt: async args => { const r = await client.getTransactionReceipt(args); return { ...r, logs: r.logs.filter(l => l.address.toLowerCase() !== tokenAddr.toLowerCase()) }; }
  }), 'USDC_TRANSFER_NOT_FOUND'));
  await t.test('reverted transaction rejected', async () => { const bad = await deposit('quick', true); await fails(() => verify(bad), 'DEPOSIT_REVERTED'); });
  const balance = addr => client.readContract({ address: tokenAddr, abi: token.abi, functionName: 'balanceOf', args: [addr] });
  await t.test('pass releases exact amount once; settled proof rejected', async () => {
    const before = await balance(treasury.address);
    await mined(await wallets[1].writeContract({ address: escrowAddr, abi: escrow.abi, functionName: 'resolveQuestion',
      args: [d.context.questionId, true, 10000, '0x' + 'c'.repeat(64)] }));
    assert.equal(await balance(treasury.address) - before, 50000n);
    await fails(() => verify(d), 'ESCROW_ALREADY_RESOLVED');
  });
  await t.test('fail refunds exact amount to payer', async () => {
    const refund = await deposit(); const before = await balance(payer.address);
    await mined(await wallets[1].writeContract({ address: escrowAddr, abi: escrow.abi, functionName: 'resolveQuestion',
      args: [refund.context.questionId, false, 0, '0x' + 'c'.repeat(64)] }));
    assert.equal(await balance(payer.address) - before, 50000n);
    await fails(() => verify(refund), 'ESCROW_ALREADY_RESOLVED');
  });
  await t.test('timeout blocks processing and refunds payer', async () => {
    const timeout = await deposit(); const before = await balance(payer.address);
    await rpc.request({ method: 'evm_increaseTime', params: [301] });
    await rpc.request({ method: 'evm_mine', params: [] });
    await fails(() => verify(timeout), 'ESCROW_TIMEOUT_REACHED');
    await mined(await wallets[0].writeContract({ address: escrowAddr, abi: escrow.abi, functionName: 'claimTimeoutRefund', args: [timeout.context.questionId] }));
    assert.equal(await balance(payer.address) - before, 50000n);
  });
});
