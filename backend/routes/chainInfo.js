/**
 * routes/chainInfo.js
 * ─────────────────────
 * Read-only, public chain configuration for the frontend: the deployed
 * VeyloAgreements/CentralizedArbitrator addresses, chain id and explorer
 * base. Exists so the frontend never hardcodes a contract address (which
 * would go stale the moment the contract is redeployed) — it reads the same
 * config/chain.json the backend itself signs EIP-712 typed data against
 * (backend/lib/eip712.js), so a signature built from this response always
 * matches what the backend will verify.
 *
 * New file, additive only — not part of any locked-decision surface.
 */

const express = require("express");
const router = express.Router();

const chainConfig = require("../../config/chain.json");

const BLOCK_EXPLORER_BASE = {
  amoy: "https://amoy.polygonscan.com",
};

/**
 * GET /chain-info
 */
router.get("/", (req, res) => {
  res.json({
    chainId: chainConfig.chainId,
    network: chainConfig.network,
    contractAddress: chainConfig.contracts.VeyloAgreements.address,
    arbitratorAddress: chainConfig.contracts.CentralizedArbitrator.address,
    arbitrationCost: chainConfig.arbitrationCost,
    blockExplorerBase: BLOCK_EXPLORER_BASE[chainConfig.network] || null,
    deployedAt: chainConfig.deployedAt,
  });
});

module.exports = router;
