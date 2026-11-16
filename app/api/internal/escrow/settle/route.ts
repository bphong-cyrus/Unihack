import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, isAddress, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";
const escrowAbi = parseAbi([
  "function questions(bytes32) view returns (address payer, uint256 amount, uint8 tier, uint8 status, uint64 createdAt, bytes32 questionHash, bytes32 paymentTxHash, bytes32 answerHash, uint16 validatorScore)",
  "function registerPayment(bytes32 queryId, address payer, uint8 tier, bytes32 questionHash, bytes32 paymentTxHash)",
  "function resolveQuestion(bytes32 queryId, bool passed, uint16 validatorScore, bytes32 answerHash)"
]);
import { hasFujiUsdcTransfer } from "./fuji-usdc-transfer.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type SettlementRequest = {
  action: "register" | "resolve" | "status";
  query_id: string;
  question_hash: string;
  tier: "quick" | "deep";
  amount: string;
  payer: string;
  payment_tx_hash: string;
  passed: boolean;
  validator_score: number;
  answer_hash: string;
};

function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isBytes32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function validBody(value: unknown): value is SettlementRequest {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<SettlementRequest>;
  const expectedAmount = body.tier === "quick" ? "50000" : body.tier === "deep" ? "200000" : "";
  return (body.action === "register" || body.action === "resolve" || body.action === "status") && isBytes32(body.query_id) && isBytes32(body.question_hash) &&
    isBytes32(body.payment_tx_hash) && (body.answer_hash === "" || isBytes32(body.answer_hash)) &&
    (body.tier === "quick" || body.tier === "deep") && body.amount === expectedAmount &&
    typeof body.payer === "string" && isAddress(body.payer) && typeof body.passed === "boolean" &&
    Number.isInteger(body.validator_score) && Number(body.validator_score) >= 0 && Number(body.validator_score) <= 10000;
}

function mapContractStatus(status: number): "RELEASED" | "AUTO-REFUNDED" | "PENDING" {
  if (status === 2) return "RELEASED";
  if (status === 3 || status === 4) return "AUTO-REFUNDED";
  return "PENDING";
}

export async function POST(request: Request) {
  const expectedToken = process.env.ASKPAY_SETTLEMENT_TOKEN || "";
  const suppliedToken = request.headers.get("X-AskPay-Settlement-Token") || "";
  if (!expectedToken || !equalSecret(suppliedToken, expectedToken)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!validBody(body)) return NextResponse.json({ error: "Invalid escrow settlement payload." }, { status: 400 });

  const escrowAddress = process.env.ESCROW_CONTRACT_ADDRESS || process.env.ASKPAY_ESCROW_ADDRESS || "";
  const privateKey = process.env.ORACLE_PRIVATE_KEY || process.env.ASKPAY_ORACLE_PRIVATE_KEY || "";
  const rpcUrl = process.env.FUJI_RPC_URL || process.env.ASKPAY_FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";
  if (!isAddress(escrowAddress) || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    return NextResponse.json({ error: "Fuji AnswerEscrow oracle is not configured." }, { status: 503 });
  }

  try {
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const publicClient = createPublicClient({ chain: avalancheFuji, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ account, chain: avalancheFuji, transport: http(rpcUrl) });
    if (await publicClient.getChainId() !== 43113) {
      return NextResponse.json({ error: "Configured RPC is not Avalanche Fuji." }, { status: 503 });
    }

    const queryId = body.query_id as `0x${string}`;
    const existing = await publicClient.readContract({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: "questions",
      args: [queryId],
      authorizationList: undefined
    }) as readonly [string, bigint, number, number, bigint, string, string, string, number];
    const initialStatus = existing[3];

    if (initialStatus !== 0 && (existing[0].toLowerCase() !== body.payer.toLowerCase() ||
        existing[1] !== BigInt(body.amount) || existing[2] !== (body.tier === 'quick' ? 0 : 1) ||
        existing[5].toLowerCase() !== body.question_hash.toLowerCase() ||
        existing[6].toLowerCase() !== body.payment_tx_hash.toLowerCase())) {
      return NextResponse.json({ error: 'Query ID conflicts with registered payment.' }, { status: 409 });
    }

    if (initialStatus === 2 || initialStatus === 3 || initialStatus === 4) {
      return NextResponse.json({ status: mapContractStatus(initialStatus), tx_hash: "", already_settled: true });
    }

    if (body.action === 'status') {
      return NextResponse.json({ status: initialStatus === 1 ? 'LOCKED' : 'PENDING', tx_hash: '' });
    }

    if (body.action === 'resolve' && initialStatus !== 1) {
      return NextResponse.json({ status: 'PENDING', tx_hash: '' }, { status: 202 });
    }

    if (body.action === 'register' && initialStatus === 1) {
      return NextResponse.json({ status: 'LOCKED', tx_hash: '', already_registered: true });
    }

    if (initialStatus === 0) {
      const paymentReceipt = await publicClient.getTransactionReceipt({ hash: body.payment_tx_hash as `0x${string}` });
      const paymentMatches = hasFujiUsdcTransfer(paymentReceipt, body.payer, escrowAddress, body.amount);
      if (!paymentMatches) return NextResponse.json({ error: 'Payment receipt does not match Fuji USDC transfer.' }, { status: 400 });
      const registerHash = await walletClient.writeContract({
        address: escrowAddress,
        abi: escrowAbi,
        chain: avalancheFuji,
        account,
        functionName: "registerPayment",
        args: [
          queryId,
          body.payer as `0x${string}`,
          body.tier === "quick" ? 0 : 1,
          body.question_hash as `0x${string}`,
          body.payment_tx_hash as `0x${string}`
        ]
      });
      const registerReceipt = await publicClient.waitForTransactionReceipt({ hash: registerHash });
      if (registerReceipt.status !== "success") {
        return NextResponse.json({ status: "PENDING", register_tx_hash: registerHash, tx_hash: "" }, { status: 202 });
      }
      return NextResponse.json({ status: 'LOCKED', tx_hash: registerHash });
    }

    const resolveHash = await walletClient.writeContract({
      address: escrowAddress,
      abi: escrowAbi,
      chain: avalancheFuji,
      account,
      functionName: "resolveQuestion",
      args: [queryId, body.passed, body.validator_score, (body.answer_hash || `0x${"0".repeat(64)}`) as `0x${string}`]
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: resolveHash });
    if (receipt.status !== "success") {
      return NextResponse.json({ status: "PENDING", tx_hash: resolveHash }, { status: 202 });
    }
    return NextResponse.json({
      status: body.passed ? "RELEASED" : "AUTO-REFUNDED",
      tx_hash: resolveHash,
      payment_tx_hash: body.payment_tx_hash,
      register_tx_hash: initialStatus === 0 ? undefined : "",
      explorer_url: `https://testnet.snowtrace.io/tx/${resolveHash}`
    });
  } catch {
    return NextResponse.json({ status: "PENDING", tx_hash: "" }, { status: 202 });
  }
}
