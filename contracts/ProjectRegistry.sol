// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AccessControlBase.sol";
import "./interfaces/IProjectRegistry.sol";

/// @title ProjectRegistry
/// @notice Stores campaigns and their beneficiaries. Holds no money.
/// @dev Campaign details (title, description, images) live on IPFS. The full CID is
///      published in the CampaignCreated event, and only its keccak256 hash is kept in
///      storage (gas optimization): anyone can check a CID from the event against the
///      stored hash. Beneficiaries are stored as a wallet plus an
///      identity commitment: keccak256(salt, national ID) computed off-chain,
///      so duplicates can be blocked without putting personal data on-chain.
contract ProjectRegistry is AccessControlBase, IProjectRegistry {
    /// @notice On-chain record of a campaign.
    /// @dev Gas: ngo, status and createdAt are packed into one 32-byte storage slot
    ///      (20 + 1 + 5 bytes). uint40 timestamps last until the year 36,812.
    struct Campaign {
        address ngo; // slot 0
        CampaignStatus status; // slot 0
        uint40 createdAt; // slot 0
        uint256 targetAmount; // slot 1; in token units (MockUSDC has 6 decimals); informational
        bytes32 metadataHash; // slot 2; keccak256 of the IPFS CID (full CID is in CampaignCreated)
    }

    /// @notice On-chain record of a beneficiary within one campaign.
    struct Beneficiary {
        bytes32 identityCommitment;
        BeneficiaryStatus status;
    }

    /// @notice Id the next campaign will get. Ids start at 1; 0 never exists.
    uint256 public nextCampaignId = 1;

    mapping(uint256 => Campaign) private campaigns;
    mapping(uint256 => mapping(address => Beneficiary)) private beneficiaries;

    /// @notice True if an identity commitment is already used in a campaign.
    mapping(uint256 => mapping(bytes32 => bool)) public identityUsed;

    /// @notice The only place the full metadata CID is published.
    event CampaignCreated(
        uint256 indexed campaignId,
        address indexed ngo,
        uint256 targetAmount,
        string metadataCID
    );
    event CampaignStatusChanged(
        uint256 indexed campaignId,
        CampaignStatus newStatus,
        address indexed changedBy
    );
    event BeneficiaryRegistered(
        uint256 indexed campaignId,
        address indexed wallet,
        bytes32 identityCommitment
    );
    event BeneficiaryStatusChanged(
        uint256 indexed campaignId,
        address indexed wallet,
        BeneficiaryStatus newStatus,
        address indexed changedBy
    );

    error InvalidTarget();
    error EmptyMetadataCID();
    error CampaignNotActive(uint256 campaignId);
    error NotCampaignNgo(uint256 campaignId, address caller);
    error NotAllowedToCancel(uint256 campaignId, address caller);
    error InvalidIdentityCommitment();
    error BeneficiaryAlreadyRegistered(uint256 campaignId, address wallet);
    error IdentityAlreadyUsed(uint256 campaignId, bytes32 identityCommitment);
    error NgoCannotBeBeneficiary(uint256 campaignId);
    error AuditorCannotApproveSelf();
    error InvalidBeneficiaryStatus(
        uint256 campaignId,
        address wallet,
        BeneficiaryStatus current
    );

    /// @param accessAddress Address of the deployed GiveChainAccess contract.
    constructor(address accessAddress) AccessControlBase(accessAddress) {}

    // ------------------------------------------------------------------
    // Campaigns
    // ------------------------------------------------------------------

    /// @notice Creates a new Active campaign owned by the calling NGO.
    /// @param targetAmount Funding goal in token units. Must be above zero.
    /// @param metadataCID IPFS CID of the campaign details. Must not be empty.
    /// @return campaignId The new campaign's id.
    function createCampaign(uint256 targetAmount, string calldata metadataCID)
        external
        onlyRole(Roles.NGO_ROLE)
        whenNotPaused
        returns (uint256 campaignId)
    {
        if (targetAmount == 0) revert InvalidTarget();
        if (bytes(metadataCID).length == 0) revert EmptyMetadataCID();

        campaignId = nextCampaignId;
        nextCampaignId = campaignId + 1;

        campaigns[campaignId] = Campaign({
            ngo: msg.sender,
            targetAmount: targetAmount,
            metadataHash: keccak256(bytes(metadataCID)),
            status: CampaignStatus.Active,
            createdAt: uint40(block.timestamp)
        });

        emit CampaignCreated(campaignId, msg.sender, targetAmount, metadataCID);
    }

    /// @notice Closes a campaign after it has finished. Unspent money becomes refundable.
    /// @dev Only the campaign's own NGO, which must still hold NGO_ROLE.
    function completeCampaign(uint256 campaignId)
        external
        onlyRole(Roles.NGO_ROLE)
        whenNotPaused
    {
        _requireActive(campaignId);
        _requireCampaignNgo(campaignId, msg.sender);
        _setCampaignStatus(campaignId, CampaignStatus.Completed);
    }

    /// @notice Stops a campaign early. Unspent money becomes refundable.
    /// @dev Allowed for the campaign's own NGO (holding NGO_ROLE) or the admin.
    function cancelCampaign(uint256 campaignId) external whenNotPaused {
        _requireActive(campaignId);

        bool isOwnNgo = campaigns[campaignId].ngo == msg.sender &&
            _hasRole(Roles.NGO_ROLE, msg.sender);
        bool isAdmin = _hasRole(Roles.ADMIN_ROLE, msg.sender);
        if (!isOwnNgo && !isAdmin) revert NotAllowedToCancel(campaignId, msg.sender);

        _setCampaignStatus(campaignId, CampaignStatus.Cancelled);
    }

    // ------------------------------------------------------------------
    // Beneficiaries
    // ------------------------------------------------------------------

    /// @notice Adds a beneficiary to the caller's campaign. An auditor must approve it.
    /// @param wallet The beneficiary's wallet; payouts go here.
    /// @param identityCommitment keccak256(salt, national ID), computed off-chain.
    function registerBeneficiary(
        uint256 campaignId,
        address wallet,
        bytes32 identityCommitment
    ) external onlyRole(Roles.NGO_ROLE) whenNotPaused {
        _requireActive(campaignId);
        _requireCampaignNgo(campaignId, msg.sender);
        if (wallet == address(0)) revert ZeroAddress();
        if (wallet == msg.sender) revert NgoCannotBeBeneficiary(campaignId);
        if (identityCommitment == bytes32(0)) revert InvalidIdentityCommitment();
        if (beneficiaries[campaignId][wallet].status != BeneficiaryStatus.None) {
            revert BeneficiaryAlreadyRegistered(campaignId, wallet);
        }
        if (identityUsed[campaignId][identityCommitment]) {
            revert IdentityAlreadyUsed(campaignId, identityCommitment);
        }

        beneficiaries[campaignId][wallet] = Beneficiary({
            identityCommitment: identityCommitment,
            status: BeneficiaryStatus.Registered
        });
        identityUsed[campaignId][identityCommitment] = true;

        emit BeneficiaryRegistered(campaignId, wallet, identityCommitment);
        emit BeneficiaryStatusChanged(
            campaignId,
            wallet,
            BeneficiaryStatus.Registered,
            msg.sender
        );
    }

    /// @notice Auditor confirms a registered beneficiary is genuine and eligible.
    function approveBeneficiary(uint256 campaignId, address wallet)
        external
        onlyRole(Roles.AUDITOR_ROLE)
        whenNotPaused
    {
        _requireActive(campaignId);
        if (wallet == msg.sender) revert AuditorCannotApproveSelf();
        _requireBeneficiaryStatus(campaignId, wallet, BeneficiaryStatus.Registered);
        _setBeneficiaryStatus(campaignId, wallet, BeneficiaryStatus.Approved);
    }

    /// @notice Auditor permanently removes a beneficiary from a campaign.
    /// @dev Works on Registered or Approved beneficiaries. Their identity commitment
    ///      stays used, so the same person cannot be re-registered in this campaign.
    function revokeBeneficiary(uint256 campaignId, address wallet)
        external
        onlyRole(Roles.AUDITOR_ROLE)
        whenNotPaused
    {
        _requireActive(campaignId);
        BeneficiaryStatus current = beneficiaries[campaignId][wallet].status;
        if (
            current != BeneficiaryStatus.Registered &&
            current != BeneficiaryStatus.Approved
        ) {
            revert InvalidBeneficiaryStatus(campaignId, wallet, current);
        }
        _setBeneficiaryStatus(campaignId, wallet, BeneficiaryStatus.Revoked);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @inheritdoc IProjectRegistry
    function campaignStatus(uint256 campaignId) external view returns (CampaignStatus) {
        return campaigns[campaignId].status;
    }

    /// @inheritdoc IProjectRegistry
    function campaignNgo(uint256 campaignId) external view returns (address) {
        return campaigns[campaignId].ngo;
    }

    /// @inheritdoc IProjectRegistry
    function beneficiaryStatus(uint256 campaignId, address wallet)
        external
        view
        returns (BeneficiaryStatus)
    {
        return beneficiaries[campaignId][wallet].status;
    }

    /// @inheritdoc IProjectRegistry
    function isBeneficiaryEligible(uint256 campaignId, address wallet)
        external
        view
        returns (bool)
    {
        return
            campaigns[campaignId].status == CampaignStatus.Active &&
            beneficiaries[campaignId][wallet].status == BeneficiaryStatus.Approved;
    }

    /// @notice Full on-chain record of a campaign (all zero if it does not exist).
    function getCampaign(uint256 campaignId) external view returns (Campaign memory) {
        return campaigns[campaignId];
    }

    /// @notice Full on-chain record of a beneficiary in a campaign.
    function getBeneficiary(uint256 campaignId, address wallet)
        external
        view
        returns (Beneficiary memory)
    {
        return beneficiaries[campaignId][wallet];
    }

    /// @notice Number of campaigns created so far.
    function campaignCount() external view returns (uint256) {
        return nextCampaignId - 1;
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    function _requireActive(uint256 campaignId) internal view {
        if (campaigns[campaignId].status != CampaignStatus.Active) {
            revert CampaignNotActive(campaignId);
        }
    }

    function _requireCampaignNgo(uint256 campaignId, address caller) internal view {
        if (campaigns[campaignId].ngo != caller) revert NotCampaignNgo(campaignId, caller);
    }

    function _requireBeneficiaryStatus(
        uint256 campaignId,
        address wallet,
        BeneficiaryStatus expected
    ) internal view {
        BeneficiaryStatus current = beneficiaries[campaignId][wallet].status;
        if (current != expected) revert InvalidBeneficiaryStatus(campaignId, wallet, current);
    }

    function _setCampaignStatus(uint256 campaignId, CampaignStatus newStatus) internal {
        campaigns[campaignId].status = newStatus;
        emit CampaignStatusChanged(campaignId, newStatus, msg.sender);
    }

    function _setBeneficiaryStatus(
        uint256 campaignId,
        address wallet,
        BeneficiaryStatus newStatus
    ) internal {
        beneficiaries[campaignId][wallet].status = newStatus;
        emit BeneficiaryStatusChanged(campaignId, wallet, newStatus, msg.sender);
    }
}
