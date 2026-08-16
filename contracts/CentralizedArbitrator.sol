// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./interfaces/IArbitrator.sol";
import "./interfaces/IArbitrable.sol";

/**
 * @title CentralizedArbitrator
 * @dev This is the arbitrator Kleros's own documentation recommends deploying
 * to test an arbitrable app (see kleros/kleros-interaction's
 * CentralizedArbitrator.sol, the pattern this contract follows, ported to the
 * current ERC-792 interfaces). A single owner-controlled address rules on
 * every dispute directly, with no appeals. Production would point Veylo at
 * Kleros Court instead of this contract.
 */
contract CentralizedArbitrator is IArbitrator {
    // Deliberately unaffordable so that appeal() can never practically succeed
    // — this arbitrator supports no appeals, matching Kleros's own
    // CentralizedArbitrator reference.
    uint256 private constant NOT_PAYABLE_VALUE = 2 ** 250;

    struct Dispute {
        IArbitrable arbitrated;
        uint256 choices;
        uint256 ruling;
        DisputeStatus status;
    }

    address public immutable owner;
    uint256 private immutable fixedArbitrationCost;

    Dispute[] public disputes;

    modifier onlyOwner() {
        require(msg.sender == owner, "CentralizedArbitrator: caller is not the owner");
        _;
    }

    constructor(uint256 _arbitrationCost) {
        owner = msg.sender;
        fixedArbitrationCost = _arbitrationCost;
    }

    /// @inheritdoc IArbitrator
    function createDispute(
        uint256 _choices,
        bytes calldata _extraData
    ) external payable override returns (uint256 disputeID) {
        require(msg.value >= fixedArbitrationCost, "CentralizedArbitrator: insufficient arbitration fee");

        disputes.push(
            Dispute({arbitrated: IArbitrable(msg.sender), choices: _choices, ruling: 0, status: DisputeStatus.Waiting})
        );
        disputeID = disputes.length - 1;

        emit DisputeCreation(disputeID, IArbitrable(msg.sender));
    }

    /// @inheritdoc IArbitrator
    function arbitrationCost(bytes calldata) external view override returns (uint256 cost) {
        return fixedArbitrationCost;
    }

    /// @inheritdoc IArbitrator
    function appeal(uint256, bytes calldata) external payable override {
        require(msg.value >= NOT_PAYABLE_VALUE, "CentralizedArbitrator: appeals are not supported");
    }

    /// @inheritdoc IArbitrator
    function appealCost(uint256, bytes calldata) external pure override returns (uint256 cost) {
        return NOT_PAYABLE_VALUE;
    }

    /// @inheritdoc IArbitrator
    function appealPeriod(uint256) external pure override returns (uint256 start, uint256 end) {
        return (0, 0);
    }

    /// @inheritdoc IArbitrator
    function disputeStatus(uint256 _disputeID) external view override returns (DisputeStatus status) {
        return disputes[_disputeID].status;
    }

    /// @inheritdoc IArbitrator
    function currentRuling(uint256 _disputeID) external view override returns (uint256 ruling) {
        return disputes[_disputeID].ruling;
    }

    /**
     * @dev Give a ruling for a dispute. Only the owner may call this. Calls
     * back into the arbitrated (arbitrable) contract's rule() function.
     * @param _disputeID ID of the dispute to rule.
     * @param _ruling Ruling given by the arbitrator. 0 is reserved for
     * "refused to rule".
     */
    function giveRuling(uint256 _disputeID, uint256 _ruling) external onlyOwner {
        Dispute storage dispute = disputes[_disputeID];
        require(_ruling <= dispute.choices, "CentralizedArbitrator: ruling out of range");
        require(dispute.status != DisputeStatus.Solved, "CentralizedArbitrator: dispute already solved");

        dispute.ruling = _ruling;
        dispute.status = DisputeStatus.Solved;

        dispute.arbitrated.rule(_disputeID, _ruling);
    }
}
