import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { paymentContext, paymentProofMessage, requestHash, PAYMENT_SCHEME } from "../app/lib/payment-request.mjs";
import { verifyPaymentSignature } from "../app/api/ask-and-settle/verify-payment.mjs";
import {
  acquirePaidJob,
  abortUnverifiedJob,
  JOURNAL_STAGES,
  JournalConflictError,
  markDepositVerified,
  readSettlementJournal,
  reconcileOnchainEscrowState,
  reconcilePendingJobs,
  releasePaidJobLock,
  savePersistedQA,
  saveRecordedReceipt,
  saveSettledOutcome
} from "../app/api/ask-and-settle/settlement-journal.mjs";

const PAYER_ACCOUNT = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
);
const ESCROW_ADDR = "0x1111111111111111111111111111111111111111";
const USDC_ADDR = "0x2222222222222222222222222222222222222222";
const CORPUS_SHA = "38f84d5d593a86142b23bb6d79187192a847be52f56f2befa9f0c0fabdd2bec3";

async function makeTempJournalPath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lorx-journal-test-"));
  return { dir, journalPath: path.join(dir, "settlement-journal.json") };
}

function makeHex32(fill) {
  return `0x${fill.repeat(64).slice(0, 64)}`;
}

async function createSignedProof({ questionId, question, tier = "quick", txHash }) {
  const ctx = paymentContext(
    { questionId, question, tier, askerAddress: PAYER_ACCOUNT.address },
    {
      chainId: 43113,
      escrowAddress: ESCROW_ADDR,
      usdcAddress: USDC_ADDR,
      corpusHash: CORPUS_SHA,
      asOf: "2026-11-17"
    }
  );
  const reqHash = requestHash(ctx);
  const signature = await PAYER_ACCOUNT.signMessage({
    message: paymentProofMessage(ctx, txHash)
  });
  return {
    ctx,
    reqHash,
    proof: {
      scheme: PAYMENT_SCHEME,
      version: 2,
      chainId: 43113,
      asset: USDC_ADDR,
      escrow: ESCROW_ADDR,
      payer: PAYER_ACCOUNT.address,
      txHash,
      requestHash: reqHash,
      signature
    }
  };
}

test("rejects txHash reuse across different questionIds with 409 DEPOSIT_TX_REUSED", async () => {
  const { dir, journalPath } = await makeTempJournalPath();
  try {
    const txHash = makeHex32("a");
    const first = await acquirePaidJob({
      journalPath,
      questionId: makeHex32("1"),
      txHash,
      requestHash: makeHex32("c"),
      corpusHash: CORPUS_SHA,
      payer: PAYER_ACCOUNT.address,
      amount: "50000",
      asOf: "2026-11-17"
    });
    await releasePaidJobLock({ journalPath, questionId: makeHex32("1"), leaseOwner: first.leaseOwner });

    await assert.rejects(
      () =>
        acquirePaidJob({
          journalPath,
          questionId: makeHex32("2"),
          txHash,
          requestHash: makeHex32("d"),
          corpusHash: CORPUS_SHA,
          payer: PAYER_ACCOUNT.address,
          amount: "50000",
          asOf: "2026-11-17"
        }),
      (err) => err instanceof JournalConflictError && err.status === 409 && err.code === "DEPOSIT_TX_REUSED"
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("rejects requestHash mismatch, tx conflict for same questionId, and active concurrent lock with 409", async () => {
  const { dir, journalPath } = await makeTempJournalPath();
  try {
    const qId = makeHex32("1");
    const tx1 = makeHex32("a");
    const tx2 = makeHex32("b");
    const req1 = makeHex32("c");
    const req2 = makeHex32("d");

    const acquired = await acquirePaidJob({
      journalPath,
      questionId: qId,
      txHash: tx1,
      requestHash: req1
    });

    await assert.rejects(
      () => acquirePaidJob({ journalPath, questionId: qId, txHash: tx1, requestHash: req1 }),
      (err) => err instanceof JournalConflictError && err.status === 409 && err.code === "JOB_IN_PROGRESS"
    );

    await releasePaidJobLock({ journalPath, questionId: qId, leaseOwner: acquired.leaseOwner });

    await assert.rejects(
      () => acquirePaidJob({ journalPath, questionId: qId, txHash: tx1, requestHash: req2 }),
      (err) => err instanceof JournalConflictError && err.status === 409 && err.code === "REQUEST_HASH_MISMATCH"
    );

    await assert.rejects(
      () => acquirePaidJob({ journalPath, questionId: qId, txHash: tx2, requestHash: req1 }),
      (err) => err instanceof JournalConflictError && err.status === 409 && err.code === "QUESTION_ID_TX_CONFLICT"
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("crash recovery at QA_PERSISTED resumes without re-running QA and completes receipt + settlement", async () => {
  const { dir, journalPath } = await makeTempJournalPath();
  try {
    const qId = makeHex32("3");
    const txHash = makeHex32("e");
    const { ctx, reqHash } = await createSignedProof({
      questionId: qId,
      question: "Thời hạn nộp tờ khai hải quan đối với hàng hóa nhập khẩu theo Luật 54/2014/QH13?",
      txHash
    });

    // Run 1: deposit verified + QA persisted, then process crashes before recordReceipt
    const run1 = await acquirePaidJob({
      journalPath,
      questionId: qId,
      txHash,
      requestHash: reqHash,
      nowMs: 1000,
      leaseMs: 5000
    });
    await markDepositVerified({
      journalPath,
      questionId: qId,
      leaseOwner: run1.leaseOwner,
      x402Verification: { verified: true, payer: ctx.payer, txHash, requestHash: reqHash }
    });
    await savePersistedQA({
      journalPath,
      questionId: qId,
      leaseOwner: run1.leaseOwner,
      ragData: { answer: "30 ngày", validation: { passed: true, settlement_eligible: true, overall_score: 0.99 } },
      scoreInt: 99,
      canRelease: true,
      settlementStatus: "PENDING_RECONCILIATION",
      hashes: { requestHash: reqHash }
    });
    // Simulate sudden crash (no lock release, wait until lease expires at t = 7000)

    const run2 = await acquirePaidJob({
      journalPath,
      questionId: qId,
      txHash,
      requestHash: reqHash,
      nowMs: 7000,
      leaseMs: 5000
    });
    assert.equal(run2.resumed, true);
    assert.equal(run2.job.stage, JOURNAL_STAGES.QA_PERSISTED);
    assert.equal(run2.job.depositVerified, true);
    assert.equal(run2.job.qa.ragData.answer, "30 ngày");
    assert.equal(run2.job.receipt, null);

    let qaComputeCount = 0;
    let receiptCalls = 0;
    let settleCalls = 0;
    if (!run2.job.qa?.ragData) qaComputeCount += 1;
    if (!run2.job.receipt?.l1TxHash) {
      receiptCalls += 1;
      await saveRecordedReceipt({
        journalPath,
        questionId: qId,
        leaseOwner: run2.leaseOwner,
        l1TxHash: makeHex32("f"),
        chainId: 43113
      });
    }
    settleCalls += 1;
    await saveSettledOutcome({
      journalPath,
      questionId: qId,
      leaseOwner: run2.leaseOwner,
      settlementTxHash: makeHex32("9"),
      settlementStatus: "RELEASED_TO_TREASURY",
      onchainStatus: 2,
      l1TxHash: makeHex32("f")
    });
    await releasePaidJobLock({ journalPath, questionId: qId, leaseOwner: run2.leaseOwner });

    assert.equal(qaComputeCount, 0);
    assert.equal(receiptCalls, 1);
    assert.equal(settleCalls, 1);

    const saved = await readSettlementJournal(journalPath);
    assert.equal(saved.jobs[qId.toLowerCase()].stage, JOURNAL_STAGES.SETTLED);
    assert.equal(saved.jobs[qId.toLowerCase()].locked, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("crash recovery at RECEIPT_RECORDED never sends a duplicate recordReceipt tx", async () => {
  const { dir, journalPath } = await makeTempJournalPath();
  try {
    const qId = makeHex32("4");
    const txHash = makeHex32("5");
    const receiptTx = makeHex32("7");
    const settleTx = makeHex32("8");
    const { ctx, reqHash, proof } = await createSignedProof({
      questionId: qId,
      question: "Thời hạn nộp tờ khai hải quan đối với hàng hóa nhập khẩu theo Điều 25 Khoản 1 Luật 54/2014/QH13?",
      txHash
    });

    let receiptWriteCount = 0;
    let settleWriteCount = 0;

    // Attempt 1 crashes immediately after recordReceipt before resolveQuestion
    const run1 = await acquirePaidJob({ journalPath, questionId: qId, txHash, requestHash: reqHash });
    await markDepositVerified({
      journalPath,
      questionId: qId,
      leaseOwner: run1.leaseOwner,
      x402Verification: { verified: true, payer: ctx.payer, txHash, requestHash: reqHash }
    });
    await savePersistedQA({
      journalPath,
      questionId: qId,
      leaseOwner: run1.leaseOwner,
      ragData: { answer: "30 ngày", validation: { passed: true, settlement_eligible: true, overall_score: 1.0 } },
      scoreInt: 100,
      canRelease: true,
      settlementStatus: "PENDING_RECONCILIATION"
    });
    receiptWriteCount += 1;
    await saveRecordedReceipt({
      journalPath,
      questionId: qId,
      leaseOwner: run1.leaseOwner,
      l1TxHash: receiptTx,
      chainId: 43113
    });
    await releasePaidJobLock({ journalPath, questionId: qId, leaseOwner: run1.leaseOwner });

    // Attempt 2: verifyPaymentSignature succeeds offline, escrow on-chain is still PENDING (status=1)
    await verifyPaymentSignature({ context: ctx, proof });
    const run2 = await acquirePaidJob({ journalPath, questionId: qId, txHash, requestHash: reqHash });
    assert.equal(run2.resumed, true);
    assert.equal(run2.job.stage, JOURNAL_STAGES.RECEIPT_RECORDED);

    const mockPendingClient = {
      async readContract() {
        return [ctx.payer, 50000n, 0, 1, 1700000000n, reqHash, makeHex32("0"), 0, true];
      }
    };
    const rec = await reconcileOnchainEscrowState({
      client: mockPendingClient,
      escrowAddress: ESCROW_ADDR,
      abi: [],
      questionId: qId,
      journalPath,
      leaseOwner: run2.leaseOwner,
      job: run2.job
    });
    assert.equal(rec.pending, true);
    assert.equal(rec.settledOnchain, false);

    if (!run2.job.receipt?.l1TxHash) {
      receiptWriteCount += 1;
    }
    settleWriteCount += 1;
    await saveSettledOutcome({
      journalPath,
      questionId: qId,
      leaseOwner: run2.leaseOwner,
      settlementTxHash: settleTx,
      settlementStatus: "RELEASED_TO_TREASURY",
      onchainStatus: 2,
      l1TxHash: run2.job.receipt.l1TxHash
    });
    await releasePaidJobLock({ journalPath, questionId: qId, leaseOwner: run2.leaseOwner });

    assert.equal(receiptWriteCount, 1);
    assert.equal(settleWriteCount, 1);

    const saved = await readSettlementJournal(journalPath);
    assert.equal(saved.jobs[qId.toLowerCase()].receipt.l1TxHash, receiptTx);
    assert.equal(saved.jobs[qId.toLowerCase()].settlement.settlementTxHash, settleTx);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("reconciles already-resolved on-chain escrow (RELEASED/REFUNDED_INVALID) and signature stays valid on retry", async () => {
  const { dir, journalPath } = await makeTempJournalPath();
  try {
    const qId = makeHex32("6");
    const txHash = makeHex32("2");
    const onchainReceipt = makeHex32("b");
    const { ctx, reqHash, proof } = await createSignedProof({
      questionId: qId,
      question: "Nghị định 128/2020/NĐ-CP còn hiệu lực không?",
      txHash
    });

    const run1 = await acquirePaidJob({ journalPath, questionId: qId, txHash, requestHash: reqHash });
    await markDepositVerified({
      journalPath,
      questionId: qId,
      leaseOwner: run1.leaseOwner,
      x402Verification: { verified: true, payer: ctx.payer, txHash, requestHash: reqHash }
    });
    await savePersistedQA({
      journalPath,
      questionId: qId,
      leaseOwner: run1.leaseOwner,
      ragData: { answer: "Hết hiệu lực", validation: { passed: true, settlement_eligible: true, overall_score: 0.99 } },
      scoreInt: 99,
      canRelease: true,
      settlementStatus: "PENDING_RECONCILIATION"
    });
    await releasePaidJobLock({ journalPath, questionId: qId, leaseOwner: run1.leaseOwner });

    // Offline signature still validates cleanly even though escrow is now status=2 (RELEASED) on-chain
    const sigCheck = await verifyPaymentSignature({ context: ctx, proof });
    assert.equal(sigCheck.requestHash.toLowerCase(), reqHash.toLowerCase());

    const mockResolvedClient = {
      async readContract({ args }) {
        assert.equal(args[0], qId);
        return [ctx.payer, 50000n, 0, 2, 1700000000n, reqHash, onchainReceipt, 99, true];
      }
    };

    const reconciled = await reconcilePendingJobs({
      journalPath,
      client: mockResolvedClient,
      escrowAddress: ESCROW_ADDR,
      abi: []
    });
    assert.equal(reconciled.length, 1);
    assert.equal(reconciled[0].settledOnchain, true);
    assert.equal(reconciled[0].settlementStatus, "RELEASED_TO_TREASURY");
    assert.equal(reconciled[0].l1TxHash, onchainReceipt);

    const saved = await readSettlementJournal(journalPath);
    assert.equal(saved.jobs[qId.toLowerCase()].stage, JOURNAL_STAGES.SETTLED);
    assert.equal(saved.jobs[qId.toLowerCase()].settlement.settlementStatus, "RELEASED_TO_TREASURY");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("abortUnverifiedJob cleans up failed pre-confirmation attempt so confirmed retry succeeds", async () => {
  const { dir, journalPath } = await makeTempJournalPath();
  try {
    const qId = makeHex32("7");
    const txHash = makeHex32("8");
    const reqHash = makeHex32("9");

    const attempt1 = await acquirePaidJob({ journalPath, questionId: qId, txHash, requestHash: reqHash });
    const aborted = await abortUnverifiedJob({
      journalPath,
      questionId: qId,
      leaseOwner: attempt1.leaseOwner
    });
    assert.equal(aborted, true);

    const attempt2 = await acquirePaidJob({ journalPath, questionId: qId, txHash, requestHash: reqHash });
    assert.equal(attempt2.resumed, false);
    await releasePaidJobLock({ journalPath, questionId: qId, leaseOwner: attempt2.leaseOwner });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
