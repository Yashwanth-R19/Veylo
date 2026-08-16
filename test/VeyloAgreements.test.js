const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  time,
  impersonateAccount,
  stopImpersonatingAccount,
  setBalance,
} = require("@nomicfoundation/hardhat-network-helpers");

const Status = {
  DRAFT: 0,
  COMMITTED: 1,
  SUBMITTED: 2,
  VERIFIED: 3,
  NEEDS_REVIEW: 4,
  DISPUTED: 5,
  RULED: 6,
  SETTLEMENT_AUTHORIZED: 7,
  SETTLED: 8,
  CANCELLED: 9,
};

const Outcome = { NONE: 0, ACCEPT: 1, REJECT: 2 };

const ARBITRATION_COST = ethers.parseEther("0.001");
const AMOUNT_MINOR = 500000n;
const CRITERIA_HASH = ethers.keccak256(ethers.toUtf8Bytes("criteria-v1"));
const OTHER_CRITERIA_HASH = ethers.keccak256(ethers.toUtf8Bytes("criteria-v2-different"));
const EVIDENCE_HASH = ethers.keccak256(ethers.toUtf8Bytes("evidence-v1"));
const RESULTS_HASH = ethers.keccak256(ethers.toUtf8Bytes("results-v1"));
const SETTLEMENT_REF = ethers.keccak256(ethers.toUtf8Bytes("settlement-v1"));

const COMMITMENT_TYPES = {
  CriteriaCommitment: [
    { name: "worker", type: "address" },
    { name: "amountMinor", type: "uint256" },
    { name: "criteriaHash", type: "bytes32" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
};

const ACCEPTANCE_TYPES = {
  CriteriaAcceptance: [
    { name: "agreementId", type: "uint256" },
    { name: "criteriaHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
};

describe("VeyloAgreements", function () {
  let veylo, arbitrator, veyloAddress, arbitratorAddress;
  let deployer, validator, client, worker, other, relayer;
  let domain;
  let nonceCounter;
  let futureDeadline;

  beforeEach(async function () {
    [deployer, validator, client, worker, other, relayer] = await ethers.getSigners();

    const CentralizedArbitrator = await ethers.getContractFactory("CentralizedArbitrator");
    arbitrator = await CentralizedArbitrator.deploy(ARBITRATION_COST);
    await arbitrator.waitForDeployment();
    arbitratorAddress = await arbitrator.getAddress();

    const VeyloAgreements = await ethers.getContractFactory("VeyloAgreements");
    veylo = await VeyloAgreements.deploy(validator.address, arbitratorAddress);
    await veylo.waitForDeployment();
    veyloAddress = await veylo.getAddress();

    const net = await ethers.provider.getNetwork();
    domain = {
      name: "Veylo",
      version: "1",
      chainId: net.chainId,
      verifyingContract: veyloAddress,
    };

    nonceCounter = 1;
    futureDeadline = BigInt((await time.latest()) + 30 * 24 * 60 * 60);
  });

  function nextNonce() {
    return nonceCounter++;
  }

  async function signCommitment(signer, { workerAddr = worker.address, amountMinor = AMOUNT_MINOR, criteriaHash = CRITERIA_HASH, deadline = futureDeadline, nonce }) {
    return signer.signTypedData(domain, COMMITMENT_TYPES, {
      worker: workerAddr,
      amountMinor,
      criteriaHash,
      deadline,
      nonce,
    });
  }

  async function signAcceptance(signer, { agreementId, criteriaHash = CRITERIA_HASH, nonce }) {
    return signer.signTypedData(domain, ACCEPTANCE_TYPES, {
      agreementId,
      criteriaHash,
      nonce,
    });
  }

  async function createDraftAgreement(opts = {}) {
    const nonce = opts.nonce ?? nextNonce();
    const workerAddr = opts.workerAddr ?? worker.address;
    const amountMinor = opts.amountMinor ?? AMOUNT_MINOR;
    const criteriaHash = opts.criteriaHash ?? CRITERIA_HASH;
    const deadline = opts.deadline ?? futureDeadline;
    const signer = opts.signer ?? client;

    const sig = await signCommitment(signer, { workerAddr, amountMinor, criteriaHash, deadline, nonce });
    const tx = await veylo
      .connect(relayer)
      .createAgreement(workerAddr, amountMinor, criteriaHash, deadline, nonce, sig);
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try {
          return veylo.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed && parsed.name === "AgreementCreated");
    return event.args.agreementId;
  }

  async function progressToCommitted(opts = {}) {
    const id = await createDraftAgreement(opts);
    const nonce = nextNonce();
    const sig = await signAcceptance(worker, { agreementId: id, criteriaHash: opts.criteriaHash ?? CRITERIA_HASH, nonce });
    await veylo.connect(relayer).acceptCriteria(id, nonce, sig);
    return id;
  }

  async function progressToSubmitted(opts = {}) {
    const id = await progressToCommitted(opts);
    await veylo.connect(worker).submitEvidence(id, EVIDENCE_HASH);
    return id;
  }

  async function progressToVerified(outcome = Outcome.ACCEPT, opts = {}) {
    const id = await progressToSubmitted(opts);
    await veylo.connect(validator).recordVerification(id, RESULTS_HASH, outcome);
    return id;
  }

  async function progressToNeedsReview(opts = {}) {
    const id = await progressToSubmitted(opts);
    await veylo.connect(validator).recordVerification(id, RESULTS_HASH, Outcome.NONE);
    return id;
  }

  async function progressToDisputedFromVerified(opts = {}) {
    const id = await progressToVerified(Outcome.ACCEPT, opts);
    await veylo.connect(client).raiseDispute(id, { value: ARBITRATION_COST });
    return id;
  }

  async function progressToDisputedFromNeedsReview(opts = {}) {
    const id = await progressToNeedsReview(opts);
    await veylo.connect(worker).raiseDispute(id, { value: ARBITRATION_COST });
    return id;
  }

  async function progressToRuled(ruling = 1, opts = {}) {
    const id = await progressToDisputedFromVerified(opts);
    const agreement = await veylo.getAgreement(id);
    await arbitrator.connect(deployer).giveRuling(agreement.disputeId, ruling);
    return id;
  }

  async function progressToSettlementAuthorizedFromVerified(opts = {}) {
    const id = await progressToVerified(Outcome.ACCEPT, opts);
    const agreement = await veylo.getAgreement(id);
    await time.increaseTo(agreement.reviewWindowEnds);
    await veylo.connect(other).finalize(id);
    return id;
  }

  async function progressToSettled(opts = {}) {
    const id = await progressToSettlementAuthorizedFromVerified(opts);
    await veylo.connect(validator).confirmSettlement(id, SETTLEMENT_REF);
    return id;
  }

  async function progressToCancelled(opts = {}) {
    const id = await createDraftAgreement(opts);
    await veylo.connect(client).cancel(id);
    return id;
  }

  // Builds an agreement sitting in each of the ten states, keyed by name, for
  // exhaustive invalid-transition testing below.
  async function buildAllStates() {
    return {
      DRAFT: await createDraftAgreement(),
      COMMITTED: await progressToCommitted(),
      SUBMITTED: await progressToSubmitted(),
      VERIFIED: await progressToVerified(),
      NEEDS_REVIEW: await progressToNeedsReview(),
      DISPUTED: await progressToDisputedFromVerified(),
      RULED: await progressToRuled(),
      SETTLEMENT_AUTHORIZED: await progressToSettlementAuthorizedFromVerified(),
      SETTLED: await progressToSettled(),
      CANCELLED: await progressToCancelled(),
    };
  }

  // ------------------------------------------------------------------
  // Happy path
  // ------------------------------------------------------------------

  describe("full happy path", function () {
    it("goes DRAFT -> COMMITTED -> SUBMITTED -> VERIFIED -> SETTLEMENT_AUTHORIZED -> SETTLED", async function () {
      const nonce1 = nextNonce();
      const sig1 = await signCommitment(client, { nonce: nonce1 });
      const createTx = await veylo
        .connect(relayer)
        .createAgreement(worker.address, AMOUNT_MINOR, CRITERIA_HASH, futureDeadline, nonce1, sig1);
      const createReceipt = await createTx.wait();
      const createdEvent = createReceipt.logs
        .map((log) => {
          try {
            return veylo.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed && parsed.name === "AgreementCreated");
      const id = createdEvent.args.agreementId;

      let agreement = await veylo.getAgreement(id);
      expect(agreement.status).to.equal(Status.DRAFT);
      expect(agreement.client).to.equal(client.address);
      expect(agreement.worker).to.equal(worker.address);

      const nonce2 = nextNonce();
      const sig2 = await signAcceptance(worker, { agreementId: id, nonce: nonce2 });
      await veylo.connect(relayer).acceptCriteria(id, nonce2, sig2);
      agreement = await veylo.getAgreement(id);
      expect(agreement.status).to.equal(Status.COMMITTED);

      await veylo.connect(worker).submitEvidence(id, EVIDENCE_HASH);
      agreement = await veylo.getAgreement(id);
      expect(agreement.status).to.equal(Status.SUBMITTED);
      expect(agreement.evidenceHash).to.equal(EVIDENCE_HASH);

      await veylo.connect(validator).recordVerification(id, RESULTS_HASH, Outcome.ACCEPT);
      agreement = await veylo.getAgreement(id);
      expect(agreement.status).to.equal(Status.VERIFIED);
      expect(agreement.outcome).to.equal(Outcome.ACCEPT);
      expect(agreement.resultsHash).to.equal(RESULTS_HASH);

      await time.increaseTo(agreement.reviewWindowEnds);
      await veylo.connect(other).finalize(id);
      agreement = await veylo.getAgreement(id);
      expect(agreement.status).to.equal(Status.SETTLEMENT_AUTHORIZED);

      await veylo.connect(validator).confirmSettlement(id, SETTLEMENT_REF);
      agreement = await veylo.getAgreement(id);
      expect(agreement.status).to.equal(Status.SETTLED);
      expect(agreement.settlementRef).to.equal(SETTLEMENT_REF);
    });
  });

  // ------------------------------------------------------------------
  // createAgreement validation
  // ------------------------------------------------------------------

  describe("createAgreement", function () {
    it("reverts when worker is the zero address", async function () {
      const nonce = nextNonce();
      const sig = await signCommitment(client, { workerAddr: ethers.ZeroAddress, nonce });
      await expect(
        veylo.connect(relayer).createAgreement(ethers.ZeroAddress, AMOUNT_MINOR, CRITERIA_HASH, futureDeadline, nonce, sig)
      ).to.be.revertedWith("VeyloAgreements: worker is zero address");
    });

    it("reverts when deadline is not in the future", async function () {
      const pastDeadline = BigInt((await time.latest()) - 1);
      const nonce = nextNonce();
      const sig = await signCommitment(client, { deadline: pastDeadline, nonce });
      await expect(
        veylo.connect(relayer).createAgreement(worker.address, AMOUNT_MINOR, CRITERIA_HASH, pastDeadline, nonce, sig)
      ).to.be.revertedWith("VeyloAgreements: deadline must be in the future");
    });

    it("reverts when criteriaHash is zero", async function () {
      const nonce = nextNonce();
      const sig = await signCommitment(client, { criteriaHash: ethers.ZeroHash, nonce });
      await expect(
        veylo.connect(relayer).createAgreement(worker.address, AMOUNT_MINOR, ethers.ZeroHash, futureDeadline, nonce, sig)
      ).to.be.revertedWith("VeyloAgreements: criteriaHash is zero");
    });

    it("reverts when the signer would equal the named worker", async function () {
      const nonce = nextNonce();
      // worker signs its own commitment naming itself as the worker
      const sig = await signCommitment(worker, { workerAddr: worker.address, nonce });
      await expect(
        veylo.connect(relayer).createAgreement(worker.address, AMOUNT_MINOR, CRITERIA_HASH, futureDeadline, nonce, sig)
      ).to.be.revertedWith("VeyloAgreements: worker cannot be the client");
    });

    it("rejects a forged (malformed) client signature", async function () {
      const nonce = nextNonce();
      const forgedSig = "0x" + "ab".repeat(65); // well-formed length, not produced by any real key over this data
      await expect(
        veylo.connect(relayer).createAgreement(worker.address, AMOUNT_MINOR, CRITERIA_HASH, futureDeadline, nonce, forgedSig)
      ).to.be.reverted;
    });

    it("rejects a truncated/invalid-length signature", async function () {
      const nonce = nextNonce();
      const badSig = "0x1234";
      await expect(
        veylo.connect(relayer).createAgreement(worker.address, AMOUNT_MINOR, CRITERIA_HASH, futureDeadline, nonce, badSig)
      ).to.be.revertedWith("ECDSA: invalid signature length");
    });

    it("rejects a replayed nonce", async function () {
      const nonce = nextNonce();
      const sig = await signCommitment(client, { nonce });
      await veylo.connect(relayer).createAgreement(worker.address, AMOUNT_MINOR, CRITERIA_HASH, futureDeadline, nonce, sig);

      // Same client, same nonce, a brand new (still valid) commitment.
      const otherWorker = other.address;
      const sig2 = await signCommitment(client, { workerAddr: otherWorker, nonce });
      await expect(
        veylo.connect(relayer).createAgreement(otherWorker, AMOUNT_MINOR, CRITERIA_HASH, futureDeadline, nonce, sig2)
      ).to.be.revertedWith("VeyloAgreements: nonce already used");
    });

    it("may be relayed by an address other than the client or worker", async function () {
      const nonce = nextNonce();
      const sig = await signCommitment(client, { nonce });
      await expect(
        veylo.connect(relayer).createAgreement(worker.address, AMOUNT_MINOR, CRITERIA_HASH, futureDeadline, nonce, sig)
      ).to.not.be.reverted;
    });
  });

  // ------------------------------------------------------------------
  // acceptCriteria validation
  // ------------------------------------------------------------------

  describe("acceptCriteria", function () {
    it("rejects a worker signature over a different criteriaHash", async function () {
      const id = await createDraftAgreement();
      const nonce = nextNonce();
      // Worker signs acceptance for a criteriaHash that does not match the
      // one actually stored on-chain for this agreement.
      const sig = await signAcceptance(worker, { agreementId: id, criteriaHash: OTHER_CRITERIA_HASH, nonce });
      await expect(veylo.connect(relayer).acceptCriteria(id, nonce, sig)).to.be.revertedWith(
        "VeyloAgreements: signature is not the worker's"
      );
    });

    it("rejects a signature from a non-worker signer", async function () {
      const id = await createDraftAgreement();
      const nonce = nextNonce();
      const sig = await signAcceptance(other, { agreementId: id, nonce });
      await expect(veylo.connect(relayer).acceptCriteria(id, nonce, sig)).to.be.revertedWith(
        "VeyloAgreements: signature is not the worker's"
      );
    });

    it("rejects a replayed nonce", async function () {
      const id = await createDraftAgreement();
      const nonce = nextNonce();
      const sig = await signAcceptance(worker, { agreementId: id, nonce });
      await veylo.connect(relayer).acceptCriteria(id, nonce, sig);

      const id2 = await createDraftAgreement();
      const sig2 = await signAcceptance(worker, { agreementId: id2, nonce });
      await expect(veylo.connect(relayer).acceptCriteria(id2, nonce, sig2)).to.be.revertedWith(
        "VeyloAgreements: nonce already used"
      );
    });

    it("may be relayed by an address other than the client or worker", async function () {
      const id = await createDraftAgreement();
      const nonce = nextNonce();
      const sig = await signAcceptance(worker, { agreementId: id, nonce });
      await expect(veylo.connect(relayer).acceptCriteria(id, nonce, sig)).to.not.be.reverted;
    });
  });

  // ------------------------------------------------------------------
  // submitEvidence
  // ------------------------------------------------------------------

  describe("submitEvidence", function () {
    it("reverts when called by a non-worker party", async function () {
      const id = await progressToCommitted();
      await expect(veylo.connect(client).submitEvidence(id, EVIDENCE_HASH)).to.be.revertedWith(
        "VeyloAgreements: caller is not the worker"
      );
    });

    it("reverts when called by an unrelated address", async function () {
      const id = await progressToCommitted();
      await expect(veylo.connect(other).submitEvidence(id, EVIDENCE_HASH)).to.be.revertedWith(
        "VeyloAgreements: caller is not the worker"
      );
    });

    it("reverts after the deadline has passed", async function () {
      const nonce = nextNonce();
      const nearDeadline = BigInt((await time.latest()) + 60);
      const id = await progressToCommitted({ deadline: nearDeadline, nonce });
      await time.increaseTo(nearDeadline + 1n);
      await expect(veylo.connect(worker).submitEvidence(id, EVIDENCE_HASH)).to.be.revertedWith(
        "VeyloAgreements: deadline has passed"
      );
    });
  });

  // ------------------------------------------------------------------
  // recordVerification
  // ------------------------------------------------------------------

  describe("recordVerification", function () {
    it("reverts when called by a non-validator address", async function () {
      const id = await progressToSubmitted();
      await expect(veylo.connect(other).recordVerification(id, RESULTS_HASH, Outcome.ACCEPT)).to.be.revertedWith(
        "VeyloAgreements: caller is not the validator"
      );
    });

    it("moves to VERIFIED and sets outcome ACCEPT when automated is ACCEPT", async function () {
      const id = await progressToSubmitted();
      await veylo.connect(validator).recordVerification(id, RESULTS_HASH, Outcome.ACCEPT);
      const agreement = await veylo.getAgreement(id);
      expect(agreement.status).to.equal(Status.VERIFIED);
      expect(agreement.outcome).to.equal(Outcome.ACCEPT);
    });

    it("moves to VERIFIED and sets outcome REJECT when automated is REJECT", async function () {
      const id = await progressToSubmitted();
      await veylo.connect(validator).recordVerification(id, RESULTS_HASH, Outcome.REJECT);
      const agreement = await veylo.getAgreement(id);
      expect(agreement.status).to.equal(Status.VERIFIED);
      expect(agreement.outcome).to.equal(Outcome.REJECT);
    });

    it("moves to NEEDS_REVIEW when automated is NONE", async function () {
      const id = await progressToSubmitted();
      await veylo.connect(validator).recordVerification(id, RESULTS_HASH, Outcome.NONE);
      const agreement = await veylo.getAgreement(id);
      expect(agreement.status).to.equal(Status.NEEDS_REVIEW);
    });

    it("sets reviewWindowEnds to block.timestamp + REVIEW_WINDOW", async function () {
      const id = await progressToSubmitted();
      const tx = await veylo.connect(validator).recordVerification(id, RESULTS_HASH, Outcome.ACCEPT);
      const block = await ethers.provider.getBlock(tx.blockNumber);
      const agreement = await veylo.getAgreement(id);
      expect(agreement.reviewWindowEnds).to.equal(BigInt(block.timestamp) + (await veylo.REVIEW_WINDOW()));
    });
  });

  // ------------------------------------------------------------------
  // clientDecision
  // ------------------------------------------------------------------

  describe("clientDecision", function () {
    it("reverts when called by a non-client party", async function () {
      const id = await progressToNeedsReview();
      await expect(veylo.connect(worker).clientDecision(id, Outcome.ACCEPT)).to.be.revertedWith(
        "VeyloAgreements: caller is not the client"
      );
    });

    it("reverts when called by an unrelated address", async function () {
      const id = await progressToNeedsReview();
      await expect(veylo.connect(other).clientDecision(id, Outcome.ACCEPT)).to.be.revertedWith(
        "VeyloAgreements: caller is not the client"
      );
    });

    it("reverts when the outcome is NONE", async function () {
      const id = await progressToNeedsReview();
      await expect(veylo.connect(client).clientDecision(id, Outcome.NONE)).to.be.revertedWith(
        "VeyloAgreements: outcome must be ACCEPT or REJECT"
      );
    });

    it("reverts after the review window has ended", async function () {
      const id = await progressToNeedsReview();
      const agreement = await veylo.getAgreement(id);
      await time.increaseTo(agreement.reviewWindowEnds);
      await expect(veylo.connect(client).clientDecision(id, Outcome.ACCEPT)).to.be.revertedWith(
        "VeyloAgreements: review window has ended"
      );
    });

    it("moves NEEDS_REVIEW -> VERIFIED with outcome ACCEPT", async function () {
      const id = await progressToNeedsReview();
      await veylo.connect(client).clientDecision(id, Outcome.ACCEPT);
      const agreement = await veylo.getAgreement(id);
      expect(agreement.status).to.equal(Status.VERIFIED);
      expect(agreement.outcome).to.equal(Outcome.ACCEPT);
    });

    it("moves NEEDS_REVIEW -> VERIFIED with outcome REJECT", async function () {
      const id = await progressToNeedsReview();
      await veylo.connect(client).clientDecision(id, Outcome.REJECT);
      const agreement = await veylo.getAgreement(id);
      expect(agreement.status).to.equal(Status.VERIFIED);
      expect(agreement.outcome).to.equal(Outcome.REJECT);
    });
  });

  // ------------------------------------------------------------------
  // raiseDispute
  // ------------------------------------------------------------------

  describe("raiseDispute", function () {
    it("reverts when called by a non-party", async function () {
      const id = await progressToVerified();
      await expect(
        veylo.connect(other).raiseDispute(id, { value: ARBITRATION_COST })
      ).to.be.revertedWith("VeyloAgreements: caller is not a party");
    });

    it("reverts after the review window has ended", async function () {
      const id = await progressToVerified();
      const agreement = await veylo.getAgreement(id);
      await time.increaseTo(agreement.reviewWindowEnds);
      await expect(
        veylo.connect(client).raiseDispute(id, { value: ARBITRATION_COST })
      ).to.be.revertedWith("VeyloAgreements: review window has ended");
    });

    it("client can raise a dispute from VERIFIED", async function () {
      const id = await progressToVerified();
      await expect(veylo.connect(client).raiseDispute(id, { value: ARBITRATION_COST })).to.not.be.reverted;
      const agreement = await veylo.getAgreement(id);
      expect(agreement.status).to.equal(Status.DISPUTED);
    });

    it("worker can raise a dispute from NEEDS_REVIEW", async function () {
      const id = await progressToNeedsReview();
      await expect(veylo.connect(worker).raiseDispute(id, { value: ARBITRATION_COST })).to.not.be.reverted;
      const agreement = await veylo.getAgreement(id);
      expect(agreement.status).to.equal(Status.DISPUTED);
    });

    it("forwards msg.value to the arbitrator as the arbitration fee", async function () {
      const id = await progressToVerified();
      const before = await ethers.provider.getBalance(arbitratorAddress);
      await veylo.connect(client).raiseDispute(id, { value: ARBITRATION_COST });
      const after = await ethers.provider.getBalance(arbitratorAddress);
      expect(after - before).to.equal(ARBITRATION_COST);
    });
  });

  // ------------------------------------------------------------------
  // rule() — full dispute path plus caller/state guards
  // ------------------------------------------------------------------

  describe("rule", function () {
    it("reverts for any caller other than the arbitrator contract", async function () {
      const id = await progressToDisputedFromVerified();
      const agreement = await veylo.getAgreement(id);
      await expect(veylo.connect(other).rule(agreement.disputeId, 1)).to.be.revertedWith(
        "VeyloAgreements: caller is not the arbitrator"
      );
    });

    it("reverts when called by the client directly (not the arbitrator)", async function () {
      const id = await progressToDisputedFromVerified();
      const agreement = await veylo.getAgreement(id);
      await expect(veylo.connect(client).rule(agreement.disputeId, 1)).to.be.revertedWith(
        "VeyloAgreements: caller is not the arbitrator"
      );
    });

    it("full dispute path: ruling 1 (ACCEPT) via the real arbitrator", async function () {
      const id = await progressToDisputedFromVerified();
      const agreement = await veylo.getAgreement(id);
      await expect(arbitrator.connect(deployer).giveRuling(agreement.disputeId, 1))
        .to.emit(veylo, "Ruled")
        .withArgs(id, agreement.disputeId, 1);
      const updated = await veylo.getAgreement(id);
      expect(updated.status).to.equal(Status.RULED);
      expect(updated.outcome).to.equal(Outcome.ACCEPT);
    });

    it("full dispute path: ruling 2 (REJECT) via the real arbitrator", async function () {
      const id = await progressToDisputedFromVerified();
      const agreement = await veylo.getAgreement(id);
      await arbitrator.connect(deployer).giveRuling(agreement.disputeId, 2);
      const updated = await veylo.getAgreement(id);
      expect(updated.status).to.equal(Status.RULED);
      expect(updated.outcome).to.equal(Outcome.REJECT);
    });

    it("full dispute path: ruling 0 (refused) resolves REJECT via the real arbitrator", async function () {
      const id = await progressToDisputedFromVerified();
      const agreement = await veylo.getAgreement(id);
      await arbitrator.connect(deployer).giveRuling(agreement.disputeId, 0);
      const updated = await veylo.getAgreement(id);
      expect(updated.status).to.equal(Status.RULED);
      expect(updated.outcome).to.equal(Outcome.REJECT);
    });

    it("giveRuling on the arbitrator reverts when called by a non-owner", async function () {
      const id = await progressToDisputedFromVerified();
      const agreement = await veylo.getAgreement(id);
      await expect(arbitrator.connect(other).giveRuling(agreement.disputeId, 1)).to.be.revertedWith(
        "CentralizedArbitrator: caller is not the owner"
      );
    });

    describe("not-in-DISPUTED guard (arbitrator address impersonated to isolate VeyloAgreements' own check)", function () {
      let arbitratorSigner;

      beforeEach(async function () {
        await impersonateAccount(arbitratorAddress);
        await setBalance(arbitratorAddress, ethers.parseEther("10"));
        arbitratorSigner = await ethers.getSigner(arbitratorAddress);
      });

      afterEach(async function () {
        await stopImpersonatingAccount(arbitratorAddress);
      });

      it("reverts when the agreement is in DRAFT", async function () {
        const id = await createDraftAgreement();
        await expect(veylo.connect(arbitratorSigner).rule(999, 1)).to.be.revertedWith(
          "VeyloAgreements: not in DISPUTED"
        );
        // sanity: id exists and really is DRAFT, unrelated to the disputeId used above
        expect((await veylo.getAgreement(id)).status).to.equal(Status.DRAFT);
      });

      it("reverts when the agreement is in COMMITTED", async function () {
        await progressToCommitted();
        await expect(veylo.connect(arbitratorSigner).rule(999, 1)).to.be.revertedWith(
          "VeyloAgreements: not in DISPUTED"
        );
      });

      it("reverts when the agreement is in SUBMITTED", async function () {
        await progressToSubmitted();
        await expect(veylo.connect(arbitratorSigner).rule(999, 1)).to.be.revertedWith(
          "VeyloAgreements: not in DISPUTED"
        );
      });

      it("reverts when the agreement is in VERIFIED", async function () {
        await progressToVerified();
        await expect(veylo.connect(arbitratorSigner).rule(999, 1)).to.be.revertedWith(
          "VeyloAgreements: not in DISPUTED"
        );
      });

      it("reverts when the agreement is in NEEDS_REVIEW", async function () {
        await progressToNeedsReview();
        await expect(veylo.connect(arbitratorSigner).rule(999, 1)).to.be.revertedWith(
          "VeyloAgreements: not in DISPUTED"
        );
      });

      it("reverts when the agreement is already RULED (no double-ruling)", async function () {
        const id = await progressToRuled(1);
        const agreement = await veylo.getAgreement(id);
        await expect(veylo.connect(arbitratorSigner).rule(agreement.disputeId, 2)).to.be.revertedWith(
          "VeyloAgreements: not in DISPUTED"
        );
      });

      it("reverts when the agreement is in SETTLEMENT_AUTHORIZED", async function () {
        await progressToSettlementAuthorizedFromVerified();
        await expect(veylo.connect(arbitratorSigner).rule(999, 1)).to.be.revertedWith(
          "VeyloAgreements: not in DISPUTED"
        );
      });

      it("reverts when the agreement is in SETTLED", async function () {
        await progressToSettled();
        await expect(veylo.connect(arbitratorSigner).rule(999, 1)).to.be.revertedWith(
          "VeyloAgreements: not in DISPUTED"
        );
      });

      it("reverts when the agreement is in CANCELLED", async function () {
        await progressToCancelled();
        await expect(veylo.connect(arbitratorSigner).rule(999, 1)).to.be.revertedWith(
          "VeyloAgreements: not in DISPUTED"
        );
      });
    });
  });

  // ------------------------------------------------------------------
  // finalize
  // ------------------------------------------------------------------

  describe("finalize", function () {
    it("reverts before reviewWindowEnds for a VERIFIED agreement", async function () {
      const id = await progressToVerified();
      await expect(veylo.connect(other).finalize(id)).to.be.revertedWith(
        "VeyloAgreements: review window has not ended"
      );
    });

    it("succeeds after reviewWindowEnds for a VERIFIED agreement (time travel)", async function () {
      const id = await progressToVerified();
      const agreement = await veylo.getAgreement(id);
      await time.increaseTo(agreement.reviewWindowEnds);
      await expect(veylo.connect(other).finalize(id)).to.not.be.reverted;
      expect((await veylo.getAgreement(id)).status).to.equal(Status.SETTLEMENT_AUTHORIZED);
    });

    it("succeeds immediately for a RULED agreement, with no window check", async function () {
      const id = await progressToRuled(1);
      await expect(veylo.connect(other).finalize(id)).to.not.be.reverted;
      expect((await veylo.getAgreement(id)).status).to.equal(Status.SETTLEMENT_AUTHORIZED);
    });

    it("may be called by anyone, not just a party", async function () {
      const id = await progressToRuled(1);
      await expect(veylo.connect(other).finalize(id)).to.not.be.reverted;
    });

    it("reverts when the agreement is in DRAFT", async function () {
      const id = await createDraftAgreement();
      await expect(veylo.finalize(id)).to.be.revertedWith("VeyloAgreements: not in VERIFIED or RULED");
    });

    it("reverts when the agreement is in COMMITTED", async function () {
      const id = await progressToCommitted();
      await expect(veylo.finalize(id)).to.be.revertedWith("VeyloAgreements: not in VERIFIED or RULED");
    });

    it("reverts when the agreement is in SUBMITTED", async function () {
      const id = await progressToSubmitted();
      await expect(veylo.finalize(id)).to.be.revertedWith("VeyloAgreements: not in VERIFIED or RULED");
    });

    it("reverts when the agreement is in NEEDS_REVIEW", async function () {
      const id = await progressToNeedsReview();
      await expect(veylo.finalize(id)).to.be.revertedWith("VeyloAgreements: not in VERIFIED or RULED");
    });

    it("reverts when the agreement is in DISPUTED", async function () {
      const id = await progressToDisputedFromVerified();
      await expect(veylo.finalize(id)).to.be.revertedWith("VeyloAgreements: not in VERIFIED or RULED");
    });

    it("reverts when the agreement is already SETTLEMENT_AUTHORIZED", async function () {
      const id = await progressToSettlementAuthorizedFromVerified();
      await expect(veylo.finalize(id)).to.be.revertedWith("VeyloAgreements: not in VERIFIED or RULED");
    });

    it("reverts when the agreement is already SETTLED", async function () {
      const id = await progressToSettled();
      await expect(veylo.finalize(id)).to.be.revertedWith("VeyloAgreements: not in VERIFIED or RULED");
    });

    it("reverts when the agreement is CANCELLED", async function () {
      const id = await progressToCancelled();
      await expect(veylo.finalize(id)).to.be.revertedWith("VeyloAgreements: not in VERIFIED or RULED");
    });
  });

  // ------------------------------------------------------------------
  // confirmSettlement
  // ------------------------------------------------------------------

  describe("confirmSettlement", function () {
    it("reverts when called by a non-validator address", async function () {
      const id = await progressToSettlementAuthorizedFromVerified();
      await expect(veylo.connect(other).confirmSettlement(id, SETTLEMENT_REF)).to.be.revertedWith(
        "VeyloAgreements: caller is not the validator"
      );
    });

    it("reverts when settlementRef is zero", async function () {
      const id = await progressToSettlementAuthorizedFromVerified();
      await expect(veylo.connect(validator).confirmSettlement(id, ethers.ZeroHash)).to.be.revertedWith(
        "VeyloAgreements: settlementRef is zero"
      );
    });

    it("reverts when the agreement is in DRAFT", async function () {
      const id = await createDraftAgreement();
      await expect(veylo.connect(validator).confirmSettlement(id, SETTLEMENT_REF)).to.be.revertedWith(
        "VeyloAgreements: not in SETTLEMENT_AUTHORIZED"
      );
    });

    it("reverts when the agreement is in COMMITTED", async function () {
      const id = await progressToCommitted();
      await expect(veylo.connect(validator).confirmSettlement(id, SETTLEMENT_REF)).to.be.revertedWith(
        "VeyloAgreements: not in SETTLEMENT_AUTHORIZED"
      );
    });

    it("reverts when the agreement is in SUBMITTED", async function () {
      const id = await progressToSubmitted();
      await expect(veylo.connect(validator).confirmSettlement(id, SETTLEMENT_REF)).to.be.revertedWith(
        "VeyloAgreements: not in SETTLEMENT_AUTHORIZED"
      );
    });

    it("reverts when the agreement is in VERIFIED", async function () {
      const id = await progressToVerified();
      await expect(veylo.connect(validator).confirmSettlement(id, SETTLEMENT_REF)).to.be.revertedWith(
        "VeyloAgreements: not in SETTLEMENT_AUTHORIZED"
      );
    });

    it("reverts when the agreement is in NEEDS_REVIEW", async function () {
      const id = await progressToNeedsReview();
      await expect(veylo.connect(validator).confirmSettlement(id, SETTLEMENT_REF)).to.be.revertedWith(
        "VeyloAgreements: not in SETTLEMENT_AUTHORIZED"
      );
    });

    it("reverts when the agreement is in DISPUTED", async function () {
      const id = await progressToDisputedFromVerified();
      await expect(veylo.connect(validator).confirmSettlement(id, SETTLEMENT_REF)).to.be.revertedWith(
        "VeyloAgreements: not in SETTLEMENT_AUTHORIZED"
      );
    });

    it("reverts when the agreement is in RULED", async function () {
      const id = await progressToRuled(1);
      await expect(veylo.connect(validator).confirmSettlement(id, SETTLEMENT_REF)).to.be.revertedWith(
        "VeyloAgreements: not in SETTLEMENT_AUTHORIZED"
      );
    });

    it("reverts when the agreement is already SETTLED", async function () {
      const id = await progressToSettled();
      await expect(veylo.connect(validator).confirmSettlement(id, SETTLEMENT_REF)).to.be.revertedWith(
        "VeyloAgreements: not in SETTLEMENT_AUTHORIZED"
      );
    });

    it("reverts when the agreement is CANCELLED", async function () {
      const id = await progressToCancelled();
      await expect(veylo.connect(validator).confirmSettlement(id, SETTLEMENT_REF)).to.be.revertedWith(
        "VeyloAgreements: not in SETTLEMENT_AUTHORIZED"
      );
    });
  });

  // ------------------------------------------------------------------
  // cancel
  // ------------------------------------------------------------------

  describe("cancel", function () {
    it("reverts when called by a non-client party", async function () {
      const id = await createDraftAgreement();
      await expect(veylo.connect(worker).cancel(id)).to.be.revertedWith("VeyloAgreements: caller is not the client");
    });

    it("reverts when called by an unrelated address", async function () {
      const id = await createDraftAgreement();
      await expect(veylo.connect(other).cancel(id)).to.be.revertedWith("VeyloAgreements: caller is not the client");
    });

    it("moves DRAFT -> CANCELLED when called by the client", async function () {
      const id = await createDraftAgreement();
      await veylo.connect(client).cancel(id);
      expect((await veylo.getAgreement(id)).status).to.equal(Status.CANCELLED);
    });

    it("reverts when the agreement is in COMMITTED", async function () {
      const id = await progressToCommitted();
      await expect(veylo.connect(client).cancel(id)).to.be.revertedWith("VeyloAgreements: not in DRAFT");
    });

    it("reverts when the agreement is in SUBMITTED", async function () {
      const id = await progressToSubmitted();
      await expect(veylo.connect(client).cancel(id)).to.be.revertedWith("VeyloAgreements: not in DRAFT");
    });

    it("reverts when the agreement is in VERIFIED", async function () {
      const id = await progressToVerified();
      await expect(veylo.connect(client).cancel(id)).to.be.revertedWith("VeyloAgreements: not in DRAFT");
    });

    it("reverts when the agreement is in NEEDS_REVIEW", async function () {
      const id = await progressToNeedsReview();
      await expect(veylo.connect(client).cancel(id)).to.be.revertedWith("VeyloAgreements: not in DRAFT");
    });

    it("reverts when the agreement is in DISPUTED", async function () {
      const id = await progressToDisputedFromVerified();
      await expect(veylo.connect(client).cancel(id)).to.be.revertedWith("VeyloAgreements: not in DRAFT");
    });

    it("reverts when the agreement is in RULED", async function () {
      const id = await progressToRuled(1);
      await expect(veylo.connect(client).cancel(id)).to.be.revertedWith("VeyloAgreements: not in DRAFT");
    });

    it("reverts when the agreement is in SETTLEMENT_AUTHORIZED", async function () {
      const id = await progressToSettlementAuthorizedFromVerified();
      await expect(veylo.connect(client).cancel(id)).to.be.revertedWith("VeyloAgreements: not in DRAFT");
    });

    it("reverts when the agreement is already SETTLED", async function () {
      const id = await progressToSettled();
      await expect(veylo.connect(client).cancel(id)).to.be.revertedWith("VeyloAgreements: not in DRAFT");
    });

    it("reverts when the agreement is already CANCELLED", async function () {
      const id = await progressToCancelled();
      await expect(veylo.connect(client).cancel(id)).to.be.revertedWith("VeyloAgreements: not in DRAFT");
    });
  });

  // ------------------------------------------------------------------
  // acceptCriteria — every invalid starting state
  // ------------------------------------------------------------------

  describe("acceptCriteria invalid transitions", function () {
    it("reverts when the agreement is in COMMITTED", async function () {
      const id = await progressToCommitted();
      const nonce = nextNonce();
      const sig = await signAcceptance(worker, { agreementId: id, nonce });
      await expect(veylo.acceptCriteria(id, nonce, sig)).to.be.revertedWith("VeyloAgreements: not in DRAFT");
    });

    it("reverts when the agreement is in SUBMITTED", async function () {
      const id = await progressToSubmitted();
      const nonce = nextNonce();
      const sig = await signAcceptance(worker, { agreementId: id, nonce });
      await expect(veylo.acceptCriteria(id, nonce, sig)).to.be.revertedWith("VeyloAgreements: not in DRAFT");
    });

    it("reverts when the agreement is in VERIFIED", async function () {
      const id = await progressToVerified();
      const nonce = nextNonce();
      const sig = await signAcceptance(worker, { agreementId: id, nonce });
      await expect(veylo.acceptCriteria(id, nonce, sig)).to.be.revertedWith("VeyloAgreements: not in DRAFT");
    });

    it("reverts when the agreement is in NEEDS_REVIEW", async function () {
      const id = await progressToNeedsReview();
      const nonce = nextNonce();
      const sig = await signAcceptance(worker, { agreementId: id, nonce });
      await expect(veylo.acceptCriteria(id, nonce, sig)).to.be.revertedWith("VeyloAgreements: not in DRAFT");
    });

    it("reverts when the agreement is in DISPUTED", async function () {
      const id = await progressToDisputedFromVerified();
      const nonce = nextNonce();
      const sig = await signAcceptance(worker, { agreementId: id, nonce });
      await expect(veylo.acceptCriteria(id, nonce, sig)).to.be.revertedWith("VeyloAgreements: not in DRAFT");
    });

    it("reverts when the agreement is in RULED", async function () {
      const id = await progressToRuled(1);
      const nonce = nextNonce();
      const sig = await signAcceptance(worker, { agreementId: id, nonce });
      await expect(veylo.acceptCriteria(id, nonce, sig)).to.be.revertedWith("VeyloAgreements: not in DRAFT");
    });

    it("reverts when the agreement is in SETTLEMENT_AUTHORIZED", async function () {
      const id = await progressToSettlementAuthorizedFromVerified();
      const nonce = nextNonce();
      const sig = await signAcceptance(worker, { agreementId: id, nonce });
      await expect(veylo.acceptCriteria(id, nonce, sig)).to.be.revertedWith("VeyloAgreements: not in DRAFT");
    });

    it("reverts when the agreement is SETTLED", async function () {
      const id = await progressToSettled();
      const nonce = nextNonce();
      const sig = await signAcceptance(worker, { agreementId: id, nonce });
      await expect(veylo.acceptCriteria(id, nonce, sig)).to.be.revertedWith("VeyloAgreements: not in DRAFT");
    });

    it("reverts when the agreement is CANCELLED", async function () {
      const id = await progressToCancelled();
      const nonce = nextNonce();
      const sig = await signAcceptance(worker, { agreementId: id, nonce });
      await expect(veylo.acceptCriteria(id, nonce, sig)).to.be.revertedWith("VeyloAgreements: not in DRAFT");
    });
  });

  // ------------------------------------------------------------------
  // submitEvidence — every invalid starting state
  // ------------------------------------------------------------------

  describe("submitEvidence invalid transitions", function () {
    it("reverts when the agreement is in DRAFT", async function () {
      const id = await createDraftAgreement();
      await expect(veylo.connect(worker).submitEvidence(id, EVIDENCE_HASH)).to.be.revertedWith(
        "VeyloAgreements: not in COMMITTED"
      );
    });

    it("reverts when the agreement is in SUBMITTED", async function () {
      const id = await progressToSubmitted();
      await expect(veylo.connect(worker).submitEvidence(id, EVIDENCE_HASH)).to.be.revertedWith(
        "VeyloAgreements: not in COMMITTED"
      );
    });

    it("reverts when the agreement is in VERIFIED", async function () {
      const id = await progressToVerified();
      await expect(veylo.connect(worker).submitEvidence(id, EVIDENCE_HASH)).to.be.revertedWith(
        "VeyloAgreements: not in COMMITTED"
      );
    });

    it("reverts when the agreement is in NEEDS_REVIEW", async function () {
      const id = await progressToNeedsReview();
      await expect(veylo.connect(worker).submitEvidence(id, EVIDENCE_HASH)).to.be.revertedWith(
        "VeyloAgreements: not in COMMITTED"
      );
    });

    it("reverts when the agreement is in DISPUTED", async function () {
      const id = await progressToDisputedFromVerified();
      await expect(veylo.connect(worker).submitEvidence(id, EVIDENCE_HASH)).to.be.revertedWith(
        "VeyloAgreements: not in COMMITTED"
      );
    });

    it("reverts when the agreement is in RULED", async function () {
      const id = await progressToRuled(1);
      await expect(veylo.connect(worker).submitEvidence(id, EVIDENCE_HASH)).to.be.revertedWith(
        "VeyloAgreements: not in COMMITTED"
      );
    });

    it("reverts when the agreement is in SETTLEMENT_AUTHORIZED", async function () {
      const id = await progressToSettlementAuthorizedFromVerified();
      await expect(veylo.connect(worker).submitEvidence(id, EVIDENCE_HASH)).to.be.revertedWith(
        "VeyloAgreements: not in COMMITTED"
      );
    });

    it("reverts when the agreement is SETTLED", async function () {
      const id = await progressToSettled();
      await expect(veylo.connect(worker).submitEvidence(id, EVIDENCE_HASH)).to.be.revertedWith(
        "VeyloAgreements: not in COMMITTED"
      );
    });

    it("reverts when the agreement is CANCELLED", async function () {
      const id = await progressToCancelled();
      await expect(veylo.connect(worker).submitEvidence(id, EVIDENCE_HASH)).to.be.revertedWith(
        "VeyloAgreements: not in COMMITTED"
      );
    });
  });

  // ------------------------------------------------------------------
  // recordVerification — every invalid starting state
  // ------------------------------------------------------------------

  describe("recordVerification invalid transitions", function () {
    it("reverts when the agreement is in DRAFT", async function () {
      const id = await createDraftAgreement();
      await expect(
        veylo.connect(validator).recordVerification(id, RESULTS_HASH, Outcome.ACCEPT)
      ).to.be.revertedWith("VeyloAgreements: not in SUBMITTED");
    });

    it("reverts when the agreement is in COMMITTED", async function () {
      const id = await progressToCommitted();
      await expect(
        veylo.connect(validator).recordVerification(id, RESULTS_HASH, Outcome.ACCEPT)
      ).to.be.revertedWith("VeyloAgreements: not in SUBMITTED");
    });

    it("reverts when the agreement is in VERIFIED", async function () {
      const id = await progressToVerified();
      await expect(
        veylo.connect(validator).recordVerification(id, RESULTS_HASH, Outcome.ACCEPT)
      ).to.be.revertedWith("VeyloAgreements: not in SUBMITTED");
    });

    it("reverts when the agreement is in NEEDS_REVIEW", async function () {
      const id = await progressToNeedsReview();
      await expect(
        veylo.connect(validator).recordVerification(id, RESULTS_HASH, Outcome.ACCEPT)
      ).to.be.revertedWith("VeyloAgreements: not in SUBMITTED");
    });

    it("reverts when the agreement is in DISPUTED", async function () {
      const id = await progressToDisputedFromVerified();
      await expect(
        veylo.connect(validator).recordVerification(id, RESULTS_HASH, Outcome.ACCEPT)
      ).to.be.revertedWith("VeyloAgreements: not in SUBMITTED");
    });

    it("reverts when the agreement is in RULED", async function () {
      const id = await progressToRuled(1);
      await expect(
        veylo.connect(validator).recordVerification(id, RESULTS_HASH, Outcome.ACCEPT)
      ).to.be.revertedWith("VeyloAgreements: not in SUBMITTED");
    });

    it("reverts when the agreement is in SETTLEMENT_AUTHORIZED", async function () {
      const id = await progressToSettlementAuthorizedFromVerified();
      await expect(
        veylo.connect(validator).recordVerification(id, RESULTS_HASH, Outcome.ACCEPT)
      ).to.be.revertedWith("VeyloAgreements: not in SUBMITTED");
    });

    it("reverts when the agreement is SETTLED", async function () {
      const id = await progressToSettled();
      await expect(
        veylo.connect(validator).recordVerification(id, RESULTS_HASH, Outcome.ACCEPT)
      ).to.be.revertedWith("VeyloAgreements: not in SUBMITTED");
    });

    it("reverts when the agreement is CANCELLED", async function () {
      const id = await progressToCancelled();
      await expect(
        veylo.connect(validator).recordVerification(id, RESULTS_HASH, Outcome.ACCEPT)
      ).to.be.revertedWith("VeyloAgreements: not in SUBMITTED");
    });
  });

  // ------------------------------------------------------------------
  // clientDecision — every invalid starting state
  // ------------------------------------------------------------------

  describe("clientDecision invalid transitions", function () {
    it("reverts when the agreement is in DRAFT", async function () {
      const id = await createDraftAgreement();
      await expect(veylo.connect(client).clientDecision(id, Outcome.ACCEPT)).to.be.revertedWith(
        "VeyloAgreements: not in NEEDS_REVIEW"
      );
    });

    it("reverts when the agreement is in COMMITTED", async function () {
      const id = await progressToCommitted();
      await expect(veylo.connect(client).clientDecision(id, Outcome.ACCEPT)).to.be.revertedWith(
        "VeyloAgreements: not in NEEDS_REVIEW"
      );
    });

    it("reverts when the agreement is in SUBMITTED", async function () {
      const id = await progressToSubmitted();
      await expect(veylo.connect(client).clientDecision(id, Outcome.ACCEPT)).to.be.revertedWith(
        "VeyloAgreements: not in NEEDS_REVIEW"
      );
    });

    it("reverts when the agreement is in VERIFIED", async function () {
      const id = await progressToVerified();
      await expect(veylo.connect(client).clientDecision(id, Outcome.ACCEPT)).to.be.revertedWith(
        "VeyloAgreements: not in NEEDS_REVIEW"
      );
    });

    it("reverts when the agreement is in DISPUTED", async function () {
      const id = await progressToDisputedFromVerified();
      await expect(veylo.connect(client).clientDecision(id, Outcome.ACCEPT)).to.be.revertedWith(
        "VeyloAgreements: not in NEEDS_REVIEW"
      );
    });

    it("reverts when the agreement is in RULED", async function () {
      const id = await progressToRuled(1);
      await expect(veylo.connect(client).clientDecision(id, Outcome.ACCEPT)).to.be.revertedWith(
        "VeyloAgreements: not in NEEDS_REVIEW"
      );
    });

    it("reverts when the agreement is in SETTLEMENT_AUTHORIZED", async function () {
      const id = await progressToSettlementAuthorizedFromVerified();
      await expect(veylo.connect(client).clientDecision(id, Outcome.ACCEPT)).to.be.revertedWith(
        "VeyloAgreements: not in NEEDS_REVIEW"
      );
    });

    it("reverts when the agreement is SETTLED", async function () {
      const id = await progressToSettled();
      await expect(veylo.connect(client).clientDecision(id, Outcome.ACCEPT)).to.be.revertedWith(
        "VeyloAgreements: not in NEEDS_REVIEW"
      );
    });

    it("reverts when the agreement is CANCELLED", async function () {
      const id = await progressToCancelled();
      await expect(veylo.connect(client).clientDecision(id, Outcome.ACCEPT)).to.be.revertedWith(
        "VeyloAgreements: not in NEEDS_REVIEW"
      );
    });
  });

  // ------------------------------------------------------------------
  // raiseDispute — every invalid starting state
  // ------------------------------------------------------------------

  describe("raiseDispute invalid transitions", function () {
    it("reverts when the agreement is in DRAFT", async function () {
      const id = await createDraftAgreement();
      await expect(
        veylo.connect(client).raiseDispute(id, { value: ARBITRATION_COST })
      ).to.be.revertedWith("VeyloAgreements: not in VERIFIED or NEEDS_REVIEW");
    });

    it("reverts when the agreement is in COMMITTED", async function () {
      const id = await progressToCommitted();
      await expect(
        veylo.connect(worker).raiseDispute(id, { value: ARBITRATION_COST })
      ).to.be.revertedWith("VeyloAgreements: not in VERIFIED or NEEDS_REVIEW");
    });

    it("reverts when the agreement is in SUBMITTED", async function () {
      const id = await progressToSubmitted();
      await expect(
        veylo.connect(worker).raiseDispute(id, { value: ARBITRATION_COST })
      ).to.be.revertedWith("VeyloAgreements: not in VERIFIED or NEEDS_REVIEW");
    });

    it("reverts when the agreement is already DISPUTED", async function () {
      const id = await progressToDisputedFromVerified();
      await expect(
        veylo.connect(client).raiseDispute(id, { value: ARBITRATION_COST })
      ).to.be.revertedWith("VeyloAgreements: not in VERIFIED or NEEDS_REVIEW");
    });

    it("reverts when the agreement is in RULED", async function () {
      const id = await progressToRuled(1);
      await expect(
        veylo.connect(client).raiseDispute(id, { value: ARBITRATION_COST })
      ).to.be.revertedWith("VeyloAgreements: not in VERIFIED or NEEDS_REVIEW");
    });

    it("reverts when the agreement is in SETTLEMENT_AUTHORIZED", async function () {
      const id = await progressToSettlementAuthorizedFromVerified();
      await expect(
        veylo.connect(client).raiseDispute(id, { value: ARBITRATION_COST })
      ).to.be.revertedWith("VeyloAgreements: not in VERIFIED or NEEDS_REVIEW");
    });

    it("reverts when the agreement is SETTLED", async function () {
      const id = await progressToSettled();
      await expect(
        veylo.connect(client).raiseDispute(id, { value: ARBITRATION_COST })
      ).to.be.revertedWith("VeyloAgreements: not in VERIFIED or NEEDS_REVIEW");
    });

    it("reverts when the agreement is CANCELLED", async function () {
      const id = await progressToCancelled();
      await expect(
        veylo.connect(client).raiseDispute(id, { value: ARBITRATION_COST })
      ).to.be.revertedWith("VeyloAgreements: not in VERIFIED or NEEDS_REVIEW");
    });
  });
});
