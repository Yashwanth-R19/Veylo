/**
 * routes/outbox.js
 * ──────────────────
 * Read-only view of the outbox (backend/services/outbox.js) for one
 * agreement — the transaction history the "chain panel" screen needs
 * (VEYLO_BUILD_PLAN_REVISED.md Phase 5, Session 1, Part A, screen 8): every
 * chain write with its action, hash, block and confirmation count. This
 * route never writes anything and never calls the chain itself — it only
 * reads what the outbox worker already recorded.
 *
 * New file, additive only. Does not touch backend/services/outbox.js or
 * backend/routes/agreements.js.
 */

const express = require("express");
const router = express.Router();

const prisma = require("../db/prismaClient");

/**
 * GET /outbox/agreement/:id
 */
router.get("/agreement/:id", async (req, res) => {
  try {
    const agreementId = parseInt(req.params.id, 10);
    if (Number.isNaN(agreementId)) {
      return res.status(400).json({ error: "id must be a number" });
    }

    const rows = await prisma.outbox.findMany({
      where: { agreementId },
      orderBy: { id: "asc" },
    });

    res.json(
      rows.map((row) => ({
        id: row.id,
        action: row.action,
        status: row.status,
        attempts: row.attempts,
        txHash: row.txHash,
        blockNumber: row.blockNumber,
        confirmations: row.confirmations,
        lastError: row.lastError,
        createdAt: row.createdAt,
      }))
    );
  } catch (error) {
    console.error("[Outbox] List error:", error);
    res.status(500).json({ error: "Failed to list outbox entries" });
  }
});

module.exports = router;
