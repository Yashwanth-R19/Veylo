/**
 * driftDetector.js
 * ─────────────────
 * Scheduled check comparing every agreement's DB-mirrored status/outcome
 * against the authoritative on-chain record. Feeds GET /health. Never hides a
 * mismatch — an unreachable chain counts as drift-unknown, not drift-zero.
 */

const prisma = require("../db/prismaClient");
const chainService = require("./chainService");

let lastResult = { checked: 0, drifted: 0, driftedIds: [], unreachable: false, lastRunAt: null, error: null };

async function checkDrift() {
  const agreements = await prisma.agreement.findMany({ where: { onChainId: { not: null } } });

  let drifted = [];
  let unreachable = false;
  let error = null;

  for (const agreement of agreements) {
    try {
      const onChain = await chainService.getAgreement(agreement.onChainId);
      const inSync = onChain.status === agreement.status && onChain.outcome === agreement.outcome;
      if (!inSync) {
        drifted.push({
          agreementId: agreement.id,
          onChainId: agreement.onChainId,
          dbStatus: agreement.status,
          chainStatus: onChain.status,
          dbOutcome: agreement.outcome,
          chainOutcome: onChain.outcome,
        });
      }
    } catch (err) {
      unreachable = true;
      error = err.message;
      break; // chain is unreachable — stop rather than report a false drift-zero for the rest
    }
  }

  lastResult = {
    checked: agreements.length,
    drifted: drifted.length,
    driftedIds: drifted,
    unreachable,
    lastRunAt: new Date().toISOString(),
    error,
  };
  return lastResult;
}

function getLastResult() {
  return lastResult;
}

function startScheduledCheck(intervalMs = 30000) {
  checkDrift().catch((err) => console.error("[DriftDetector] initial check failed:", err));
  const interval = setInterval(() => {
    checkDrift().catch((err) => console.error("[DriftDetector] check failed:", err));
  }, intervalMs);
  return { stop: () => clearInterval(interval) };
}

module.exports = { checkDrift, getLastResult, startScheduledCheck };
