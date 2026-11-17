import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

export const JOURNAL_STAGES = Object.freeze({
  ACQUIRED: "ACQUIRED",
  QA_PERSISTED: "QA_PERSISTED",
  RECEIPT_RECORDED: "RECEIPT_RECORDED",
  SETTLED: "SETTLED"
});

const EMPTY_RECEIPT_HASH = /^0x0{64}$/i;
const fileQueues = new Map();

export class JournalConflictError extends Error {
  constructor(message, code = "JOURNAL_CONFLICT", status = 409) {
    super(message);
    this.name = "JournalConflictError";
    this.code = code;
    this.status = status;
  }
}

export function resolveJournalPath(journalPath = undefined) {
  return (
    journalPath ||
    process.env.ASKPAY_JOURNAL_PATH ||
    path.join(process.cwd(), ".data", "settlement-journal.json")
  );
}

function emptyJournal() {
  return { version: 1, jobs: {}, txIndex: {} };
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function withJournalLock(journalPath, fn) {
  const target = path.resolve(resolveJournalPath(journalPath));
  const prev = fileQueues.get(target) || Promise.resolve();
  const next = prev.then(() => fn(target));
  const settled = next.catch(() => {});
  fileQueues.set(target, settled);
  settled.finally(() => {
    if (fileQueues.get(target) === settled) {
      fileQueues.delete(target);
    }
  });
  return next;
}

async function readJournalFile(target) {
  try {
    const raw = await fs.readFile(target, "utf8");
    const parsed = JSON.parse(raw);
    return {
      version: Number(parsed?.version || 1),
      jobs: parsed?.jobs && typeof parsed.jobs === "object" ? parsed.jobs : {},
      txIndex: parsed?.txIndex && typeof parsed.txIndex === "object" ? parsed.txIndex : {}
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return emptyJournal();
    }
    throw error;
  }
}

async function writeJournalFile(target, journal) {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const payload = JSON.stringify(journal, null, 2);
  try {
    await fs.writeFile(tmpPath, payload, "utf8");
    await fs.rename(tmpPath, target);
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => {});
    throw error;
  }
}

/**
 * Reads the persisted settlement journal without mutating it.
 */
export async function readSettlementJournal(journalPath = undefined) {
  return withJournalLock(journalPath, (target) => readJournalFile(target));
}

/**
 * Acquires an exclusive in-journal lease for a paid questionId + deposit txHash pair,
 * enforcing uniqueness on txHash, questionId, and requestHash.
 */
export async function acquirePaidJob({
  journalPath = undefined,
  questionId,
  txHash,
  requestHash,
  corpusHash = "",
  payer = "",
  amount = "",
  asOf = "",
  leaseMs = 60_000,
  nowMs = Date.now()
}) {
  const qKey = String(questionId || "").toLowerCase();
  const txKey = String(txHash || "").toLowerCase();
  const reqKey = String(requestHash || "").toLowerCase();

  if (!qKey || !txKey || !reqKey) {
    throw new JournalConflictError("Thiếu questionId, txHash hoặc requestHash để ghi journal.", "INVALID_JOB_KEY", 400);
  }

  return withJournalLock(journalPath, async (target) => {
    const journal = await readJournalFile(target);
    const boundQuestionKey = journal.txIndex[txKey];
    if (boundQuestionKey && boundQuestionKey !== qKey) {
      throw new JournalConflictError(
        "Giao dịch đặt cọc (txHash) đã được liên kết với một questionId khác.",
        "DEPOSIT_TX_REUSED",
        409
      );
    }

    const leaseOwner = crypto.randomUUID();
    const isoNow = new Date(nowMs).toISOString();
    const existing = journal.jobs[qKey];

    if (!existing) {
      const job = {
        questionId,
        txHash,
        requestHash,
        corpusHash: String(corpusHash || ""),
        payer: String(payer || ""),
        amount: amount != null ? String(amount) : "",
        asOf: String(asOf || ""),
        stage: JOURNAL_STAGES.ACQUIRED,
        depositVerified: false,
        x402Verification: null,
        locked: true,
        leaseOwner,
        leaseExpiresAt: nowMs + leaseMs,
        createdAt: isoNow,
        updatedAt: isoNow,
        qa: null,
        receipt: null,
        settlement: null
      };
      journal.jobs[qKey] = job;
      journal.txIndex[txKey] = qKey;
      await writeJournalFile(target, journal);
      return { job: clone(job), leaseOwner, resumed: false };
    }

    if (String(existing.txHash || "").toLowerCase() !== txKey) {
      throw new JournalConflictError(
        "questionId này đã gắn với một giao dịch đặt cọc (txHash) khác.",
        "QUESTION_ID_TX_CONFLICT",
        409
      );
    }

    if (String(existing.requestHash || "").toLowerCase() !== reqKey) {
      throw new JournalConflictError(
        "Nội dung câu hỏi hoặc tham số thanh toán (requestHash) không khớp với job đã ghi nhận.",
        "REQUEST_HASH_MISMATCH",
        409
      );
    }

    if (existing.locked && Number(existing.leaseExpiresAt || 0) > nowMs) {
      throw new JournalConflictError(
        "Phiên thanh toán cho questionId này đang được xử lý; vui lòng thử lại sau ít giây.",
        "JOB_IN_PROGRESS",
        409
      );
    }

    existing.locked = true;
    existing.leaseOwner = leaseOwner;
    existing.leaseExpiresAt = nowMs + leaseMs;
    existing.updatedAt = isoNow;
    journal.txIndex[txKey] = qKey;
    await writeJournalFile(target, journal);
    return { job: clone(existing), leaseOwner, resumed: true };
  });
}

function assertLeaseHolder(job, leaseOwner) {
  if (!job) {
    throw new JournalConflictError("Không tìm thấy job trong settlement journal.", "JOB_NOT_FOUND", 404);
  }
  if (job.locked && job.leaseOwner && leaseOwner && job.leaseOwner !== leaseOwner) {
    throw new JournalConflictError("Mất quyền giữ khóa xử lý job thanh toán.", "JOB_LEASE_LOST", 409);
  }
}

/**
 * Records verified deposit metadata on the acquired job after on-chain confirmation passes.
 */
export async function markDepositVerified({ journalPath = undefined, questionId, leaseOwner, x402Verification }) {
  const qKey = String(questionId || "").toLowerCase();
  return withJournalLock(journalPath, async (target) => {
    const journal = await readJournalFile(target);
    const job = journal.jobs[qKey];
    assertLeaseHolder(job, leaseOwner);
    job.depositVerified = true;
    job.x402Verification = clone(x402Verification);
    job.updatedAt = new Date().toISOString();
    await writeJournalFile(target, journal);
    return clone(job);
  });
}

/**
 * Removes an unverified initial reservation if on-chain deposit verification failed before QA.
 */
export async function abortUnverifiedJob({ journalPath = undefined, questionId, leaseOwner }) {
  const qKey = String(questionId || "").toLowerCase();
  return withJournalLock(journalPath, async (target) => {
    const journal = await readJournalFile(target);
    const job = journal.jobs[qKey];
    if (!job || job.leaseOwner !== leaseOwner) return false;
    if (job.depositVerified || job.stage !== JOURNAL_STAGES.ACQUIRED || job.qa) {
      return false;
    }
    const txKey = String(job.txHash || "").toLowerCase();
    delete journal.jobs[qKey];
    if (journal.txIndex[txKey] === qKey) {
      delete journal.txIndex[txKey];
    }
    await writeJournalFile(target, journal);
    return true;
  });
}

/**
 * Persists the deterministic QA answer and validation decision before submitting any on-chain tx.
 */
export async function savePersistedQA({
  journalPath = undefined,
  questionId,
  leaseOwner,
  ragData,
  scoreInt,
  canRelease,
  settlementStatus,
  blockReason = "",
  hashes = {}
}) {
  const qKey = String(questionId || "").toLowerCase();
  return withJournalLock(journalPath, async (target) => {
    const journal = await readJournalFile(target);
    const job = journal.jobs[qKey];
    assertLeaseHolder(job, leaseOwner);
    job.qa = {
      ragData: clone(ragData),
      scoreInt: Number(scoreInt || 0),
      canRelease: Boolean(canRelease),
      settlementStatus: String(settlementStatus || ""),
      blockReason: String(blockReason || ""),
      hashes: clone(hashes)
    };
    if (job.stage === JOURNAL_STAGES.ACQUIRED) {
      job.stage = JOURNAL_STAGES.QA_PERSISTED;
    }
    job.updatedAt = new Date().toISOString();
    await writeJournalFile(target, journal);
    return clone(job);
  });
}

/**
 * Persists the recorded audit receipt txHash so retries skip duplicate recordReceipt calls.
 */
export async function saveRecordedReceipt({
  journalPath = undefined,
  questionId,
  leaseOwner,
  l1TxHash,
  chainId = 0
}) {
  const qKey = String(questionId || "").toLowerCase();
  return withJournalLock(journalPath, async (target) => {
    const journal = await readJournalFile(target);
    const job = journal.jobs[qKey];
    assertLeaseHolder(job, leaseOwner);
    job.receipt = {
      l1TxHash: String(l1TxHash || ""),
      chainId: Number(chainId || 0),
      recordedAt: new Date().toISOString()
    };
    if (job.stage !== JOURNAL_STAGES.SETTLED) {
      job.stage = JOURNAL_STAGES.RECEIPT_RECORDED;
    }
    job.updatedAt = new Date().toISOString();
    await writeJournalFile(target, journal);
    return clone(job);
  });
}

/**
 * Marks a paid job SETTLED after resolveQuestion or on-chain reconciliation succeeds.
 */
export async function saveSettledOutcome({
  journalPath = undefined,
  questionId,
  leaseOwner = undefined,
  settlementTxHash = "",
  settlementStatus,
  onchainStatus = 0,
  l1TxHash = ""
}) {
  const qKey = String(questionId || "").toLowerCase();
  return withJournalLock(journalPath, async (target) => {
    const journal = await readJournalFile(target);
    const job = journal.jobs[qKey];
    assertLeaseHolder(job, leaseOwner);
    if (l1TxHash && (!job.receipt || !job.receipt.l1TxHash)) {
      job.receipt = {
        l1TxHash: String(l1TxHash),
        chainId: Number(job.receipt?.chainId || 0),
        recordedAt: job.receipt?.recordedAt || new Date().toISOString()
      };
    }
    job.settlement = {
      settlementTxHash: String(settlementTxHash || ""),
      settlementStatus: String(settlementStatus || ""),
      onchainStatus: Number(onchainStatus || 0),
      settledAt: new Date().toISOString()
    };
    job.stage = JOURNAL_STAGES.SETTLED;
    job.updatedAt = new Date().toISOString();
    await writeJournalFile(target, journal);
    return clone(job);
  });
}

/**
 * Releases an active job lease cleanly when the holder finishes or errors out.
 */
export async function releasePaidJobLock({ journalPath = undefined, questionId, leaseOwner }) {
  const qKey = String(questionId || "").toLowerCase();
  return withJournalLock(journalPath, async (target) => {
    const journal = await readJournalFile(target);
    const job = journal.jobs[qKey];
    if (!job || job.leaseOwner !== leaseOwner) return false;
    job.locked = false;
    job.leaseOwner = null;
    job.leaseExpiresAt = 0;
    job.updatedAt = new Date().toISOString();
    await writeJournalFile(target, journal);
    return true;
  });
}

export function mapOnchainStatusToSettlementStatus(onchainStatus) {
  switch (Number(onchainStatus)) {
    case 2:
      return "RELEASED_TO_TREASURY";
    case 3:
      return "AUTO_REFUNDED_TO_USER";
    case 4:
      return "TIMEOUT_REFUNDED";
    default:
      return null;
  }
}

/**
 * Reads AskPayEscrowV2.escrows(questionId) on-chain and reconciles resolved state into the journal.
 */
export async function reconcileOnchainEscrowState({
  client,
  escrowAddress,
  abi,
  questionId,
  journalPath = undefined,
  leaseOwner = undefined,
  job = undefined
}) {
  const q = await client.readContract({
    address: escrowAddress,
    abi,
    functionName: "escrows",
    args: [questionId]
  });

  const onchainStatus = Number(q?.[3] ?? 0);
  if (onchainStatus === 0) {
    return { found: false, pending: false, settledOnchain: false, onchainStatus: 0, escrowRecord: null };
  }

  const escrowRecord = {
    asker: q[0],
    amount: q[1].toString(),
    tier: Number(q[2]),
    status: onchainStatus,
    createdAt: q[4].toString(),
    questionHash: q[5],
    l1ReceiptHash: q[6],
    validatorScore: Number(q[7] ?? 0),
    isUsdc: Boolean(q[8])
  };

  if (onchainStatus === 1) {
    return {
      found: true,
      pending: true,
      settledOnchain: false,
      onchainStatus: 1,
      escrowRecord
    };
  }

  const settlementStatus = mapOnchainStatusToSettlementStatus(onchainStatus) || "RESOLVED_ONCHAIN";
  const onchainReceipt =
    q[6] && !EMPTY_RECEIPT_HASH.test(String(q[6])) ? String(q[6]) : "";
  const resolvedReceiptHash = job?.receipt?.l1TxHash || onchainReceipt;
  const resolvedSettlementTxHash = job?.settlement?.settlementTxHash || "";

  if (journalPath !== false && (journalPath || job)) {
    await saveSettledOutcome({
      journalPath,
      questionId,
      leaseOwner,
      settlementTxHash: resolvedSettlementTxHash,
      settlementStatus,
      onchainStatus,
      l1TxHash: resolvedReceiptHash
    });
  }

  return {
    found: true,
    pending: false,
    settledOnchain: true,
    onchainStatus,
    settlementStatus,
    l1TxHash: resolvedReceiptHash,
    settlementTxHash: resolvedSettlementTxHash,
    escrowRecord
  };
}

/**
 * Reconciles all unlocked non-SETTLED jobs from on-chain escrow state after a server restart.
 */
export async function reconcilePendingJobs({ journalPath = undefined, client, escrowAddress, abi }) {
  const journal = await readSettlementJournal(journalPath);
  const reconciled = [];
  for (const job of Object.values(journal.jobs)) {
    if (!job || job.stage === JOURNAL_STAGES.SETTLED || !job.depositVerified) continue;
    const outcome = await reconcileOnchainEscrowState({
      client,
      escrowAddress,
      abi,
      questionId: job.questionId,
      journalPath,
      leaseOwner: job.leaseOwner || undefined,
      job
    });
    if (outcome.settledOnchain) {
      reconciled.push({ questionId: job.questionId, ...outcome });
    }
  }
  return reconciled;
}
