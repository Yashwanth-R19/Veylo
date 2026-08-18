const { ethers } = require("ethers");
const chainConfig = require("../../config/chain.json");

// Domain and typed-data structs must match contracts/VeyloAgreements.sol
// exactly (EIP712("Veylo", "1"); CRITERIA_COMMITMENT_TYPEHASH /
// CRITERIA_ACCEPTANCE_TYPEHASH) or recovered signers will not match.

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

/**
 * @param {{worker: string, amountMinor: bigint|string|number, criteriaHash: string, deadline: bigint|number, nonce: bigint|string|number}} value
 * @returns {{domain: object, types: object, value: object}}
 */
function buildCriteriaCommitment(value) {
  return { domain: DOMAIN, types: CRITERIA_COMMITMENT_TYPES, value };
}

/**
 * @param {{agreementId: bigint|string|number, criteriaHash: string, nonce: bigint|string|number}} value
 * @returns {{domain: object, types: object, value: object}}
 */
function buildCriteriaAcceptance(value) {
  return { domain: DOMAIN, types: CRITERIA_ACCEPTANCE_TYPES, value };
}

/**
 * Recovers the signer of a CriteriaCommitment signature and compares it
 * against expectedSigner. Does not touch the chain — lets the caller reject a
 * bad signature before it would cost gas on-chain.
 * @returns {boolean}
 */
function verifyCriteriaCommitment(value, signature, expectedSigner) {
  const recovered = ethers.verifyTypedData(DOMAIN, CRITERIA_COMMITMENT_TYPES, value, signature);
  return recovered.toLowerCase() === expectedSigner.toLowerCase();
}

/**
 * Recovers the signer of a CriteriaAcceptance signature and compares it
 * against expectedSigner (the agreement's stored worker address).
 * @returns {boolean}
 */
function verifyCriteriaAcceptance(value, signature, expectedSigner) {
  const recovered = ethers.verifyTypedData(DOMAIN, CRITERIA_ACCEPTANCE_TYPES, value, signature);
  return recovered.toLowerCase() === expectedSigner.toLowerCase();
}

/** Recovers and returns the signer address, without comparing it to anything. */
function recoverCriteriaCommitmentSigner(value, signature) {
  return ethers.verifyTypedData(DOMAIN, CRITERIA_COMMITMENT_TYPES, value, signature);
}

function recoverCriteriaAcceptanceSigner(value, signature) {
  return ethers.verifyTypedData(DOMAIN, CRITERIA_ACCEPTANCE_TYPES, value, signature);
}

module.exports = {
  DOMAIN,
  CRITERIA_COMMITMENT_TYPES,
  CRITERIA_ACCEPTANCE_TYPES,
  buildCriteriaCommitment,
  buildCriteriaAcceptance,
  verifyCriteriaCommitment,
  verifyCriteriaAcceptance,
  recoverCriteriaCommitmentSigner,
  recoverCriteriaAcceptanceSigner,
};
