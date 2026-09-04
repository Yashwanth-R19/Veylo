const { ethers } = require("ethers");
const chainConfig = require("../../config/chain.json");
const agreementsArtifact = require("../../artifacts/contracts/VeyloAgreements.sol/VeyloAgreements.json");
const arbitratorArtifact = require("../../artifacts/contracts/CentralizedArbitrator.sol/CentralizedArbitrator.json");

// Order must match the Status/Outcome enums in contracts/VeyloAgreements.sol exactly.
const STATUS_NAMES = [
  "DRAFT",
  "COMMITTED",
  "SUBMITTED",
  "VERIFIED",
  "NEEDS_REVIEW",
  "DISPUTED",
  "RULED",
  "SETTLEMENT_AUTHORIZED",
  "SETTLED",
  "CANCELLED",
];
const OUTCOME_NAMES = ["NONE", "ACCEPT", "REJECT"];

const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_AMOY_URL);

// The validator/operator wallet. Calls recordVerification/confirmSettlement
// (validator-gated) and relays createAgreement/acceptCriteria (signature-gated,
// callable by anyone).
const operatorWallet = new ethers.Wallet(process.env.VALIDATOR_PRIVATE_KEY, provider);

// submitEvidence/clientDecision/raiseDispute are msg.sender-gated in the
// deployed contract (no signature-relay path exists for them — see
// contracts/VeyloAgreements.sol). Per explicit user decision for this
// session's test lifecycle, the backend holds these test wallets directly and
// submits from the correct address itself. This is a testnet-only
// simplification for a single test client/worker, not a general multi-user
// key-custody system.
const clientWallet = process.env.TEST_CLIENT_PRIVATE_KEY
  ? new ethers.Wallet(process.env.TEST_CLIENT_PRIVATE_KEY, provider)
  : null;
const workerWallet = process.env.TEST_WORKER_PRIVATE_KEY
  ? new ethers.Wallet(process.env.TEST_WORKER_PRIVATE_KEY, provider)
  : null;

function getSignerWallet(role) {
  if (role === "operator") return operatorWallet;
  if (role === "client") {
    if (!clientWallet) throw new Error("TEST_CLIENT_PRIVATE_KEY not set");
    return clientWallet;
  }
  if (role === "worker") {
    if (!workerWallet) throw new Error("TEST_WORKER_PRIVATE_KEY not set");
    return workerWallet;
  }
  throw new Error(`Unknown signer role: ${role}`);
}

function agreementsContract(signerOrProvider = provider) {
  return new ethers.Contract(chainConfig.contracts.VeyloAgreements.address, agreementsArtifact.abi, signerOrProvider);
}

function arbitratorContract(signerOrProvider = provider) {
  return new ethers.Contract(chainConfig.contracts.CentralizedArbitrator.address, arbitratorArtifact.abi, signerOrProvider);
}

/** Reads an agreement directly from the chain and normalizes enum ints to names. */
async function getAgreement(onChainId) {
  const raw = await agreementsContract().getAgreement(onChainId);
  return {
    client: raw.client,
    worker: raw.worker,
    amountMinor: raw.amountMinor.toString(),
    criteriaHash: raw.criteriaHash,
    evidenceHash: raw.evidenceHash,
    resultsHash: raw.resultsHash,
    rulingHash: raw.rulingHash,
    settlementRef: raw.settlementRef,
    deadline: Number(raw.deadline),
    reviewWindowEnds: Number(raw.reviewWindowEnds),
    status: STATUS_NAMES[Number(raw.status)],
    outcome: OUTCOME_NAMES[Number(raw.outcome)],
    disputeId: raw.disputeId.toString(),
  };
}

async function getNextAgreementId() {
  return Number(await agreementsContract().nextAgreementId());
}

async function getCurrentBlock() {
  return provider.getBlockNumber();
}

async function getReceipt(txHash) {
  return provider.getTransactionReceipt(txHash);
}

// Which wallet must be msg.sender for a given outbox action. Mirrors the
// on-chain access-control checks in contracts/VeyloAgreements.sol.
function getSignerForAction(action, payload) {
  switch (action) {
    case "SUBMIT_EVIDENCE":
      return getSignerWallet("worker");
    case "CLIENT_DECISION":
      return getSignerWallet("client");
    case "RAISE_DISPUTE":
      return getSignerWallet(payload.party);
    default:
      return operatorWallet;
  }
}

// --- Write paths. Each returns a submitted TransactionResponse (not waited
// on) — the outbox owns confirmation tracking, retries and finality.
// `overrides` (e.g. { nonce }) is passed straight to ethers so the outbox can
// pin a deterministic nonce per row for idempotent resubmission. ---

async function submitCreateAgreement(payload, overrides = {}) {
  const contract = agreementsContract(operatorWallet);
  return contract.createAgreement(
    payload.worker,
    BigInt(payload.amountMinor),
    payload.criteriaHash,
    payload.deadline,
    BigInt(payload.nonce),
    payload.clientSig,
    overrides
  );
}

async function submitAcceptCriteria(payload, overrides = {}) {
  const contract = agreementsContract(operatorWallet);
  return contract.acceptCriteria(payload.agreementId, BigInt(payload.nonce), payload.workerSig, overrides);
}

async function submitEvidence(payload, overrides = {}) {
  const contract = agreementsContract(getSignerWallet("worker"));
  return contract.submitEvidence(payload.agreementId, payload.evidenceHash, overrides);
}

async function submitRecordVerification(payload, overrides = {}) {
  const contract = agreementsContract(operatorWallet);
  const outcomeIndex = OUTCOME_NAMES.indexOf(payload.outcome);
  if (outcomeIndex === -1) throw new Error(`Unknown outcome: ${payload.outcome}`);
  return contract.recordVerification(payload.agreementId, payload.resultsHash, outcomeIndex, overrides);
}

async function submitClientDecision(payload, overrides = {}) {
  const contract = agreementsContract(getSignerWallet("client"));
  const outcomeIndex = OUTCOME_NAMES.indexOf(payload.outcome);
  if (outcomeIndex === -1) throw new Error(`Unknown outcome: ${payload.outcome}`);
  return contract.clientDecision(payload.agreementId, outcomeIndex, overrides);
}

async function submitRaiseDispute(payload, overrides = {}) {
  const contract = agreementsContract(getSignerWallet(payload.party));
  const value = payload.value ? BigInt(payload.value) : 0n;
  return contract.raiseDispute(payload.agreementId, payload.reasonHash, { value, ...overrides });
}

// Gives a ruling on the arbitrator contract as its owner (the operator,
// acting as arbitrator per Kleros's own documented CentralizedArbitrator
// testing pattern — see README.md). This calls back into
// VeyloAgreements.rule() within the same transaction, moving the agreement
// DISPUTED -> RULED and setting its outcome on-chain.
async function submitGiveRuling(payload, overrides = {}) {
  const contract = arbitratorContract(operatorWallet);
  return contract.giveRuling(payload.disputeId, payload.ruling, overrides);
}

async function submitFinalize(payload, overrides = {}) {
  const contract = agreementsContract(operatorWallet);
  return contract.finalize(payload.agreementId, overrides);
}

async function submitConfirmSettlement(payload, overrides = {}) {
  const contract = agreementsContract(operatorWallet);
  return contract.confirmSettlement(payload.agreementId, payload.settlementRef, overrides);
}

const SUBMITTERS = {
  CREATE_AGREEMENT: submitCreateAgreement,
  ACCEPT_CRITERIA: submitAcceptCriteria,
  SUBMIT_EVIDENCE: submitEvidence,
  RECORD_VERIFICATION: submitRecordVerification,
  CLIENT_DECISION: submitClientDecision,
  RAISE_DISPUTE: submitRaiseDispute,
  FINALIZE: submitFinalize,
  CONFIRM_SETTLEMENT: submitConfirmSettlement,
  GIVE_RULING: submitGiveRuling,
};

module.exports = {
  STATUS_NAMES,
  OUTCOME_NAMES,
  provider,
  getSignerForAction,
  operatorWallet,
  clientWallet,
  workerWallet,
  agreementsContract,
  arbitratorContract,
  getAgreement,
  getNextAgreementId,
  getCurrentBlock,
  getReceipt,
  SUBMITTERS,
};
