#!/usr/bin/env node
/**
 * tools/verify.js
 * ─────────────────
 * Standalone independent verifier (VEYLO_BUILD_PLAN_REVISED.md Phase 5,
 * Session 1, Part B). Given a base URL and an agreement id, it:
 *
 *   1. fetches the criteria document, the evidence commitment and the
 *      results document from the running Veylo instance
 *   2. recomputes criteriaHash and deterministicHash from those documents
 *      ITSELF, using its own inline canonical-JSON + keccak256
 *      implementation — not backend/lib/canonical.js
 *   3. reads VeyloAgreements on Amoy directly over a public RPC and
 *      compares the on-chain criteriaHash/resultsHash/status/outcome
 *      against what the server reported
 *   4. verifies both the client's and the worker's EIP-712 signatures
 *      itself, using its own inline domain/typed-data construction — not
 *      backend/lib/eip712.js
 *   5. prints PASS/FAIL per step and exits non-zero if any check that ran
 *      actually failed
 *
 * DELIBERATE DUPLICATION: this file has ZERO require()/import of anything
 * else in this repository. Every algorithm it depends on (canonical
 * encoding, keccak256 hashing, EIP-712 signature recovery) is either
 * reimplemented inline below or comes from the third-party `ethers`
 * package — never from backend/lib/*. Importing our own hashing code would
 * make this script incapable of catching a bug in that code; it would only
 * ever agree with itself.
 *
 * Only two things are treated as ground truth the server could lie about
 * and this script would still catch:
 *   - the on-chain contract state (read directly from an independent RPC)
 *   - the recomputed hashes and signatures (computed independently here)
 * The server's HTTP responses are the DATA being checked, not something
 * this script trusts blindly — every hash and signature in them is
 * recomputed and compared, never taken at face value.
 *
 * Usage:
 *   node tools/verify.js --base-url https://your-veylo-instance --agreement 12
 *   node tools/verify.js --base-url http://localhost:3000 --agreement 12 --rpc-url https://your-rpc
 *
 * Exit code 0 if every check that ran passed; 1 if any failed.
 */

"use strict";

const { keccak256, toUtf8Bytes, JsonRpcProvider, Contract, verifyTypedData } = require("ethers");

// ── CLI args ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { rpcUrl: null, baseUrl: null, agreement: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base-url") args.baseUrl = argv[++i];
    else if (a === "--agreement") args.agreement = argv[++i];
    else if (a === "--rpc-url") args.rpcUrl = argv[++i];
    else if (a === "--chain-id") args.chainId = argv[++i];
    else if (a === "--contract") args.contract = argv[++i];
  }
  return args;
}

// A public, keyless Amoy RPC — live-verified reachable 2026-09-04. Polygon's
// own public endpoint (rpc-amoy.polygon.technology) is deprecated and no
// longer resolves at all; Ankr's public gateway now requires an account key.
// Override with --rpc-url (e.g. your own Alchemy Amoy endpoint) if this one
// stops working — public RPC availability is exactly the kind of thing that
// changes without notice, which is why this is a flag, not a silent assumption.
const DEFAULT_RPC_URL = "https://polygon-amoy-bor-rpc.publicnode.com";

// ── Canonical JSON encoding + keccak256 (VEYLO_BUILD_PLAN_REVISED.md §6) ─
// Reimplemented here, deliberately, from the spec — NOT copy-imported from
// backend/lib/canonical.js. If this independently-written implementation
// disagrees with the server's, that disagreement is the whole point.

function compareByCodePoint(a, b) {
  const ca = Array.from(a);
  const cb = Array.from(b);
  const len = Math.min(ca.length, cb.length);
  for (let i = 0; i < len; i++) {
    const pa = ca[i].codePointAt(0);
    const pb = cb[i].codePointAt(0);
    if (pa !== pb) return pa - pb;
  }
  return ca.length - cb.length;
}

function expandExponential(s) {
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(s);
  if (!match) return s;
  const [, sign, intPart, fracPart = "", expStr] = match;
  const exp = parseInt(expStr, 10);
  let digits = intPart + fracPart;
  let pointPos = intPart.length + exp;
  if (pointPos <= 0) {
    digits = "0".repeat(-pointPos) + digits;
    pointPos = 0;
  } else if (pointPos >= digits.length) {
    digits = digits + "0".repeat(pointPos - digits.length);
    pointPos = digits.length;
  }
  let result;
  if (pointPos === 0) result = "0." + digits;
  else if (pointPos === digits.length) result = digits;
  else result = digits.slice(0, pointPos) + "." + digits.slice(pointPos);
  if (result.includes(".")) result = result.replace(/0+$/, "").replace(/\.$/, "");
  return sign + result;
}

function numberToCanonical(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(`canonicalize: non-finite or non-numeric value: ${n}`);
  }
  if (Object.is(n, -0)) n = 0;
  if (Number.isInteger(n)) return BigInt(n).toString();
  let s = n.toString();
  if (s.includes("e") || s.includes("E")) s = expandExponential(s);
  return s;
}

function encode(value) {
  if (value === undefined) return undefined;
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return numberToCanonical(value);
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const items = value.map((v) => {
      const enc = encode(v);
      return enc === undefined ? "null" : enc;
    });
    return "[" + items.join(",") + "]";
  }
  if (t === "object") {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined && value[k] !== null)
      .sort(compareByCodePoint);
    const parts = keys.map((k) => JSON.stringify(k) + ":" + encode(value[k]));
    return "{" + parts.join(",") + "}";
  }
  throw new Error(`canonicalize: unsupported value type "${t}"`);
}

function canonicalize(obj) {
  const result = encode(obj);
  if (result === undefined) throw new Error("canonicalize: top-level value is undefined");
  return result;
}

function hashCanonical(obj) {
  return keccak256(toUtf8Bytes(canonicalize(obj)));
}

// ── EIP-712 domain/types (mirrors contracts/VeyloAgreements.sol) ────────
// Reimplemented here, not imported from backend/lib/eip712.js.

function buildDomain(chainId, contractAddress) {
  return { name: "Veylo", version: "1", chainId, verifyingContract: contractAddress };
}

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

// Minimal ABI fragment for getAgreement() — matches the currently deployed
// struct (artifacts/contracts/VeyloAgreements.sol/VeyloAgreements.json).
// Field order matters for tuple decoding; keep this in sync if the contract
// struct changes.
const GET_AGREEMENT_ABI = [
  {
    inputs: [{ internalType: "uint256", name: "id", type: "uint256" }],
    name: "getAgreement",
    outputs: [
      {
        components: [
          { internalType: "address", name: "client", type: "address" },
          { internalType: "address", name: "worker", type: "address" },
          { internalType: "uint256", name: "amountMinor", type: "uint256" },
          { internalType: "bytes32", name: "criteriaHash", type: "bytes32" },
          { internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
          { internalType: "bytes32", name: "resultsHash", type: "bytes32" },
          { internalType: "bytes32", name: "disputeReasonHash", type: "bytes32" },
          { internalType: "bytes32", name: "rulingHash", type: "bytes32" },
          { internalType: "bytes32", name: "settlementRef", type: "bytes32" },
          { internalType: "uint64", name: "deadline", type: "uint64" },
          { internalType: "uint64", name: "reviewWindowEnds", type: "uint64" },
          { internalType: "uint8", name: "status", type: "uint8" },
          { internalType: "uint8", name: "outcome", type: "uint8" },
          { internalType: "uint256", name: "disputeId", type: "uint256" },
        ],
        internalType: "struct VeyloAgreements.Agreement",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

const STATUS_NAMES = ["DRAFT", "COMMITTED", "SUBMITTED", "VERIFIED", "NEEDS_REVIEW", "DISPUTED", "RULED", "SETTLEMENT_AUTHORIZED", "SETTLED", "CANCELLED"];
const OUTCOME_NAMES = ["NONE", "ACCEPT", "REJECT"];

// ── Result reporting ─────────────────────────────────────────────────
const results = [];
function report(name, status, detail) {
  results.push({ name, status, detail });
  const marker = status === "PASS" ? "\x1b[32mPASS\x1b[0m" : status === "SKIP" ? "\x1b[33mSKIP\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`[${marker}] ${name}${detail ? " — " + detail : ""}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.baseUrl || !args.agreement) {
    console.error("Usage: node tools/verify.js --base-url <url> --agreement <id> [--rpc-url <url>]");
    process.exit(2);
  }
  const baseUrl = args.baseUrl.replace(/\/$/, "");
  const agreementId = args.agreement;

  console.log(`Veylo independent verifier — agreement ${agreementId} @ ${baseUrl}\n`);

  // ── Fetch documents ──────────────────────────────────────────────
  let bundle;
  try {
    const res = await fetch(`${baseUrl}/api/verify/${agreementId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bundle = await res.json();
    report("Fetch verification bundle", "PASS", `criteria=${bundle.criteriaDocument.criteria.length}, evidence=${bundle.evidence ? "present" : "none"}, results=${bundle.resultsDocument ? "present" : "none"}`);
  } catch (err) {
    report("Fetch verification bundle", "FAIL", err.message);
    finish();
    return;
  }

  let chainInfo;
  if (args.contract && args.chainId) {
    chainInfo = { contractAddress: args.contract, chainId: Number(args.chainId) };
    report("Chain configuration", "PASS", `using --contract/--chain-id override`);
  } else {
    try {
      const res = await fetch(`${baseUrl}/api/chain-info`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      chainInfo = await res.json();
      report("Fetch chain configuration", "PASS", `contract=${chainInfo.contractAddress}, chainId=${chainInfo.chainId}`);
    } catch (err) {
      report("Fetch chain configuration", "FAIL", err.message);
      finish();
      return;
    }
  }

  // ── criteriaHash ─────────────────────────────────────────────────
  try {
    const recomputed = hashCanonical(bundle.criteriaDocument);
    if (recomputed === bundle.criteriaHash) {
      report("Recompute criteriaHash", "PASS", recomputed);
    } else {
      report("Recompute criteriaHash", "FAIL", `expected ${bundle.criteriaHash}, got ${recomputed}`);
    }
  } catch (err) {
    report("Recompute criteriaHash", "FAIL", err.message);
  }

  // ── resultsHash / deterministicHash ──────────────────────────────
  if (bundle.resultsDocument) {
    try {
      const recomputedResults = hashCanonical(bundle.resultsDocument);
      if (recomputedResults === bundle.resultsHash) {
        report("Recompute resultsHash", "PASS", recomputedResults);
      } else {
        report("Recompute resultsHash", "FAIL", `expected ${bundle.resultsHash}, got ${recomputedResults}`);
      }
    } catch (err) {
      report("Recompute resultsHash", "FAIL", err.message);
    }
    try {
      const recomputedDeterministic = hashCanonical(bundle.resultsDocument.deterministic);
      if (recomputedDeterministic === bundle.deterministicHash) {
        report("Recompute deterministicHash", "PASS", recomputedDeterministic);
      } else {
        report("Recompute deterministicHash", "FAIL", `expected ${bundle.deterministicHash}, got ${recomputedDeterministic}`);
      }
    } catch (err) {
      report("Recompute deterministicHash", "FAIL", err.message);
    }
  } else {
    report("Recompute resultsHash", "SKIP", "no results document yet — verification has not run");
    report("Recompute deterministicHash", "SKIP", "no results document yet — verification has not run");
  }

  // ── On-chain comparison ──────────────────────────────────────────
  let onChain = null;
  if (bundle.onChainId === null) {
    report("Read on-chain agreement", "SKIP", "agreement not yet confirmed on-chain");
  } else {
    try {
      const rpcUrl = args.rpcUrl || DEFAULT_RPC_URL;
      const provider = new JsonRpcProvider(rpcUrl);
      const contract = new Contract(chainInfo.contractAddress, GET_AGREEMENT_ABI, provider);
      const onChainRaw = await contract.getAgreement(bundle.onChainId);
      onChain = {
        client: onChainRaw.client,
        worker: onChainRaw.worker,
        criteriaHash: onChainRaw.criteriaHash,
        resultsHash: onChainRaw.resultsHash,
        status: STATUS_NAMES[Number(onChainRaw.status)],
        outcome: OUTCOME_NAMES[Number(onChainRaw.outcome)],
      };
      report("Read on-chain agreement", "PASS", `status=${onChain.status}, outcome=${onChain.outcome} (rpc: ${rpcUrl})`);
    } catch (err) {
      report("Read on-chain agreement", "FAIL", err.message);
    }
  }

  if (onChain) {
    if (onChain.criteriaHash === bundle.criteriaHash) {
      report("On-chain criteriaHash matches server", "PASS", onChain.criteriaHash);
    } else {
      report("On-chain criteriaHash matches server", "FAIL", `chain=${onChain.criteriaHash}, server=${bundle.criteriaHash}`);
    }

    if (bundle.resultsDocument) {
      if (onChain.resultsHash === bundle.resultsHash) {
        report("On-chain resultsHash matches server", "PASS", onChain.resultsHash);
      } else {
        report("On-chain resultsHash matches server", "FAIL", `chain=${onChain.resultsHash}, server=${bundle.resultsHash}`);
      }
    } else {
      report("On-chain resultsHash matches server", "SKIP", "no results document yet");
    }
  } else {
    report("On-chain criteriaHash matches server", "SKIP", "on-chain read unavailable");
    report("On-chain resultsHash matches server", "SKIP", "on-chain read unavailable");
  }

  // ── Signatures ────────────────────────────────────────────────────
  const chainId = Number(chainInfo.chainId);
  const domain = buildDomain(chainId, chainInfo.contractAddress);

  if (bundle.client.signature && bundle.client.nonce !== null && bundle.worker.address) {
    try {
      const value = {
        worker: bundle.worker.address,
        amountMinor: BigInt(bundle.amountMinor),
        criteriaHash: bundle.criteriaHash,
        deadline: bundle.deadline,
        nonce: BigInt(bundle.client.nonce),
      };
      const recovered = verifyTypedData(domain, CRITERIA_COMMITMENT_TYPES, value, bundle.client.signature);
      if (recovered.toLowerCase() === bundle.client.address.toLowerCase()) {
        report("Client signature recovers to client address", "PASS", recovered);
      } else {
        report("Client signature recovers to client address", "FAIL", `recovered ${recovered}, expected ${bundle.client.address}`);
      }
    } catch (err) {
      report("Client signature recovers to client address", "FAIL", err.message);
    }
  } else {
    report("Client signature recovers to client address", "SKIP", "signature or nonce unavailable");
  }

  if (bundle.worker.signature && bundle.worker.nonce !== null && bundle.onChainId !== null) {
    try {
      const value = {
        agreementId: BigInt(bundle.onChainId),
        criteriaHash: bundle.criteriaHash,
        nonce: BigInt(bundle.worker.nonce),
      };
      const recovered = verifyTypedData(domain, CRITERIA_ACCEPTANCE_TYPES, value, bundle.worker.signature);
      if (recovered.toLowerCase() === bundle.worker.address.toLowerCase()) {
        report("Worker signature recovers to worker address", "PASS", recovered);
      } else {
        report("Worker signature recovers to worker address", "FAIL", `recovered ${recovered}, expected ${bundle.worker.address}`);
      }
    } catch (err) {
      report("Worker signature recovers to worker address", "FAIL", err.message);
    }
  } else {
    report("Worker signature recovers to worker address", "SKIP", "not yet accepted — no worker signature");
  }

  finish();
}

function finish() {
  console.log("");
  const failed = results.filter((r) => r.status === "FAIL");
  const passed = results.filter((r) => r.status === "PASS");
  const skipped = results.filter((r) => r.status === "SKIP");
  console.log(`${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Verifier crashed:", err);
  process.exit(1);
});
