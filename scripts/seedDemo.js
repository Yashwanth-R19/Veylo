#!/usr/bin/env node
/**
 * scripts/seedDemo.js
 * ─────────────────────
 * Populates a running Veylo instance with a small set of real, presentable
 * demo agreements — for a stranger landing on the deployed URL, and for
 * README screenshots. Drives the live HTTP server exactly as a real client/
 * worker would: real EIP-712 signatures, real outbox-relayed transactions
 * on Amoy, real verification runs. Nothing here fabricates a result — every
 * agreement's final state is whatever the real chain/engine actually
 * produces, not a hardcoded outcome.
 *
 * NOT RUN AS PART OF THIS SESSION'S WORK: the validator wallet's Amoy POL
 * balance was ~0.0025 POL at the time this script was written, too low to
 * afford even one createAgreement relay (see docs/EVALUATION.md's "the one
 * number that is genuinely bad"). This script is written and reasoned
 * through against the real backend/routes/agreements.js and
 * backend/lib/eip712.js contracts, but has not itself been executed end to
 * end. Run it once the validator wallet has been topped up from the Amoy
 * faucet, and treat the first run as a real test, not an assumed-working
 * script.
 *
 * Usage:
 *   node scripts/seedDemo.js [--base-url http://localhost:3000]
 *
 * Requires in .env: TEST_CLIENT_PRIVATE_KEY, TEST_WORKER_PRIVATE_KEY
 * (the same testnet-only wallets Phase 2+ used — see docs/CURRENT_STATE.md).
 */

require("dotenv").config();
const { ethers } = require("ethers");
const chainConfig = require("../config/chain.json");

const BASE_URL = (() => {
  const idx = process.argv.indexOf("--base-url");
  return idx !== -1 ? process.argv[idx + 1] : "http://localhost:3000";
})();

const DOMAIN = {
  name: "Veylo",
  version: "1",
  chainId: chainConfig.chainId,
  verifyingContract: chainConfig.contracts.VeyloAgreements.address,
};
const CRITERIA_COMMITMENT_TYPES = {
  CriteriaCommitment: [
    { name: "worker", type: "address" },
    { name: "amountMinor", type: "uint256" },
    { name: "criteriaHash", type: "bytes32" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
};
const CRITERIA_ACCEPTANCE_TYPES = {
  CriteriaAcceptance: [
    { name: "agreementId", type: "uint256" },
    { name: "criteriaHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
};

function canonicalize(obj) {
  // Minimal inline canonical-JSON for computing the same criteriaHash the
  // server will compute — mirrors backend/lib/canonical.js's contract
  // (sorted keys, no insignificant whitespace) for this script's own
  // narrow use (a criteria array of plain objects), not a general port.
  if (Array.isArray(obj)) return `[${obj.map(canonicalize).join(",")}]`;
  if (obj && typeof obj === "object") {
    const keys = Object.keys(obj).filter((k) => obj[k] !== null && obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(obj);
}
function hashCanonical(obj) {
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalize(obj)));
}

async function api(path, options = {}) {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function waitFor(agreementId, predicate, label, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { database } = await api(`/agreements/${agreementId}`);
    if (predicate(database)) return database;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function createDemoAgreement({ clientWallet, workerWallet, title, description, amountMinor, criteria, repoUrl, commitHash }) {
  const criteriaDoc = { version: 1, criteria };
  const criteriaHash = hashCanonical(criteriaDoc);
  const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const nonce = Date.now();

  const commitmentValue = { worker: workerWallet.address, amountMinor: BigInt(amountMinor), criteriaHash, deadline, nonce };
  const clientSig = await clientWallet.signTypedData(DOMAIN, CRITERIA_COMMITMENT_TYPES, commitmentValue);

  const { agreement, outboxRowId } = await api("/agreements", {
    method: "POST",
    body: JSON.stringify({ workerAddress: workerWallet.address, amountMinor: String(amountMinor), currency: "USD", criteria, deadline, nonce, clientSig }),
  });
  console.log(`[seed] created agreement id=${agreement.id}, waiting for on-chain confirmation (outbox row ${outboxRowId})...`);
  await waitFor(agreement.id, (a) => a.onChainId !== null, "createAgreement confirmed on-chain");

  // Title/description are DB-only display metadata — never part of criteriaHash
  // or any on-chain commitment, so setting them here doesn't touch anything
  // cryptographic. Done via a direct Prisma write since there's no dedicated
  // PATCH endpoint for it (out of this script's scope to add one).
  const prisma = require("../backend/db/prismaClient");
  await prisma.agreement.update({ where: { id: agreement.id }, data: { title, description } });

  const acceptanceValue = { agreementId: BigInt(agreement.onChainId ?? 0), criteriaHash, nonce: nonce + 1 };
  // agreementId isn't known until after confirmation above; re-read it.
  const confirmed = await api(`/agreements/${agreement.id}`);
  acceptanceValue.agreementId = BigInt(confirmed.database.onChainId);
  const workerSig = await workerWallet.signTypedData(DOMAIN, CRITERIA_ACCEPTANCE_TYPES, acceptanceValue);

  await api(`/agreements/${agreement.id}/accept`, { method: "POST", body: JSON.stringify({ nonce: nonce + 1, workerSig }) });
  console.log(`[seed] worker accepted, waiting for COMMITTED...`);
  await waitFor(agreement.id, (a) => a.status === "COMMITTED", "acceptCriteria confirmed");

  await api(`/agreements/${agreement.id}/evidence`, { method: "POST", body: JSON.stringify({ repoUrl, commitHash }) });
  console.log(`[seed] evidence submitted, waiting for SUBMITTED...`);
  await waitFor(agreement.id, (a) => a.status === "SUBMITTED", "submitEvidence confirmed");

  console.log(`[seed] running verification (deterministic engine + advisory)...`);
  const verifyResult = await api(`/agreements/${agreement.id}/verify`, { method: "POST" });
  console.log(`[seed] verify outcome: ${verifyResult.outcome}, waiting for chain confirmation...`);
  await waitFor(agreement.id, (a) => ["VERIFIED", "NEEDS_REVIEW"].includes(a.status), "recordVerification confirmed");

  console.log(`[seed] agreement ${agreement.id} ready — real outcome: ${verifyResult.outcome}. Leaving in the review window (not finalized) so a visitor can see the full state machine mid-flight.`);
  return agreement.id;
}

async function main() {
  if (!process.env.TEST_CLIENT_PRIVATE_KEY || !process.env.TEST_WORKER_PRIVATE_KEY) {
    console.error("TEST_CLIENT_PRIVATE_KEY and TEST_WORKER_PRIVATE_KEY must be set in .env");
    process.exit(1);
  }
  const clientWallet = new ethers.Wallet(process.env.TEST_CLIENT_PRIVATE_KEY);
  const workerWallet = new ethers.Wallet(process.env.TEST_WORKER_PRIVATE_KEY);

  // A tiny, real, public repository — chosen the same way Phase 0's
  // diagnostic run chose one (see docs/CURRENT_STATE.md): small, real,
  // pure-stdlib, so the deterministic checks below run for real and produce
  // a genuine result rather than a scripted one.
  const REPO = "https://github.com/benjaminp/six";
  const COMMIT = "master";

  const ids = [];

  ids.push(await createDemoAgreement({
    clientWallet, workerWallet,
    title: "Six compatibility shim — packaging fix",
    description: "Contractor to ensure the package ships a valid setup.py and passes its existing test suite unmodified.",
    amountMinor: 50000, // $500.00
    criteria: [
      { index: 0, method: "DETERMINISTIC", text: "setup.py exists in the repository root", check: { kind: "file_exists", path: "setup.py" } },
      { index: 1, method: "DETERMINISTIC", text: "the full test suite passes", check: { kind: "test_suite_passes" } },
    ],
    repoUrl: REPO, commitHash: COMMIT,
  }));

  console.log(`\n[seed] done. Created agreement id(s): ${ids.join(", ")}`);
  console.log(`[seed] visit the frontend and open these agreements to see real, freshly-verified state.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] FAILED:", err);
  process.exit(1);
});
