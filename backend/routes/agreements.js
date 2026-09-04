/**
 * routes/agreements.js
 * ─────────────────────
 * The Veylo agreement lifecycle. Every write here first checks the DB-mirrored
 * state machine and rejects disallowed transitions BEFORE any chain call is
 * made; every state-changing call then goes through the outbox
 * (backend/services/outbox.js) rather than touching chainService directly.
 */

const express = require("express");
const router = express.Router();

const prisma = require("../db/prismaClient");
const canonical = require("../lib/canonical");
const eip712 = require("../lib/eip712");
const chainService = require("../services/chainService");
const outbox = require("../services/outbox");
const chainConfig = require("../../config/chain.json");
const { runEngine } = require("../../validator/core/engine");
const { runAdvisory } = require("../../validator/advisory/AdvisoryValidator");
const { assembleResults } = require("../../validator/core/resultsDocument");
const settlementEngine = require("../services/settlement/engine");

function serializeAgreement(agreement) {
  return {
    ...agreement,
    amountMinor: agreement.amountMinor.toString(),
    criteriaJson: JSON.parse(agreement.criteriaJson),
  };
}

async function findOrCreateUserByWallet(walletAddress) {
  const existing = await prisma.user.findUnique({ where: { walletAddress } });
  if (existing) return existing;
  return prisma.user.create({
    data: { email: `${walletAddress.toLowerCase()}@wallet.veylo.local`, walletAddress },
  });
}

/**
 * POST /agreements
 * Body: { workerAddress, amountMinor, currency, criteria, deadline, nonce, clientSig }
 * The client's identity is the recovered EIP-712 signer, never a client-supplied field.
 */
router.post("/", async (req, res) => {
  try {
    const { workerAddress, amountMinor, currency, criteria, deadline, nonce, clientSig } = req.body;

    if (!workerAddress || amountMinor === undefined || !currency || !Array.isArray(criteria) || !deadline || nonce === undefined || !clientSig) {
      return res.status(400).json({ error: "workerAddress, amountMinor, currency, criteria, deadline, nonce and clientSig are required" });
    }

    const criteriaDoc = { version: 1, criteria };
    const criteriaHash = canonical.hashCanonical(criteriaDoc);

    const commitmentValue = { worker: workerAddress, amountMinor: BigInt(amountMinor), criteriaHash, deadline, nonce: BigInt(nonce) };
    let clientAddress;
    try {
      clientAddress = eip712.recoverCriteriaCommitmentSigner(commitmentValue, clientSig);
    } catch (err) {
      return res.status(400).json({ error: "Could not recover a signer from clientSig", details: err.message });
    }

    if (clientAddress.toLowerCase() === workerAddress.toLowerCase()) {
      return res.status(400).json({ error: "worker cannot be the client" });
    }
    if (deadline <= Math.floor(Date.now() / 1000)) {
      return res.status(400).json({ error: "deadline must be in the future" });
    }

    const client = await findOrCreateUserByWallet(clientAddress);
    const worker = await findOrCreateUserByWallet(workerAddress);

    let agreement, outboxRow;
    await prisma.$transaction(async (tx) => {
      agreement = await tx.agreement.create({
        data: {
          clientId: client.id,
          workerId: worker.id,
          amountMinor: BigInt(amountMinor),
          currency,
          criteriaHash,
          criteriaJson: JSON.stringify(criteriaDoc),
          clientSignature: clientSig,
          deadline: new Date(deadline * 1000),
          status: "DRAFT",
        },
      });

      await tx.criterion.createMany({
        data: criteria.map((c) => ({
          agreementId: agreement.id,
          index: c.index,
          method: c.method,
          text: c.text,
          checkSpec: c.check ? JSON.stringify(c.check) : null,
        })),
      });

      outboxRow = await outbox.enqueue(tx, {
        agreementId: agreement.id,
        action: "CREATE_AGREEMENT",
        payload: { worker: workerAddress, amountMinor: String(amountMinor), criteriaHash, deadline, nonce: String(nonce), clientSig },
      });
    });

    res.status(201).json({ agreement: serializeAgreement(agreement), outboxRowId: outboxRow.id });
  } catch (error) {
    console.error("[Agreements] Create error:", error);
    res.status(500).json({ error: "Failed to create agreement" });
  }
});

/**
 * POST /agreements/:id/accept
 * Body: { nonce, workerSig }
 */
router.post("/:id/accept", async (req, res) => {
  try {
    const agreement = await prisma.agreement.findUnique({ where: { id: parseInt(req.params.id) }, include: { worker: true } });
    if (!agreement) return res.status(404).json({ error: "Agreement not found" });
    if (agreement.status !== "DRAFT") {
      return res.status(409).json({ error: `Cannot accept from status ${agreement.status}` });
    }
    if (agreement.onChainId === null) {
      return res.status(409).json({ error: "Agreement is not yet confirmed on-chain" });
    }

    const { nonce, workerSig } = req.body;
    if (nonce === undefined || !workerSig) return res.status(400).json({ error: "nonce and workerSig are required" });

    const acceptanceValue = { agreementId: BigInt(agreement.onChainId), criteriaHash: agreement.criteriaHash, nonce: BigInt(nonce) };
    const ok = eip712.verifyCriteriaAcceptance(acceptanceValue, workerSig, agreement.worker.walletAddress);
    if (!ok) return res.status(400).json({ error: "workerSig does not match the agreement's worker" });

    let outboxRow;
    await prisma.$transaction(async (tx) => {
      await tx.agreement.update({ where: { id: agreement.id }, data: { workerSignature: workerSig } });
      outboxRow = await outbox.enqueue(tx, {
        agreementId: agreement.id,
        action: "ACCEPT_CRITERIA",
        payload: { agreementId: agreement.onChainId, nonce: String(nonce), workerSig },
      });
    });

    res.json({ outboxRowId: outboxRow.id });
  } catch (error) {
    console.error("[Agreements] Accept error:", error);
    res.status(500).json({ error: "Failed to accept criteria" });
  }
});

/**
 * POST /agreements/:id/evidence
 * Body: { repoUrl, commitHash }
 */
router.post("/:id/evidence", async (req, res) => {
  try {
    const agreement = await prisma.agreement.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!agreement) return res.status(404).json({ error: "Agreement not found" });
    if (agreement.status !== "COMMITTED") {
      return res.status(409).json({ error: `Cannot submit evidence from status ${agreement.status}` });
    }

    const { repoUrl, commitHash } = req.body;
    if (!repoUrl || !commitHash) return res.status(400).json({ error: "repoUrl and commitHash are required" });

    const evidenceHash = canonical.hashCanonical({ repoUrl, commitHash });

    let outboxRow;
    await prisma.$transaction(async (tx) => {
      await tx.evidence.create({ data: { agreementId: agreement.id, repoUrl, commitHash, evidenceHash } });
      outboxRow = await outbox.enqueue(tx, {
        agreementId: agreement.id,
        action: "SUBMIT_EVIDENCE",
        payload: { agreementId: agreement.onChainId, evidenceHash },
      });
    });

    res.json({ outboxRowId: outboxRow.id, evidenceHash });
  } catch (error) {
    console.error("[Agreements] Evidence error:", error);
    res.status(500).json({ error: "Failed to submit evidence" });
  }
});

/**
 * POST /agreements/:id/verify
 * Runs the deterministic engine and the advisory (AI) layer, assembles the
 * §6 results document, and enqueues RECORD_VERIFICATION with the computed
 * outcome. The chain-write side of this (chainService.submitRecordVerification,
 * outbox.js's RECORD_VERIFICATION submitter and applyConfirmedEffect case)
 * was already built in Phase 2 — this route is what finally produces the
 * payload those expect.
 *
 * THE ARCHITECTURAL RULE THIS ROUTE MUST NOT BREAK: the outcome enqueued
 * here comes from validator/core/resultsDocument.js's computeFinalOutcome(),
 * which can only route a SEMANTIC/advisory result to NONE (NEEDS_REVIEW) —
 * never ACCEPT or REJECT on its own. This route does not compute an
 * alternative outcome anywhere else; it takes computeFinalOutcome()'s return
 * value as-is.
 */
router.post("/:id/verify", async (req, res) => {
  try {
    const agreement = await prisma.agreement.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { criteria: true, evidence: { orderBy: { submittedAt: "desc" }, take: 1 } },
    });
    if (!agreement) return res.status(404).json({ error: "Agreement not found" });
    if (agreement.status !== "SUBMITTED") {
      return res.status(409).json({ error: `Cannot verify from status ${agreement.status}` });
    }
    if (agreement.onChainId === null) {
      return res.status(409).json({ error: "Agreement is not yet confirmed on-chain" });
    }
    const evidence = agreement.evidence[0];
    if (!evidence) return res.status(409).json({ error: "No evidence submitted for this agreement" });

    const spec = {
      repoUrl: evidence.repoUrl,
      commitHash: evidence.commitHash,
      criteria: agreement.criteria
        .sort((a, b) => a.index - b.index)
        .map((c) => ({ index: c.index, method: c.method, text: c.text, check: c.checkSpec ? JSON.parse(c.checkSpec) : undefined })),
    };
    const ctx = { agreementId: agreement.id, logger: console };

    let deterministicOut, advisoryOut;
    try {
      [deterministicOut, advisoryOut] = await Promise.all([runEngine(spec, ctx), runAdvisory(spec, ctx)]);
    } catch (err) {
      await prisma.verification.create({
        data: { agreementId: agreement.id, startedAt: new Date(), finishedAt: new Date(), error: err.message },
      });
      console.error("[Agreements] Verify error:", err);
      return res.status(502).json({ error: "Verification run failed", details: err.message });
    }

    const { document, resultsHash, deterministicHash, outcome } = assembleResults({
      agreementId: agreement.onChainId,
      criteriaHash: agreement.criteriaHash,
      evidenceHash: evidence.evidenceHash,
      deterministic: deterministicOut.deterministic,
      deterministicHash: deterministicOut.deterministicHash,
      advisory: advisoryOut.advisory,
    });

    let outboxRow;
    await prisma.$transaction(async (tx) => {
      await tx.verification.create({
        data: {
          agreementId: agreement.id,
          resultsHash,
          deterministicHash,
          resultsJson: JSON.stringify(document),
          outcome,
          engineVersion: deterministicOut.deterministic.engineVersion,
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      });
      outboxRow = await outbox.enqueue(tx, {
        agreementId: agreement.id,
        action: "RECORD_VERIFICATION",
        payload: { agreementId: agreement.onChainId, resultsHash, outcome },
      });
    });

    res.json({ outboxRowId: outboxRow.id, resultsHash, deterministicHash, outcome, results: document, advisoryStats: advisoryOut.stats });
  } catch (error) {
    console.error("[Agreements] Verify error:", error);
    res.status(500).json({ error: "Failed to run verification" });
  }
});

/**
 * POST /agreements/:id/decide
 * Body: { outcome: "ACCEPT" | "REJECT" }
 */
router.post("/:id/decide", async (req, res) => {
  try {
    const agreement = await prisma.agreement.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!agreement) return res.status(404).json({ error: "Agreement not found" });
    if (agreement.status !== "NEEDS_REVIEW") {
      return res.status(409).json({ error: `Cannot decide from status ${agreement.status}` });
    }

    const { outcome } = req.body;
    if (!["ACCEPT", "REJECT"].includes(outcome)) return res.status(400).json({ error: "outcome must be ACCEPT or REJECT" });

    let outboxRow;
    await prisma.$transaction(async (tx) => {
      outboxRow = await outbox.enqueue(tx, {
        agreementId: agreement.id,
        action: "CLIENT_DECISION",
        payload: { agreementId: agreement.onChainId, outcome },
      });
    });

    res.json({ outboxRowId: outboxRow.id });
  } catch (error) {
    console.error("[Agreements] Decide error:", error);
    res.status(500).json({ error: "Failed to record client decision" });
  }
});

/**
 * POST /agreements/:id/dispute
 * Body: { party: "client" | "worker", reason }
 * The reason text is stored off-chain only (this row's `reason` column);
 * only its hash is committed on-chain (Agreement.disputeReasonHash).
 */
router.post("/:id/dispute", async (req, res) => {
  try {
    const agreement = await prisma.agreement.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!agreement) return res.status(404).json({ error: "Agreement not found" });
    if (!["VERIFIED", "NEEDS_REVIEW"].includes(agreement.status)) {
      return res.status(409).json({ error: `Cannot dispute from status ${agreement.status}` });
    }
    if (agreement.onChainId === null) {
      return res.status(409).json({ error: "Agreement is not yet confirmed on-chain" });
    }

    const { party, reason } = req.body;
    if (!["client", "worker"].includes(party)) return res.status(400).json({ error: "party must be 'client' or 'worker'" });

    const raisedById = party === "client" ? agreement.clientId : agreement.workerId;
    const reasonHash = canonical.hashCanonical({ reason: reason || "" });

    let outboxRow;
    await prisma.$transaction(async (tx) => {
      await tx.dispute.create({
        data: { agreementId: agreement.id, raisedById, reason: reason || null, reasonHash, status: "RAISED" },
      });
      outboxRow = await outbox.enqueue(tx, {
        agreementId: agreement.id,
        action: "RAISE_DISPUTE",
        payload: { agreementId: agreement.onChainId, party, reasonHash, value: chainConfig.arbitrationCost },
      });
    });

    res.json({ outboxRowId: outboxRow.id, reasonHash });
  } catch (error) {
    console.error("[Agreements] Dispute error:", error);
    res.status(500).json({ error: "Failed to raise dispute" });
  }
});

/**
 * GET /agreements/:id/dispute
 * Status, dispute id, arbitrator address, ruling. The ruling is read live
 * from the CentralizedArbitrator contract, never taken from the DB alone.
 */
router.get("/:id/dispute", async (req, res) => {
  try {
    const agreement = await prisma.agreement.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!agreement) return res.status(404).json({ error: "Agreement not found" });

    const dispute = await prisma.dispute.findFirst({ where: { agreementId: agreement.id }, orderBy: { id: "desc" } });
    const arbitratorAddress = chainConfig.contracts.CentralizedArbitrator.address;
    if (!dispute) return res.json({ dispute: null, arbitratorAddress });

    let onChain = null;
    let chainError = null;
    if (dispute.externalDisputeId !== null) {
      try {
        const arb = chainService.arbitratorContract();
        const [ruling, status] = await Promise.all([
          arb.currentRuling(dispute.externalDisputeId),
          arb.disputeStatus(dispute.externalDisputeId),
        ]);
        onChain = {
          ruling: Number(ruling),
          disputeStatus: ["Waiting", "Appealable", "Solved"][Number(status)],
        };
      } catch (err) {
        chainError = err.message;
      }
    }

    res.json({
      dispute: {
        id: dispute.id,
        reason: dispute.reason,
        reasonHash: dispute.reasonHash,
        status: dispute.status,
        externalDisputeId: dispute.externalDisputeId,
        ruling: dispute.ruling,
        createdAt: dispute.createdAt,
      },
      arbitratorAddress,
      onChain,
      chainError,
    });
  } catch (error) {
    console.error("[Agreements] Get dispute error:", error);
    res.status(500).json({ error: "Failed to fetch dispute" });
  }
});

/**
 * POST /agreements/:id/rule
 * Body: { ruling: 0 | 1 | 2 }  (0 = refused, 1 = ACCEPT, 2 = REJECT)
 *
 * THE OPERATOR INTERFACE FOR GIVING RULINGS. This calls
 * CentralizedArbitrator.giveRuling() as its owner, i.e. the Veylo operator
 * IS the arbitrator here. This is Kleros's own documented pattern for
 * testing an arbitrable app (deploy CentralizedArbitrator, rule directly) —
 * it is NOT an independent/neutral arbitrator. See README.md's "Arbitration"
 * section, which states this explicitly. Production would point at Kleros
 * Court instead.
 */
router.post("/:id/rule", async (req, res) => {
  try {
    const agreement = await prisma.agreement.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!agreement) return res.status(404).json({ error: "Agreement not found" });
    if (agreement.status !== "DISPUTED") {
      return res.status(409).json({ error: `Cannot rule from status ${agreement.status}` });
    }

    const { ruling } = req.body;
    if (![0, 1, 2].includes(ruling)) return res.status(400).json({ error: "ruling must be 0, 1 or 2" });

    const dispute = await prisma.dispute.findFirst({ where: { agreementId: agreement.id, status: "RAISED" }, orderBy: { id: "desc" } });
    if (!dispute) return res.status(409).json({ error: "No RAISED dispute found for this agreement" });
    if (dispute.externalDisputeId === null) {
      return res.status(409).json({ error: "Dispute is not yet confirmed on-chain" });
    }

    let outboxRow;
    await prisma.$transaction(async (tx) => {
      outboxRow = await outbox.enqueue(tx, {
        agreementId: agreement.id,
        action: "GIVE_RULING",
        payload: { agreementId: agreement.onChainId, disputeId: dispute.externalDisputeId, ruling },
      });
    });

    res.json({ outboxRowId: outboxRow.id, note: "Ruling given by the Veylo operator acting as arbitrator (Kleros CentralizedArbitrator testing pattern) — not an independent arbitrator. See README.md." });
  } catch (error) {
    console.error("[Agreements] Rule error:", error);
    res.status(500).json({ error: "Failed to submit ruling" });
  }
});

/**
 * POST /agreements/:id/finalize
 */
router.post("/:id/finalize", async (req, res) => {
  try {
    const agreement = await prisma.agreement.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!agreement) return res.status(404).json({ error: "Agreement not found" });
    if (!["VERIFIED", "RULED"].includes(agreement.status)) {
      return res.status(409).json({ error: `Cannot finalize from status ${agreement.status}` });
    }
    if (agreement.status === "VERIFIED" && agreement.reviewWindowEnds && agreement.reviewWindowEnds.getTime() > Date.now()) {
      return res.status(409).json({ error: "Review window has not ended yet" });
    }

    let outboxRow;
    await prisma.$transaction(async (tx) => {
      outboxRow = await outbox.enqueue(tx, {
        agreementId: agreement.id,
        action: "FINALIZE",
        payload: { agreementId: agreement.onChainId },
      });
    });

    res.json({ outboxRowId: outboxRow.id });
  } catch (error) {
    console.error("[Agreements] Finalize error:", error);
    res.status(500).json({ error: "Failed to finalize" });
  }
});

/**
 * GET /agreements/:id/settlement
 * Chain outcome, provider reference, reconciliation status, attempt count
 * and any error. PART F: SimulatedProvider only this session — no real
 * money moves, and every response says so explicitly.
 */
router.get("/:id/settlement", async (req, res) => {
  try {
    const agreement = await prisma.agreement.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!agreement) return res.status(404).json({ error: "Agreement not found" });

    const settlement = await prisma.settlement.findUnique({ where: { agreementId: agreement.id } });
    if (!settlement) {
      return res.json({ simulated: true, provider: "SimulatedProvider", settlement: null });
    }

    let onChain = null;
    let chainError = null;
    if (agreement.onChainId !== null) {
      try {
        onChain = await chainService.getAgreement(agreement.onChainId);
      } catch (err) {
        chainError = err.message;
      }
    }

    let providerStatus = null;
    const refToCheck = settlement.providerRef || settlement.holdRef;
    if (refToCheck) {
      try {
        providerStatus = await settlementEngine.provider.getStatus(refToCheck);
      } catch (err) {
        providerStatus = `error: ${err.message}`;
      }
    }

    let reconciliationStatus = "PENDING";
    if (settlement.status === "SETTLED" && onChain) {
      const matches = onChain.status === "SETTLED" && onChain.settlementRef === settlement.settlementRefHash;
      reconciliationStatus = matches ? "RECONCILED" : "MISMATCH";
    } else if (settlement.status === "FAILED") {
      reconciliationStatus = "FAILED";
    }

    res.json({
      simulated: true,
      provider: "SimulatedProvider",
      settlement: {
        decision: settlement.decision,
        status: settlement.status,
        attempts: settlement.attempts,
        lastError: settlement.lastError,
        holdRef: settlement.holdRef,
        providerRef: settlement.providerRef,
        settlementRefHash: settlement.settlementRefHash,
        intentRecordedAt: settlement.intentRecordedAt,
        executedAt: settlement.executedAt,
      },
      onChain: onChain ? { status: onChain.status, outcome: onChain.outcome, settlementRef: onChain.settlementRef } : null,
      providerStatus,
      reconciliationStatus,
      chainError,
    });
  } catch (error) {
    console.error("[Agreements] Get settlement error:", error);
    res.status(500).json({ error: "Failed to fetch settlement" });
  }
});

/**
 * GET /agreements
 */
router.get("/", async (req, res) => {
  try {
    const agreements = await prisma.agreement.findMany({ orderBy: { id: "desc" } });
    res.json(agreements.map(serializeAgreement));
  } catch (error) {
    console.error("[Agreements] List error:", error);
    res.status(500).json({ error: "Failed to list agreements" });
  }
});

/**
 * GET /agreements/:id
 * Returns the DB record, the on-chain record, and inSync. Never hides a mismatch.
 */
router.get("/:id", async (req, res) => {
  try {
    const agreement = await prisma.agreement.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!agreement) return res.status(404).json({ error: "Agreement not found" });

    let onChain = null;
    let inSync = false;
    let chainError = null;
    if (agreement.onChainId !== null) {
      try {
        onChain = await chainService.getAgreement(agreement.onChainId);
        inSync = onChain.status === agreement.status && onChain.outcome === agreement.outcome;
      } catch (err) {
        chainError = err.message;
      }
    } else {
      chainError = "not yet assigned an on-chain id";
    }

    res.json({ database: serializeAgreement(agreement), onChain, inSync, chainError });
  } catch (error) {
    console.error("[Agreements] Get error:", error);
    res.status(500).json({ error: "Failed to fetch agreement" });
  }
});

module.exports = router;
