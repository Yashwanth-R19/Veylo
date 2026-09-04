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
const { formatEther: ethersFormatEther } = require("ethers");

const outbox = require("./backend/services/outbox");
const driftDetector = require("./backend/services/driftDetector");
const chainService = require("./backend/services/chainService");
const settlementWorker = require("./backend/workers/settlementWorker");
const settlementEngine = require("./backend/services/settlement/engine");
const prisma = require("./backend/db/prismaClient");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────
// FRONTEND_URL is the deployed Vercel origin (set in Render's dashboard).
// The Vercel deployment itself proxies /api/* to this backend via a rewrite
// (frontend/vercel.json), so browser requests from the deployed frontend are
// same-origin and never hit this CORS check at all — this list only matters
// for a client calling the API directly (a non-proxied origin, local dev, or
// a tool like curl/Postman during setup).
const allowedOrigins = ["http://localhost:5173", "http://localhost:3000"];
if (process.env.FRONTEND_URL) allowedOrigins.push(process.env.FRONTEND_URL);

app.use(cors({
  origin: allowedOrigins,
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
app.use("/api/criteria", require("./backend/routes/criteria"));
app.use("/api/chain-info", require("./backend/routes/chainInfo"));
app.use("/api/outbox", require("./backend/routes/outbox"));
app.use("/api/verify", require("./backend/routes/verify"));

// ─── Health Check ─────────────────────────────────────────
// Reports genuine per-dependency status: database, E2B, LLM provider, Amoy
// RPC, validator wallet POL balance, outbox backlog, last settlement run,
// drift count (VEYLO_BUILD_PLAN_REVISED.md Phase 5, Session 1, Part C.5).
// Never returns a blanket "ok" for a subsystem that isn't actually working —
// a degraded dependency is reported as such, with the real error, not folded
// into an overall "ok".
const LOW_POL_THRESHOLD = 0.01; // POL — below this, on-chain writes will start failing (see docs/CURRENT_STATE.md's real depletion incident)

app.get("/api/health", async (req, res) => {
  const services = {};
  let degraded = false;

  try {
    await prisma.agreement.count();
    services.database = { reachable: true };
  } catch (err) {
    degraded = true;
    services.database = { reachable: false, error: err.message };
  }

  // E2B/LLM: presence-of-configuration only, not a live call — spinning up a
  // real sandbox or spending a real LLM call on every health check poll
  // would be slow and wasteful. Disclosed, not overstated: this cannot catch
  // an expired/invalid key, only a missing one.
  const e2bConfigured = !!process.env.E2B_API_KEY;
  services.e2b = { configured: e2bConfigured, note: "presence-only check; does not verify the key is valid" };
  if (!e2bConfigured) degraded = true;

  // validator/ai/modelClient.js accepts either the plural, comma-separated
  // *_API_KEYS (preferred, for key rotation) or the singular *_API_KEY.
  const llmProvider = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY) ? "groq"
    : (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY) ? "gemini" : null;
  services.llm = { configured: !!llmProvider, provider: llmProvider, note: "presence-only check; does not verify the key is valid" };
  if (!llmProvider) degraded = true;

  let chainReachable = true;
  let blockNumber = null;
  try {
    blockNumber = await chainService.getCurrentBlock();
  } catch (err) {
    chainReachable = false;
    degraded = true;
    services.chainError = err.message;
  }
  services.chain = { reachable: chainReachable, blockNumber, network: "amoy", chainId: 80002 };

  let validatorPol = null;
  let validatorPolLow = false;
  if (chainReachable) {
    try {
      const balance = await chainService.provider.getBalance(chainService.operatorWallet.address);
      validatorPol = ethersFormatEther(balance);
      validatorPolLow = Number(validatorPol) < LOW_POL_THRESHOLD;
      if (validatorPolLow) degraded = true;
    } catch (err) {
      degraded = true;
      services.validatorWalletError = err.message;
    }
  }
  services.validatorWallet = { address: chainService.operatorWallet.address, balancePOL: validatorPol, low: validatorPolLow, threshold: LOW_POL_THRESHOLD };

  let outboxBacklog = null;
  try {
    outboxBacklog = await prisma.outbox.count({ where: { status: { in: ["PENDING", "SUBMITTED"] } } });
  } catch (err) {
    degraded = true;
    services.outboxError = err.message;
  }
  services.outbox = { backlog: outboxBacklog };

  services.settlement = { lastRunAt: settlementEngine.getLastRunAt() };

  const drift = driftDetector.getLastResult();
  if (drift.unreachable || drift.drifted > 0) degraded = true;

  res.json({
    status: degraded ? "degraded" : "ok",
    timestamp: new Date().toISOString(),
    services,
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
      "POST /api/agreements/:id/verify": "Run deterministic + advisory verification, enqueue recordVerification",
      "POST /api/agreements/:id/decide": "Client decision from NEEDS_REVIEW",
      "POST /api/agreements/:id/dispute": "Raise a dispute (reason off-chain, hash on-chain)",
      "GET  /api/agreements/:id/dispute": "Dispute status, dispute id, arbitrator address, ruling",
      "POST /api/agreements/:id/rule": "Operator gives a ruling as arbitrator (see README's Arbitration section)",
      "POST /api/agreements/:id/finalize": "Finalize",
      "GET  /api/agreements/:id/settlement": "Settlement status (SIMULATED provider — no real money moves)",
      "GET  /api/agreements": "List agreements",
      "GET  /api/agreements/:id": "Get an agreement (DB + on-chain + inSync)",
      "POST /api/criteria/draft": "AI-assisted criteria draft from a plain-language description",
      "GET  /api/chain-info": "Deployed contract addresses, chain id, explorer base",
      "GET  /api/outbox/agreement/:id": "Outbox transaction history for an agreement",
      "GET  /api/verify/:id": "Independent-verification bundle (criteria, evidence, results, signatures)",
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

  // Every SETTLEMENT_AUTHORIZED agreement without a SETTLED Settlement row
  // is resumed the same way — see backend/services/settlement/engine.js.
  await settlementWorker.start();
  console.log("[Startup] Settlement worker running.");

  driftDetector.startScheduledCheck();
  console.log("[Startup] Drift detector running.");

  app.listen(PORT, () => {
    console.log(`\n[Server] API running at http://localhost:${PORT}`);
    console.log(`[Server] Try: GET http://localhost:${PORT}/api/health\n`);
  });
}

start().catch(console.error);
