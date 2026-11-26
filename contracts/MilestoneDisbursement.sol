// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./AccessControlBase.sol";
import "./interfaces/IProjectRegistry.sol";
import "./interfaces/IDonationVault.sol";

/// @title MilestoneDisbursement
/// @notice The payment workflow. An NGO submits a payment request (milestone) with
///         evidence, an auditor approves or rejects it, the NGO releases it, and the
///         beneficiary confirms receipt. Holds no money: the vault pays directly.
/// @dev Life cycle:
///        Submitted -> Approved -> Released -> Confirmed
///        Submitted -> Rejected
///        Approved  -> Cancelled
///      Talks to the registry and vault only through their interfaces. The vault
///      repeats the important checks itself, so a bug here cannot misdirect money.
///      The full evidence CID is published in MilestoneSubmitted; storage keeps only
///      its keccak256 hash (gas optimization), so the CID can be checked but not swapped.
contract MilestoneDisbursement is AccessControlBase {
    enum MilestoneStatus {
        None,
        Submitted,
        Approved,
        Rejected,
        Released,
        Cancelled,
        Confirmed
    }

    /// @notice One payment request to one beneficiary.
    /// @dev Gas: packed into 4 slots instead of 6 + a 3-slot string. reviewedBy shares a
    ///      slot with campaignId, so recording the auditor later overwrites a non-empty
    ///      slot, which is far cheaper than filling an empty one.
    struct Milestone {
        address beneficiary; // slot 0
        MilestoneStatus status; // slot 0
        uint40 submittedAt; // slot 0
        address reviewedBy; // slot 1; auditor who approved or rejected it
        uint96 campaignId; // slot 1
        uint256 amount; // slot 2; in token units (MockUSDC has 6 decimals)
        bytes32 evidenceHash; // slot 3; keccak256 of the evidence CID (full CID is in the event)
    }

    IProjectRegistry public immutable registry;
    IDonationVault public immutable vault;

    /// @notice Id the next milestone will get. Ids start at 1; 0 never exists.
    uint256 public nextMilestoneId = 1;

    mapping(uint256 => Milestone) private milestones;

    /// @notice The only place the full evidence CID is published.
    event MilestoneSubmitted(
        uint256 indexed milestoneId,
        uint256 indexed campaignId,
        address indexed beneficiary,
        uint256 amount,
        string evidenceCID
    );
    event MilestoneApproved(uint256 indexed milestoneId, address indexed auditor);
    event MilestoneRejected(uint256 indexed milestoneId, address indexed auditor);
    event MilestoneCancelled(uint256 indexed milestoneId, address indexed auditor);
    event MilestoneReleased(
        uint256 indexed milestoneId,
        address indexed beneficiary,
        uint256 amount
    );
    event ReceiptConfirmed(uint256 indexed milestoneId, address indexed beneficiary);

    error ZeroAmount();
    error EmptyEvidenceCID();
    error CampaignNotActive(uint256 campaignId);
    error NotCampaignNgo(uint256 campaignId, address caller);
    error BeneficiaryNotEligible(uint256 campaignId, address beneficiary);
    error InvalidMilestoneStatus(uint256 milestoneId, MilestoneStatus current);
    error ApproverIsCampaignNgo(uint256 milestoneId);
    error ApproverIsBeneficiary(uint256 milestoneId);
    error NotMilestoneBeneficiary(uint256 milestoneId, address caller);

    /// @param accessAddress   Deployed GiveChainAccess.
    /// @param registryAddress Deployed ProjectRegistry.
    /// @param vaultAddress    Deployed DonationVault.
    constructor(address accessAddress, address registryAddress, address vaultAddress)
        AccessControlBase(accessAddress)
    {
        if (registryAddress == address(0) || vaultAddress == address(0)) revert ZeroAddress();
        registry = IProjectRegistry(registryAddress);
        vault = IDonationVault(vaultAddress);
    }

    // ------------------------------------------------------------------
    // NGO
    // ------------------------------------------------------------------

    /// @notice Requests a payment from the caller's campaign to an approved beneficiary.
    /// @dev Money is not checked here because donations may still arrive; it is
    ///      checked and reserved when an auditor approves.
    /// @param evidenceCID IPFS CID of the supporting documents. Must not be empty.
    /// @return milestoneId The new milestone's id.
    function submitMilestone(
        uint256 campaignId,
        address beneficiary,
        uint256 amount,
        string calldata evidenceCID
    ) external onlyRole(Roles.NGO_ROLE) whenNotPaused returns (uint256 milestoneId) {
        if (registry.campaignStatus(campaignId) != IProjectRegistry.CampaignStatus.Active) {
            revert CampaignNotActive(campaignId);
        }
        if (registry.campaignNgo(campaignId) != msg.sender) {
            revert NotCampaignNgo(campaignId, msg.sender);
        }
        if (amount == 0) revert ZeroAmount();
        if (bytes(evidenceCID).length == 0) revert EmptyEvidenceCID();
        if (!registry.isBeneficiaryEligible(campaignId, beneficiary)) {
            revert BeneficiaryNotEligible(campaignId, beneficiary);
        }

        milestoneId = nextMilestoneId;
        nextMilestoneId = milestoneId + 1;

        milestones[milestoneId] = Milestone({
            beneficiary: beneficiary,
            status: MilestoneStatus.Submitted,
            submittedAt: uint40(block.timestamp),
            reviewedBy: address(0),
            campaignId: SafeCast.toUint96(campaignId),
            amount: amount,
            evidenceHash: keccak256(bytes(evidenceCID))
        });

        emit MilestoneSubmitted(milestoneId, campaignId, beneficiary, amount, evidenceCID);
    }

    /// @notice Pays an approved milestone: the vault sends the money straight to the beneficiary.
    /// @dev Only the campaign's own NGO. The vault re-checks eligibility and duplicates.
    function releaseMilestone(uint256 milestoneId)
        external
        onlyRole(Roles.NGO_ROLE)
        whenNotPaused
        nonReentrant
    {
        Milestone storage milestone = _requireStatus(milestoneId, MilestoneStatus.Approved);
        if (registry.campaignNgo(milestone.campaignId) != msg.sender) {
            revert NotCampaignNgo(milestone.campaignId, msg.sender);
        }

        milestone.status = MilestoneStatus.Released;
        vault.releaseFunds(milestoneId);

        emit MilestoneReleased(milestoneId, milestone.beneficiary, milestone.amount);
    }

    // ------------------------------------------------------------------
    // Auditor
    // ------------------------------------------------------------------

    /// @notice Approves a submitted milestone after checking its evidence, and reserves
    ///         the campaign's money for it.
    /// @dev Fails if the campaign lacks available money or the beneficiary is no longer
    ///      eligible (both checked by the vault).
    function approveMilestone(uint256 milestoneId)
        external
        onlyRole(Roles.AUDITOR_ROLE)
        whenNotPaused
        nonReentrant
    {
        Milestone storage milestone = _requireStatus(milestoneId, MilestoneStatus.Submitted);
        if (registry.campaignNgo(milestone.campaignId) == msg.sender) {
            revert ApproverIsCampaignNgo(milestoneId);
        }
        if (milestone.beneficiary == msg.sender) revert ApproverIsBeneficiary(milestoneId);

        milestone.status = MilestoneStatus.Approved;
        milestone.reviewedBy = msg.sender;
        vault.reserveFunds(
            milestone.campaignId,
            milestoneId,
            milestone.beneficiary,
            milestone.amount
        );

        emit MilestoneApproved(milestoneId, msg.sender);
    }

    /// @notice Rejects a submitted milestone (for example, the evidence is not convincing).
    function rejectMilestone(uint256 milestoneId)
        external
        onlyRole(Roles.AUDITOR_ROLE)
        whenNotPaused
    {
        Milestone storage milestone = _requireStatus(milestoneId, MilestoneStatus.Submitted);

        milestone.status = MilestoneStatus.Rejected;
        milestone.reviewedBy = msg.sender;

        emit MilestoneRejected(milestoneId, msg.sender);
    }

    /// @notice Cancels an approved milestone before it is paid and frees its reserved money.
    /// @dev For example, when the beneficiary turned out to be ineligible after approval.
    function cancelMilestone(uint256 milestoneId)
        external
        onlyRole(Roles.AUDITOR_ROLE)
        whenNotPaused
        nonReentrant
    {
        Milestone storage milestone = _requireStatus(milestoneId, MilestoneStatus.Approved);

        milestone.status = MilestoneStatus.Cancelled;
        vault.cancelReservation(milestoneId);

        emit MilestoneCancelled(milestoneId, msg.sender);
    }

    // ------------------------------------------------------------------
    // Beneficiary
    // ------------------------------------------------------------------

    /// @notice The beneficiary confirms the assistance arrived.
    function confirmReceipt(uint256 milestoneId) external whenNotPaused {
        Milestone storage milestone = _requireStatus(milestoneId, MilestoneStatus.Released);
        if (milestone.beneficiary != msg.sender) {
            revert NotMilestoneBeneficiary(milestoneId, msg.sender);
        }

        milestone.status = MilestoneStatus.Confirmed;

        emit ReceiptConfirmed(milestoneId, msg.sender);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Full record of a milestone (all zero if it does not exist).
    function getMilestone(uint256 milestoneId) external view returns (Milestone memory) {
        return milestones[milestoneId];
    }

    /// @notice Number of milestones submitted so far.
    function milestoneCount() external view returns (uint256) {
        return nextMilestoneId - 1;
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _requireStatus(uint256 milestoneId, MilestoneStatus expected)
        internal
        view
        returns (Milestone storage milestone)
    {
        milestone = milestones[milestoneId];
        if (milestone.status != expected) {
            revert InvalidMilestoneStatus(milestoneId, milestone.status);
        }
    }
}
