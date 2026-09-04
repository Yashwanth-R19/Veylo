/**
 * backend/services/settlement/engine.js
 * ────────────────────────────────────────
 * THE SETTLEMENT ENGINE. VEYLO_BUILD_PLAN_REVISED.md Phase 4 Session 2, Part C.
 *
 * THE GOVERNING RULE: the backend never reasons "my database says release,
 * so I'll pay." On-chain state authorises; the provider executes; the
 * reference is written back on-chain. The outcome is read from the chain,
 * every time an action is about to be taken on its behalf — never from the
 * database alone (ensureAction() below re-reads chainService.getAgreement()
 * and refuses to proceed if it no longer matches the decision recorded at
 * intent time, rather than trusting the stored value silently).
 *
 * Three idempotent, independently-resumable steps, each safe to call
 * repeatedly (including after a real process crash) because it always
 * derives the SAME deterministic idempotencyKey and lets the provider (or
 * the outbox, for the on-chain leg) do the actual deduplication:
 *
 *   ensureHold             -> PaymentProvider.createHold
 *   ensureAction           -> PaymentProvider.release | .reverse
 *   ensureConfirmSettlement -> enqueues CONFIRM_SETTLEMENT via the outbox
 *                              (Phase 2 infrastructure, reused unchanged;
 *                              its own CONFIRM_SETTLEMENT case in outbox.js
 *                              is what actually flips Settlement to SETTLED)
 *
 * RECORDING INTENT BEFORE EVERY EXTERNAL CALL: the Settlement row is created
 * — with both idempotency keys already derived — in the SAME step that first
 * discovers the agreement needs settling, before ensureHold's provider call
 * is ever made. On restart, ensureHold/ensureAction never blindly retry from
 * scratch: they replay the provider call with the SAME idempotencyKey, which
 * the provider itself resolves idempotently (see SimulatedProvider.js) —
 * this is "querying the provider for the idempotency key" in practice, since
 * a real idempotency-key API (Stripe, Razorpay) is queried by REPLAYING the
 * call with that key, not via a separate lookup endpoint.
 */

const { keccak256, toUtf8Bytes } = require("ethers");
const prisma = require("../../db/prismaClient");
const canonical = require("../../lib/canonical");
const chainService = require("../chainService");
const outbox = require("../outbox");
const { SimulatedProvider } = require("./SimulatedProvider");

const provider = new SimulatedProvider();

const MAX_ATTEMPTS = 5;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const CALL_TIMEOUT_MS = 8000; // bounds PaymentProvider calls, including the TIMEOUT fault

function extractErrorMessage(err) {
  return err.reason || err.shortMessage || err.info?.error?.message || err.message || String(err);
}

function deriveKey(onChainAgreementId, action) {
  return canonical.hashCanonical({ scope: "veylo-settlement-v1", agreementId: onChainAgreementId, action });
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function recordAttemptFailure(settlementId, currentAttempts, currentStatus, err) {
  const attempts = currentAttempts + 1;
  const status = attempts >= MAX_ATTEMPTS ? "FAILED" : currentStatus;
  await prisma.settlement.update({
    where: { id: settlementId },
    data: { attempts, status, lastError: extractErrorMessage(err) },
  });
}

/**
 * Creates the Settlement row (the recorded intent) on first call for an
 * agreement, reading the decision from the chain exactly once here — every
 * later read of settlement.decision is a cache of that one authoritative
 * read, never an independently-invented value.
 */
async function getOrCreateSettlement(dbAgreementId) {
  const existing = await prisma.settlement.findUnique({ where: { agreementId: dbAgreementId } });
  if (existing) return existing;

  const agreement = await prisma.agreement.findUnique({ where: { id: dbAgreementId } });
  if (!agreement) throw new Error(`agreement ${dbAgreementId} not found`);
  if (agreement.onChainId === null) throw new Error(`agreement ${dbAgreementId} has no onChainId yet`);

  const onChain = await chainService.getAgreement(agreement.onChainId);
  if (onChain.status !== "SETTLEMENT_AUTHORIZED") {
    throw new Error(`agreement ${dbAgreementId} is not SETTLEMENT_AUTHORIZED on-chain (chain says ${onChain.status})`);
  }
  if (onChain.outcome !== "ACCEPT" && onChain.outcome !== "REJECT") {
    throw new Error(`agreement ${dbAgreementId} has no settleable on-chain outcome (${onChain.outcome})`);
  }

  const holdIdempotencyKey = deriveKey(agreement.onChainId, "HOLD");
  const idempotencyKey = deriveKey(agreement.onChainId, onChain.outcome === "ACCEPT" ? "RELEASE" : "REVERSE");

  // Two concurrent pollers racing to create the same row would violate the
  // agreementId unique constraint on the loser — treated as "someone else
  // already recorded the intent," not an error, matching the outbox's own
  // race tolerance philosophy.
  try {
    return await prisma.settlement.create({
      data: { agreementId: dbAgreementId, decision: onChain.outcome, holdIdempotencyKey, idempotencyKey, status: "PENDING" },
    });
  } catch (err) {
    const row = await prisma.settlement.findUnique({ where: { agreementId: dbAgreementId } });
    if (row) return row;
    throw err;
  }
}

async function ensureHold(dbAgreementId) {
  const settlement = await getOrCreateSettlement(dbAgreementId);
  if (settlement.holdRef) return settlement;
  if (settlement.status === "FAILED") return settlement; // terminal — visible via GET, not auto-retried

  const agreement = await prisma.agreement.findUnique({ where: { id: dbAgreementId } });

  try {
    const holdRef = await withTimeout(
      provider.createHold(agreement.onChainId, agreement.amountMinor, settlement.holdIdempotencyKey),
      CALL_TIMEOUT_MS,
      "createHold"
    );
    return await prisma.settlement.update({ where: { id: settlement.id }, data: { holdRef, lastError: null } });
  } catch (err) {
    await recordAttemptFailure(settlement.id, settlement.attempts, settlement.status, err);
    throw err;
  }
}

async function ensureAction(dbAgreementId) {
  let settlement = await prisma.settlement.findUnique({ where: { agreementId: dbAgreementId } });
  if (!settlement) throw new Error(`agreement ${dbAgreementId}: ensureHold must run before ensureAction`);
  if (!settlement.holdRef) throw new Error(`agreement ${dbAgreementId}: hold not yet completed`);
  if (settlement.providerRef) return settlement;
  if (settlement.status === "FAILED") return settlement;

  const agreement = await prisma.agreement.findUnique({ where: { id: dbAgreementId } });

  // Never advance on the database alone: re-verify against the chain, every
  // time, immediately before the action that actually moves the (simulated)
  // money — not just once at intent-recording time.
  const onChain = await chainService.getAgreement(agreement.onChainId);
  if (onChain.outcome !== settlement.decision) {
    throw new Error(
      `integrity error: on-chain outcome (${onChain.outcome}) no longer matches the decision recorded at intent time (${settlement.decision}) for agreement ${dbAgreementId}`
    );
  }

  try {
    const call = settlement.decision === "ACCEPT"
      ? provider.release(settlement.holdRef, settlement.idempotencyKey)
      : provider.reverse(settlement.holdRef, settlement.idempotencyKey);
    const ref = await withTimeout(call, CALL_TIMEOUT_MS, settlement.decision === "ACCEPT" ? "release" : "reverse");
    const settlementRefHash = keccak256(toUtf8Bytes(ref));
    return await prisma.settlement.update({
      where: { id: settlement.id },
      data: { providerRef: ref, settlementRefHash, executedAt: new Date(), lastError: null },
    });
  } catch (err) {
    await recordAttemptFailure(settlement.id, settlement.attempts, settlement.status, err);
    throw err;
  }
}

async function ensureConfirmSettlement(dbAgreementId) {
  const settlement = await prisma.settlement.findUnique({ where: { agreementId: dbAgreementId } });
  if (!settlement || !settlement.providerRef) throw new Error(`agreement ${dbAgreementId}: action not yet completed`);
  if (settlement.status === "SETTLED") return settlement;

  const agreement = await prisma.agreement.findUnique({ where: { id: dbAgreementId } });

  // Idempotent enqueue: the outbox itself guarantees a pinned-nonce send is
  // never duplicated once submitted, but we still avoid creating a second
  // CONFIRM_SETTLEMENT row on a retried ensureConfirmSettlement call.
  const alreadyEnqueued = await prisma.outbox.findFirst({ where: { agreementId: dbAgreementId, action: "CONFIRM_SETTLEMENT" } });
  if (!alreadyEnqueued) {
    await prisma.$transaction(async (tx) => {
      await outbox.enqueue(tx, {
        agreementId: dbAgreementId,
        action: "CONFIRM_SETTLEMENT",
        payload: { agreementId: agreement.onChainId, settlementRef: settlement.settlementRefHash },
      });
    });
  }
  return settlement; // -> SETTLED once the outbox confirms; see outbox.js's applyConfirmedEffect
}

/** Runs the full sequence for one agreement, in order, each step idempotent. */
async function processOne(dbAgreementId) {
  await ensureHold(dbAgreementId);
  await ensureAction(dbAgreementId);
  return ensureConfirmSettlement(dbAgreementId);
}

async function findCandidates() {
  return prisma.agreement.findMany({
    where: {
      status: "SETTLEMENT_AUTHORIZED",
      onChainId: { not: null },
      OR: [{ settlement: null }, { settlement: { status: { not: "SETTLED" } } }],
    },
  });
}

// In-memory only, mirroring driftDetector.js's own getLastResult() pattern —
// feeds GET /health's "last settlement run" field. Resets on restart, which
// is fine: a restart immediately re-ticks anyway (see startWorker below).
let lastRunAt = null;

async function tick() {
  const candidates = await findCandidates();
  for (const agreement of candidates) {
    const settlement = await prisma.settlement.findUnique({ where: { agreementId: agreement.id } });
    if (settlement && settlement.status === "FAILED") continue; // terminal, surfaced via GET, never auto-retried
    try {
      await processOne(agreement.id);
    } catch (err) {
      console.error(`[Settlement] agreement ${agreement.id} processing error:`, extractErrorMessage(err));
    }
  }
  lastRunAt = new Date().toISOString();
}

function getLastRunAt() {
  return lastRunAt;
}

async function resume() {
  const count = (await findCandidates()).length;
  console.log(`[Settlement] Resuming ${count} incomplete settlement(s) on startup.`);
  await tick();
  return count;
}

function startWorker(options = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let isTicking = false;
  const runTick = async () => {
    if (isTicking) return;
    isTicking = true;
    try {
      await tick();
    } catch (err) {
      console.error("[Settlement] tick error:", err);
    } finally {
      isTicking = false;
    }
  };

  return resume().then(() => {
    const interval = setInterval(runTick, pollIntervalMs);
    return { stop: () => clearInterval(interval) };
  });
}

module.exports = {
  provider,
  deriveKey,
  getOrCreateSettlement,
  ensureHold,
  ensureAction,
  ensureConfirmSettlement,
  processOne,
  findCandidates,
  tick,
  resume,
  startWorker,
  getLastRunAt,
};
