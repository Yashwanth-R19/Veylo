/**
 * server.js
 * ──────────
 * Main entry point for the Veylo backend.
 *
 * Usage:
 *   node server.js
 *   PORT=4000 node server.js
 */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const outbox = require("./backend/services/outbox");
const driftDetector = require("./backend/services/driftDetector");
const chainService = require("./backend/services/chainService");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────
app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:3000"],
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────
app.use("/api/auth", require("./backend/routes/auth"));
app.use("/api/agreements", require("./backend/routes/agreements"));

// ─── Health Check ─────────────────────────────────────────
// Reports genuine per-dependency status, including total on-chain drift.
// Never returns a blanket "ok" for a subsystem that isn't actually working.
app.get("/api/health", async (req, res) => {
  let chainReachable = true;
  let blockNumber = null;
  try {
    blockNumber = await chainService.getCurrentBlock();
  } catch {
    chainReachable = false;
  }

  const drift = driftDetector.getLastResult();

  res.json({
    status: chainReachable ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    services: {
      api: true,
      chain: { reachable: chainReachable, blockNumber, network: "amoy", chainId: 80002 },
    },
    drift: {
      checked: drift.checked,
      driftedCount: drift.drifted,
      driftedAgreementIds: drift.driftedIds,
      unreachableDuringLastCheck: drift.unreachable,
      lastRunAt: drift.lastRunAt,
    },
  });
});

// ─── API Overview ─────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    name: "Veylo",
    version: "0.2.0",
    endpoints: {
      "POST /api/agreements": "Create an agreement (needs clientSig)",
      "POST /api/agreements/:id/accept": "Worker counter-signs",
      "POST /api/agreements/:id/evidence": "Submit repo + commit",
      "POST /api/agreements/:id/decide": "Client decision from NEEDS_REVIEW",
      "POST /api/agreements/:id/dispute": "Raise a dispute",
      "POST /api/agreements/:id/finalize": "Finalize",
      "GET  /api/agreements": "List agreements",
      "GET  /api/agreements/:id": "Get an agreement (DB + on-chain + inSync)",
      "GET  /api/health": "System health check, including chain drift",
    },
  });
});

// ─── Startup ──────────────────────────────────────────────
async function start() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   Veylo — Backend API                         ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // Every incomplete outbox row from a previous run is resumed before the
  // worker starts polling — see backend/services/outbox.js.
  await outbox.startWorker();
  console.log("[Startup] Outbox worker running.");

  driftDetector.startScheduledCheck();
  console.log("[Startup] Drift detector running.");

  app.listen(PORT, () => {
    console.log(`\n[Server] API running at http://localhost:${PORT}`);
    console.log(`[Server] Try: GET http://localhost:${PORT}/api/health\n`);
  });
}

start().catch(console.error);
