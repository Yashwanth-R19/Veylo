/**
 * backend/workers/settlementWorker.js
 * ──────────────────────────────────────
 * Thin process entry point over backend/services/settlement/engine.js, kept
 * separate (per VEYLO_BUILD_PLAN_REVISED.md Phase 4's file list naming
 * backend/workers/ explicitly) so the settlement poller has the same
 * "started once from server.js, resumes everything incomplete on boot"
 * shape as backend/services/outbox.js's startWorker, without the engine
 * module itself needing to know it's being run as a background loop.
 */
const engine = require("../services/settlement/engine");

function start(options) {
  return engine.startWorker(options);
}

module.exports = { start };
