// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/IArbitrator.sol";
import "./interfaces/IArbitrable.sol";

/**
 * @title VeyloAgreements
 * @dev Two-party signed criteria commitments and the Veylo agreement state
 * machine. Amounts are recorded only — nothing moves on-chain. Clients and
 * workers sign EIP-712 typed data; the platform (or anyone) relays the
 * transaction and pays gas.
 */
contract VeyloAgreements is EIP712, IArbitrable {
    enum Status {
        DRAFT,
        COMMITTED,
        SUBMITTED,
        VERIFIED,
        NEEDS_REVIEW,
        DISPUTED,
        RULED,
        SETTLEMENT_AUTHORIZED,
        SETTLED,
        CANCELLED
    }

    enum Outcome {
        NONE,
        ACCEPT,
        REJECT
    }

    struct Agreement {
        address client;
        address worker;
        uint256 amountMinor; // recorded only. NOTHING moves on-chain.
        bytes32 criteriaHash;
        bytes32 evidenceHash;
        bytes32 resultsHash;
        bytes32 rulingHash;
        bytes32 settlementRef;
        uint64 deadline;
        uint64 reviewWindowEnds;
        Status status;
        Outcome outcome;
        uint256 disputeId;
    }

    uint64 public constant REVIEW_WINDOW = 3 days;

    bytes32 private constant CRITERIA_COMMITMENT_TYPEHASH =
        keccak256("CriteriaCommitment(address worker,uint256 amountMinor,bytes32 criteriaHash,uint64 deadline,uint256 nonce)");
    bytes32 private constant CRITERIA_ACCEPTANCE_TYPEHASH =
        keccak256("CriteriaAcceptance(uint256 agreementId,bytes32 criteriaHash,uint256 nonce)");

    address public immutable validator;
    IArbitrator public immutable arbitrator;

    uint256 public nextAgreementId = 1;
    mapping(uint256 => Agreement) private agreements;
    mapping(address => mapping(uint256 => bool)) public usedNonces;
    mapping(uint256 => uint256) public disputeIdToAgreementId;

    event AgreementCreated(
        uint256 indexed agreementId,
        address indexed client,
        address indexed worker,
        uint256 amountMinor,
        bytes32 criteriaHash,
        uint64 deadline
    );
    event CriteriaAccepted(uint256 indexed agreementId);
    event EvidenceSubmitted(uint256 indexed agreementId, bytes32 evidenceHash);
    event VerificationRecorded(uint256 indexed agreementId, bytes32 resultsHash, Outcome automated, Status status);
    event ClientDecided(uint256 indexed agreementId, Outcome outcome);
    event DisputeRaised(uint256 indexed agreementId, uint256 indexed disputeId);
    event Ruled(uint256 indexed agreementId, uint256 indexed disputeId, uint256 ruling);
    event Finalized(uint256 indexed agreementId);
    event SettlementConfirmed(uint256 indexed agreementId, bytes32 settlementRef);
    event AgreementCancelled(uint256 indexed agreementId);

    modifier onlyValidator() {
        require(msg.sender == validator, "VeyloAgreements: caller is not the validator");
        _;
    }

    constructor(address _validator, address _arbitrator) EIP712("Veylo", "1") {
        require(_validator != address(0), "VeyloAgreements: validator is zero address");
        require(_arbitrator != address(0), "VeyloAgreements: arbitrator is zero address");
        validator = _validator;
        arbitrator = IArbitrator(_arbitrator);
    }

    /**
     * @dev Recovers the signer of clientSig over CriteriaCommitment and
     * records it as the client. May be relayed by anyone — the signature
     * determines the client, not msg.sender.
     */
    function createAgreement(
        address worker,
        uint256 amountMinor,
        bytes32 criteriaHash,
        uint64 deadline,
        uint256 nonce,
        bytes calldata clientSig
    ) external returns (uint256 agreementId) {
        require(worker != address(0), "VeyloAgreements: worker is zero address");
        require(deadline > block.timestamp, "VeyloAgreements: deadline must be in the future");
        require(criteriaHash != bytes32(0), "VeyloAgreements: criteriaHash is zero");

        bytes32 structHash = keccak256(
            abi.encode(CRITERIA_COMMITMENT_TYPEHASH, worker, amountMinor, criteriaHash, deadline, nonce)
        );
        address client = ECDSA.recover(_hashTypedDataV4(structHash), clientSig);

        require(worker != client, "VeyloAgreements: worker cannot be the client");
        require(!usedNonces[client][nonce], "VeyloAgreements: nonce already used");
        usedNonces[client][nonce] = true;

        agreementId = nextAgreementId++;
        Agreement storage agreement = agreements[agreementId];
        agreement.client = client;
        agreement.worker = worker;
        agreement.amountMinor = amountMinor;
        agreement.criteriaHash = criteriaHash;
        agreement.deadline = deadline;
        agreement.status = Status.DRAFT;

        emit AgreementCreated(agreementId, client, worker, amountMinor, criteriaHash, deadline);
    }

    /**
     * @dev Recovers the signer over CriteriaAcceptance, hashed against the
     * agreement's own stored criteriaHash (never a caller-supplied one), so
     * the recovered signature can only ever match if it committed to exactly
     * that hash.
     */
    function acceptCriteria(uint256 id, uint256 nonce, bytes calldata workerSig) external {
        Agreement storage agreement = agreements[id];
        require(agreement.status == Status.DRAFT, "VeyloAgreements: not in DRAFT");

        bytes32 structHash = keccak256(
            abi.encode(CRITERIA_ACCEPTANCE_TYPEHASH, id, agreement.criteriaHash, nonce)
        );
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), workerSig);

        require(signer == agreement.worker, "VeyloAgreements: signature is not the worker's");
        require(!usedNonces[signer][nonce], "VeyloAgreements: nonce already used");
        usedNonces[signer][nonce] = true;

        agreement.status = Status.COMMITTED;

        emit CriteriaAccepted(id);
    }

    function submitEvidence(uint256 id, bytes32 evidenceHash) external {
        Agreement storage agreement = agreements[id];
        require(agreement.status == Status.COMMITTED, "VeyloAgreements: not in COMMITTED");
        require(msg.sender == agreement.worker, "VeyloAgreements: caller is not the worker");
        require(block.timestamp < agreement.deadline, "VeyloAgreements: deadline has passed");

        agreement.evidenceHash = evidenceHash;
        agreement.status = Status.SUBMITTED;

        emit EvidenceSubmitted(id, evidenceHash);
    }

    function recordVerification(uint256 id, bytes32 resultsHash, Outcome automated) external onlyValidator {
        Agreement storage agreement = agreements[id];
        require(agreement.status == Status.SUBMITTED, "VeyloAgreements: not in SUBMITTED");

        agreement.resultsHash = resultsHash;
        agreement.reviewWindowEnds = uint64(block.timestamp) + REVIEW_WINDOW;

        if (automated == Outcome.ACCEPT || automated == Outcome.REJECT) {
            agreement.outcome = automated;
            agreement.status = Status.VERIFIED;
        } else {
            agreement.status = Status.NEEDS_REVIEW;
        }

        emit VerificationRecorded(id, resultsHash, automated, agreement.status);
    }

    function clientDecision(uint256 id, Outcome outcome) external {
        Agreement storage agreement = agreements[id];
        require(agreement.status == Status.NEEDS_REVIEW, "VeyloAgreements: not in NEEDS_REVIEW");
        require(msg.sender == agreement.client, "VeyloAgreements: caller is not the client");
        require(block.timestamp < agreement.reviewWindowEnds, "VeyloAgreements: review window has ended");
        require(
            outcome == Outcome.ACCEPT || outcome == Outcome.REJECT,
            "VeyloAgreements: outcome must be ACCEPT or REJECT"
        );

        agreement.outcome = outcome;
        agreement.status = Status.VERIFIED;

        emit ClientDecided(id, outcome);
    }

    function raiseDispute(uint256 id) external payable {
        Agreement storage agreement = agreements[id];
        require(
            agreement.status == Status.VERIFIED || agreement.status == Status.NEEDS_REVIEW,
            "VeyloAgreements: not in VERIFIED or NEEDS_REVIEW"
        );
        require(
            msg.sender == agreement.client || msg.sender == agreement.worker,
            "VeyloAgreements: caller is not a party"
        );
        require(block.timestamp < agreement.reviewWindowEnds, "VeyloAgreements: review window has ended");

        agreement.status = Status.DISPUTED;

        uint256 disputeId = arbitrator.createDispute{value: msg.value}(2, "");
        agreement.disputeId = disputeId;
        disputeIdToAgreementId[disputeId] = id;

        emit DisputeRaised(id, disputeId);
    }

    /// @inheritdoc IArbitrable
    function rule(uint256 _disputeID, uint256 _ruling) external override {
        require(msg.sender == address(arbitrator), "VeyloAgreements: caller is not the arbitrator");

        uint256 id = disputeIdToAgreementId[_disputeID];
        Agreement storage agreement = agreements[id];
        require(agreement.status == Status.DISPUTED, "VeyloAgreements: not in DISPUTED");

        agreement.outcome = _ruling == 1 ? Outcome.ACCEPT : Outcome.REJECT;
        agreement.status = Status.RULED;

        emit Ruling(arbitrator, _disputeID, _ruling);
        emit Ruled(id, _disputeID, _ruling);
    }

    function finalize(uint256 id) external {
        Agreement storage agreement = agreements[id];
        if (agreement.status == Status.VERIFIED) {
            require(block.timestamp >= agreement.reviewWindowEnds, "VeyloAgreements: review window has not ended");
        } else {
            require(agreement.status == Status.RULED, "VeyloAgreements: not in VERIFIED or RULED");
        }

        agreement.status = Status.SETTLEMENT_AUTHORIZED;

        emit Finalized(id);
    }

    function confirmSettlement(uint256 id, bytes32 settlementRef) external onlyValidator {
        Agreement storage agreement = agreements[id];
        require(agreement.status == Status.SETTLEMENT_AUTHORIZED, "VeyloAgreements: not in SETTLEMENT_AUTHORIZED");
        require(settlementRef != bytes32(0), "VeyloAgreements: settlementRef is zero");

        agreement.settlementRef = settlementRef;
        agreement.status = Status.SETTLED;

        emit SettlementConfirmed(id, settlementRef);
    }

    function cancel(uint256 id) external {
        Agreement storage agreement = agreements[id];
        require(agreement.status == Status.DRAFT, "VeyloAgreements: not in DRAFT");
        require(msg.sender == agreement.client, "VeyloAgreements: caller is not the client");

        agreement.status = Status.CANCELLED;

        emit AgreementCancelled(id);
    }

    function getAgreement(uint256 id) external view returns (Agreement memory) {
        return agreements[id];
    }
}
