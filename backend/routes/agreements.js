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
 */
router.post("/:id/dispute", async (req, res) => {
  try {
    const agreement = await prisma.agreement.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!agreement) return res.status(404).json({ error: "Agreement not found" });
    if (!["VERIFIED", "NEEDS_REVIEW"].includes(agreement.status)) {
      return res.status(409).json({ error: `Cannot dispute from status ${agreement.status}` });
    }

    const { party, reason } = req.body;
    if (!["client", "worker"].includes(party)) return res.status(400).json({ error: "party must be 'client' or 'worker'" });

    const raisedById = party === "client" ? agreement.clientId : agreement.workerId;

    let outboxRow;
    await prisma.$transaction(async (tx) => {
      await tx.dispute.create({ data: { agreementId: agreement.id, raisedById, reason: reason || null, status: "RAISED" } });
      outboxRow = await outbox.enqueue(tx, {
        agreementId: agreement.id,
        action: "RAISE_DISPUTE",
        payload: { agreementId: agreement.onChainId, party, value: chainConfig.arbitrationCost },
      });
    });

    res.json({ outboxRowId: outboxRow.id });
  } catch (error) {
    console.error("[Agreements] Dispute error:", error);
    res.status(500).json({ error: "Failed to raise dispute" });
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
