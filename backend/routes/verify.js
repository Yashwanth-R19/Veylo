/**
 * routes/verify.js
 * ──────────────────
 * Read-only bundle endpoint for independent verification
 * (VEYLO_BUILD_PLAN_REVISED.md Phase 5, Session 1, Part B: tools/verify.js).
 * Returns exactly the documents a standalone verifier needs to recompute
 * criteriaHash and deterministicHash itself and check them against what the
 * chain recorded: the criteria document, the evidence commitment, the
 * results document (if verification has run), and both party signatures.
 *
 * This route computes nothing and trusts nothing on the caller's behalf —
 * it is a plain read of what's already stored. tools/verify.js reimplements
 * the hashing and signature checks independently rather than trusting this
 * response's correctness.
 *
 * New file, additive only. Does not touch backend/routes/agreements.js.
 */

const express = require("express");
const router = express.Router();

const prisma = require("../db/prismaClient");

/**
 * GET /verify/:id
 */
router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "id must be a number" });
    }

    const agreement = await prisma.agreement.findUnique({
      where: { id },
      include: {
        client: true,
        worker: true,
        evidence: { orderBy: { submittedAt: "desc" }, take: 1 },
        verifications: { orderBy: { id: "desc" }, take: 1 },
        // Independently verifying a signature requires the exact struct
        // that was signed, including the nonce — which is consumed on-chain
        // (replay protection) and not stored on the Agreement row itself.
        // The outbox payload is the only place it still exists.
        outboxEntries: { where: { action: { in: ["CREATE_AGREEMENT", "ACCEPT_CRITERIA"] } }, orderBy: { id: "asc" } },
      },
    });
    if (!agreement) return res.status(404).json({ error: "Agreement not found" });

    const evidence = agreement.evidence[0] || null;
    const verification = agreement.verifications[0] || null;

    const createEntry = agreement.outboxEntries.find((e) => e.action === "CREATE_AGREEMENT");
    const acceptEntry = agreement.outboxEntries.find((e) => e.action === "ACCEPT_CRITERIA");
    const clientNonce = createEntry ? JSON.parse(createEntry.payload).nonce : null;
    const workerNonce = acceptEntry ? JSON.parse(acceptEntry.payload).nonce : null;

    res.json({
      agreementId: agreement.id,
      onChainId: agreement.onChainId,
      criteriaDocument: JSON.parse(agreement.criteriaJson),
      criteriaHash: agreement.criteriaHash,
      amountMinor: agreement.amountMinor.toString(),
      deadline: Math.floor(agreement.deadline.getTime() / 1000),
      client: { address: agreement.client.walletAddress, signature: agreement.clientSignature, nonce: clientNonce },
      worker: { address: agreement.worker.walletAddress, signature: agreement.workerSignature, nonce: workerNonce },
      evidence: evidence
        ? { repoUrl: evidence.repoUrl, commitHash: evidence.commitHash, evidenceHash: evidence.evidenceHash }
        : null,
      resultsDocument: verification && verification.resultsJson ? JSON.parse(verification.resultsJson) : null,
      resultsHash: verification ? verification.resultsHash : null,
      deterministicHash: verification ? verification.deterministicHash : null,
    });
  } catch (error) {
    console.error("[Verify] Bundle error:", error);
    res.status(500).json({ error: "Failed to build verification bundle" });
  }
});

module.exports = router;
