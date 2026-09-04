// THE CONSISTENCY LAYER (Veylo build plan, Phase 2 §7/§9). Every chain write
// goes through this module. See docs/ARCHITECTURE.md-to-be for the full
// design writeup; the short version:
//
//   1. enqueue() writes an Outbox row inside the SAME Prisma transaction as
//      the caller's business-state change, before any chain call is made.
//   2. The worker polls PENDING/SUBMITTED rows and drives them to CONFIRMED
//      or terminal FAILED.
//   3. Idempotency across crashes is achieved by pinning a deterministic
//      on-chain nonce to a row BEFORE sending, and persisting that pin. If
//      the process dies after sending but before the resulting txHash is
//      recorded, resuming NEVER fetches a fresh nonce — it either resends
//      with the exact same pinned nonce (harmless: the node treats an
//      identical resend as a duplicate/no-op if the first one landed) or, if
//      the account's on-chain nonce has already advanced past the pinned
//      value, reconciles by scanning recent blocks for the transaction that
//      actually consumed it. A row is never resubmitted with a fresh nonce
//      once one has been pinned, and a CONFIRMED row is never touched again.

const prisma = require("../db/prismaClient");
const chainService = require("./chainService");

const DEFAULT_CONFIRMATIONS_REQUIRED = 3;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const BASE_BACKOFF_MS = 4000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const NONCE_RECONCILE_BLOCK_LOOKBACK = 500;

// In-memory only, by design (see prisma/schema.prisma's Outbox model, which
// has no lastAttemptAt/nextAttemptAt field — the plan's §7 field list is
// exact). Backoff resets on process restart, which is acceptable: "on
// process start, resume every incomplete row" already implies immediate
// resumption takes priority over a stale backoff timer.
const backoffUntil = new Map();

function parsePayload(row) {
  return JSON.parse(row.payload);
}

function extractErrorMessage(err) {
  return err.reason || err.shortMessage || err.info?.error?.message || err.message || String(err);
}

/**
 * Writes the intent row. MUST be called with a Prisma transaction client
 * (the `tx` passed into prisma.$transaction(async (tx) => {...})), in the
 * same transaction as the business-state row it accompanies.
 */
async function enqueue(tx, { agreementId, action, payload }) {
  return tx.outbox.create({
    data: {
      agreementId,
      action,
      payload: JSON.stringify(payload),
      status: "PENDING",
    },
  });
}

/** Reserves (persists) a deterministic nonce for a row before ever sending it. */
async function reserveNonce(row, signerAddress) {
  const nonce = await chainService.provider.getTransactionCount(signerAddress, "pending");
  const reservedAtBlock = await chainService.getCurrentBlock();
  const payload = { ...parsePayload(row), _nonce: nonce, _reservedAtBlock: reservedAtBlock, _signer: signerAddress };
  return prisma.outbox.update({
    where: { id: row.id },
    data: { payload: JSON.stringify(payload) },
  });
}

/** Scans recent blocks for the transaction that consumed a given nonce from signerAddress. */
async function findMinedTxByNonce(signerAddress, nonce, fromBlock) {
  const currentBlock = await chainService.getCurrentBlock();
  const startBlock = Math.max(fromBlock, currentBlock - NONCE_RECONCILE_BLOCK_LOOKBACK);
  for (let blockNumber = startBlock; blockNumber <= currentBlock; blockNumber++) {
    const block = await chainService.provider.getBlock(blockNumber, true);
    if (!block) continue;
    const match = block.prefetchedTransactions?.find(
      (t) => t.from?.toLowerCase() === signerAddress.toLowerCase() && t.nonce === nonce
    );
    if (match) return { txHash: match.hash, blockNumber };
  }
  return null;
}

async function processPendingRow(row, { maxAttempts }) {
  const now = Date.now();
  if (backoffUntil.has(row.id) && backoffUntil.get(row.id) > now) return;

  let payload = parsePayload(row);
  const signer = chainService.getSignerForAction(row.action, payload);

  // Reserve a nonce before the first send attempt on this row, and never again.
  if (payload._nonce === undefined) {
    const updated = await reserveNonce(row, signer.address);
    payload = parsePayload(updated);
  }

  const pinnedNonce = payload._nonce;
  const latestNonce = await chainService.provider.getTransactionCount(signer.address, "latest");

  if (latestNonce > pinnedNonce) {
    // Something with this nonce already landed on-chain — reconcile rather
    // than send again (that would use a NEW nonce and double-submit).
    const found = await findMinedTxByNonce(signer.address, pinnedNonce, payload._reservedAtBlock);
    if (found) {
      await prisma.outbox.update({
        where: { id: row.id },
        data: { txHash: found.txHash, blockNumber: found.blockNumber, status: "SUBMITTED", lastError: null },
      });
    } else {
      await prisma.outbox.update({
        where: { id: row.id },
        data: {
          lastError: `nonce ${pinnedNonce} already consumed on-chain but its tx was not found within the last ${NONCE_RECONCILE_BLOCK_LOOKBACK} blocks`,
        },
      });
      backoffUntil.set(row.id, now + BASE_BACKOFF_MS);
    }
    return;
  }

  // Nonce not yet consumed: safe to (re)send with the pinned nonce.
  const submitter = chainService.SUBMITTERS[row.action];
  if (!submitter) throw new Error(`No submitter registered for outbox action: ${row.action}`);

  try {
    const tx = await submitter(payload, { nonce: pinnedNonce });
    await prisma.outbox.update({
      where: { id: row.id },
      data: {
        txHash: tx.hash,
        status: "SUBMITTED",
        attempts: { increment: 1 },
        lastError: null,
      },
    });
    backoffUntil.delete(row.id);
  } catch (err) {
    const message = extractErrorMessage(err);
    const nextAttempts = row.attempts + 1;
    if (nextAttempts >= maxAttempts) {
      await prisma.outbox.update({
        where: { id: row.id },
        data: { status: "FAILED", attempts: nextAttempts, lastError: message },
      });
      backoffUntil.delete(row.id);
    } else {
      await prisma.outbox.update({
        where: { id: row.id },
        data: { attempts: nextAttempts, lastError: message },
      });
      backoffUntil.set(row.id, now + Math.min(BASE_BACKOFF_MS * 2 ** nextAttempts, MAX_BACKOFF_MS));
    }
  }
}

async function processSubmittedRow(row, { confirmationsRequired }) {
  if (!row.txHash) return; // reconciliation still pending; handled as a PENDING-style row next tick

  const receipt = await chainService.getReceipt(row.txHash);

  if (!receipt) {
    if (row.confirmations > 0) {
      // Reorg: a receipt we previously saw has disappeared. Reset to PENDING
      // but KEEP the pinned nonce in payload — the next pending pass will
      // either resend with that same nonce or reconcile against whatever the
      // chain now says landed at that nonce, so it never double-submits.
      await prisma.outbox.update({
        where: { id: row.id },
        data: {
          status: "PENDING",
          txHash: null,
          blockNumber: null,
          confirmations: 0,
          lastError: "reorg detected: previously-seen receipt is no longer found",
        },
      });
    }
    return; // otherwise: just not mined yet, keep waiting
  }

  if (receipt.status === 0) {
    await prisma.outbox.update({
      where: { id: row.id },
      data: { status: "FAILED", lastError: "transaction reverted on-chain", blockNumber: receipt.blockNumber },
    });
    return;
  }

  const currentBlock = await chainService.getCurrentBlock();
  const confirmations = currentBlock - receipt.blockNumber + 1;
  const reachedThreshold = confirmations >= confirmationsRequired;

  // The row is only marked CONFIRMED once applyConfirmedEffect has actually
  // succeeded — never before. Marking it CONFIRMED first (the original
  // approach) meant a throwing applyConfirmedEffect left the row stuck
  // forever: CONFIRMED rows are never revisited (only PENDING/SUBMITTED are
  // polled), so a real, mined, immutable on-chain transaction's effect could
  // silently never reach the database. Real-tested: a unique-constraint
  // collision on Agreement.onChainId reproduced exactly this — the row sat
  // CONFIRMED with the correct txHash/confirmations while onChainId stayed
  // null indefinitely. Keeping the row at SUBMITTED (with the error visible
  // in lastError) means the next tick retries applyConfirmedEffect against
  // the same already-fetched receipt until it succeeds or the underlying
  // cause is fixed — safe to retry because it only re-derives DB state from
  // an immutable receipt, never resubmits a transaction.
  if (reachedThreshold) {
    try {
      await applyConfirmedEffect(row, receipt);
      await prisma.outbox.update({
        where: { id: row.id },
        data: { blockNumber: receipt.blockNumber, confirmations, status: "CONFIRMED", lastError: null },
      });
    } catch (err) {
      await prisma.outbox.update({
        where: { id: row.id },
        data: { blockNumber: receipt.blockNumber, confirmations, lastError: `applyConfirmedEffect failed: ${extractErrorMessage(err)}` },
      });
    }
  } else {
    await prisma.outbox.update({
      where: { id: row.id },
      data: { blockNumber: receipt.blockNumber, confirmations, status: "SUBMITTED" },
    });
  }
}

/**
 * Reconciles the DB's business-state row with what the just-confirmed chain
 * write actually did. This is what keeps the DB mirror up to date without
 * requiring every reader to hit the chain — GET /agreements/:id (Part G)
 * still independently reads the chain and reports drift on top of this, so a
 * bug here is caught, not hidden.
 */
async function applyConfirmedEffect(row, receipt) {
  const payload = parsePayload(row);
  const contract = chainService.agreementsContract();
  const parseLog = (l) => {
    try {
      return contract.interface.parseLog(l);
    } catch {
      return null;
    }
  };
  const events = receipt.logs.map(parseLog).filter(Boolean);

  switch (row.action) {
    case "CREATE_AGREEMENT": {
      const event = events.find((e) => e.name === "AgreementCreated");
      if (!event) throw new Error("CREATE_AGREEMENT confirmed but no AgreementCreated event found in receipt");
      await prisma.agreement.update({
        where: { id: row.agreementId },
        data: { onChainId: Number(event.args.agreementId) },
      });
      break;
    }
    case "ACCEPT_CRITERIA":
      await prisma.agreement.update({ where: { id: row.agreementId }, data: { status: "COMMITTED" } });
      break;
    case "SUBMIT_EVIDENCE":
      await prisma.agreement.update({ where: { id: row.agreementId }, data: { status: "SUBMITTED" } });
      break;
    case "RECORD_VERIFICATION": {
      const nextStatus = payload.outcome === "NONE" ? "NEEDS_REVIEW" : "VERIFIED";
      // reviewWindowEnds is set on-chain by this same call; read it back so
      // the DB-side guard in POST /agreements/:id/finalize can enforce the
      // window without a chain round trip on every request.
      const onChain = await chainService.getAgreement(payload.agreementId);
      await prisma.agreement.update({
        where: { id: row.agreementId },
        data: { status: nextStatus, outcome: payload.outcome, reviewWindowEnds: new Date(onChain.reviewWindowEnds * 1000) },
      });
      break;
    }
    case "CLIENT_DECISION":
      await prisma.agreement.update({
        where: { id: row.agreementId },
        data: { status: "VERIFIED", outcome: payload.outcome },
      });
      break;
    case "RAISE_DISPUTE": {
      const event = events.find((e) => e.name === "DisputeRaised");
      await prisma.agreement.update({ where: { id: row.agreementId }, data: { status: "DISPUTED" } });
      if (event) {
        await prisma.dispute.updateMany({
          where: { agreementId: row.agreementId, status: "RAISED" },
          data: { externalDisputeId: Number(event.args.disputeId) },
        });
      }
      break;
    }
    case "FINALIZE":
      await prisma.agreement.update({ where: { id: row.agreementId }, data: { status: "SETTLEMENT_AUTHORIZED" } });
      break;
    case "GIVE_RULING": {
      // THE GOVERNING RULE (Phase 4 Session 1, Part 3): the backend never
      // sets the outcome itself on a ruling — it reads status/outcome back
      // from the chain after confirmation, exactly like RECORD_VERIFICATION
      // above.
      const onChain = await chainService.getAgreement(payload.agreementId);
      await prisma.agreement.update({
        where: { id: row.agreementId },
        data: { status: onChain.status, outcome: onChain.outcome },
      });
      await prisma.dispute.updateMany({
        where: { agreementId: row.agreementId, status: "RAISED" },
        data: { ruling: payload.ruling, status: "RULED" },
      });
      break;
    }
    case "CONFIRM_SETTLEMENT":
      await prisma.agreement.update({ where: { id: row.agreementId }, data: { status: "SETTLED" } });
      await prisma.settlement.updateMany({
        where: { agreementId: row.agreementId },
        data: { status: "SETTLED", executedAt: new Date() },
      });
      break;
    default:
      throw new Error(`applyConfirmedEffect: no handler for action ${row.action}`);
  }
}

async function tick(options) {
  const pending = await prisma.outbox.findMany({ where: { status: "PENDING" } });
  for (const row of pending) {
    await processPendingRow(row, options);
  }

  const submitted = await prisma.outbox.findMany({ where: { status: "SUBMITTED" } });
  for (const row of submitted) {
    await processSubmittedRow(row, options);
  }
}

/** Runs one immediate pass over every incomplete row. Call on process start. */
async function resume(options = {}) {
  const opts = {
    confirmationsRequired: options.confirmationsRequired ?? DEFAULT_CONFIRMATIONS_REQUIRED,
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
  };
  const incomplete = await prisma.outbox.findMany({ where: { status: { in: ["PENDING", "SUBMITTED"] } } });
  console.log(`[Outbox] Resuming ${incomplete.length} incomplete row(s) on startup.`);
  await tick(opts);
  return incomplete.length;
}

function startWorker(options = {}) {
  const opts = {
    confirmationsRequired: options.confirmationsRequired ?? DEFAULT_CONFIRMATIONS_REQUIRED,
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  };

  let isTicking = false;
  const runTick = async () => {
    if (isTicking) return;
    isTicking = true;
    try {
      await tick(opts);
    } catch (err) {
      console.error("[Outbox] tick error:", err);
    } finally {
      isTicking = false;
    }
  };

  return resume(opts).then(() => {
    const interval = setInterval(runTick, opts.pollIntervalMs);
    return { stop: () => clearInterval(interval) };
  });
}

module.exports = {
  enqueue,
  resume,
  startWorker,
  tick,
  // exported for tests
  processPendingRow,
  processSubmittedRow,
};
