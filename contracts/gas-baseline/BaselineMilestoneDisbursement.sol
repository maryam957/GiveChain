// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// GAS BASELINE SNAPSHOT - not deployed, not used by the app.
// Exact copy of the Phase 2 contract (renamed with a "Baseline" prefix), kept so
// scripts/gas-benchmark.js can measure the optimized contracts against it under
// identical conditions. See docs/GiveChain-Gas-Sheet.md.

import "./BaselineAccessControlBase.sol";
import "../interfaces/IProjectRegistry.sol";
import "../interfaces/IDonationVault.sol";

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
contract BaselineMilestoneDisbursement is BaselineAccessControlBase {
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
    struct Milestone {
        uint256 campaignId;
        address beneficiary;
        uint256 amount; // in token units (MockUSDC has 6 decimals)
        string evidenceCID; // IPFS CID of receipts, photos or other supporting documents
        MilestoneStatus status;
        uint256 submittedAt;
        address reviewedBy; // auditor who approved or rejected it
    }

    IProjectRegistry public registry;
    IDonationVault public vault;

    /// @notice Id the next milestone will get. Ids start at 1; 0 never exists.
    uint256 public nextMilestoneId = 1;

    mapping(uint256 => Milestone) private milestones;

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
        BaselineAccessControlBase(accessAddress)
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
            campaignId: campaignId,
            beneficiary: beneficiary,
            amount: amount,
            evidenceCID: evidenceCID,
            status: MilestoneStatus.Submitted,
            submittedAt: block.timestamp,
            reviewedBy: address(0)
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
