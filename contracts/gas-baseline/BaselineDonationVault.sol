// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// GAS BASELINE SNAPSHOT - not deployed, not used by the app.
// Exact copy of the Phase 2 contract (renamed with a "Baseline" prefix), kept so
// scripts/gas-benchmark.js can measure the optimized contracts against it under
// identical conditions. See docs/GiveChain-Gas-Sheet.md.

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./BaselineAccessControlBase.sol";
import "../interfaces/IDonationVault.sol";
import "../interfaces/IProjectRegistry.sol";

/// @title DonationVault
/// @notice Holds every donated MockUSDC token, with a separate balance per campaign.
///         Money leaves only as a payout to an eligible beneficiary or as a donor refund.
/// @dev Accounting per campaign:
///        available = donated - reserved - released - refunded
///      The vault re-checks every payout request itself (campaign status,
///      beneficiary eligibility, available balance, duplicate payout) instead of
///      trusting MilestoneDisbursement. Supports standard ERC-20 tokens only
///      (no fee-on-transfer or rebasing tokens).
contract BaselineDonationVault is BaselineAccessControlBase, IDonationVault {
    using SafeERC20 for IERC20;

    /// @notice Money totals for one campaign, in token units.
    struct CampaignFunds {
        uint256 donated; // all donations ever received
        uint256 reserved; // set aside for approved, not yet paid milestones
        uint256 released; // paid to beneficiaries
        uint256 refunded; // returned to donors
    }

    enum ReservationStatus {
        None,
        Reserved,
        Released,
        Cancelled
    }

    /// @notice Money set aside for one milestone. Beneficiary and amount are fixed here.
    struct Reservation {
        uint256 campaignId;
        address beneficiary;
        uint256 amount;
        ReservationStatus status;
    }

    /// @notice The donation token (MockUSDC).
    IERC20 public token;

    /// @notice Source of campaign status and beneficiary eligibility.
    IProjectRegistry public registry;

    /// @notice The only contract allowed to reserve, release or cancel. Set once.
    address public disbursementContract;

    mapping(uint256 => CampaignFunds) private campaignFunds;
    mapping(uint256 => Reservation) private reservations; // by milestone id

    /// @notice How much each donor gave to each campaign.
    mapping(uint256 => mapping(address => uint256)) public contributions;

    /// @notice True once a donor has claimed their refund from a closed campaign.
    mapping(uint256 => mapping(address => bool)) public refundClaimed;

    event DisbursementContractSet(address indexed disbursementContract);
    event DonationReceived(uint256 indexed campaignId, address indexed donor, uint256 amount);
    event FundsReserved(
        uint256 indexed campaignId,
        uint256 indexed milestoneId,
        address indexed beneficiary,
        uint256 amount
    );
    event ReservationCancelled(
        uint256 indexed campaignId,
        uint256 indexed milestoneId,
        uint256 amount
    );
    event FundsReleased(
        uint256 indexed campaignId,
        uint256 indexed milestoneId,
        address indexed beneficiary,
        uint256 amount
    );
    event RefundClaimed(uint256 indexed campaignId, address indexed donor, uint256 amount);

    error ZeroAmount();
    error DisbursementAlreadySet();
    error NotAContract(address account);
    error NotDisbursementContract(address caller);
    error CampaignNotActive(uint256 campaignId);
    error CampaignNotClosed(uint256 campaignId);
    error BeneficiaryNotEligible(uint256 campaignId, address beneficiary);
    error InsufficientCampaignFunds(uint256 campaignId, uint256 requested, uint256 available);
    error ReservationExists(uint256 milestoneId);
    error InvalidReservationStatus(uint256 milestoneId, ReservationStatus current);
    error NoContribution(uint256 campaignId, address donor);
    error RefundAlreadyClaimed(uint256 campaignId, address donor);
    error NothingToRefund(uint256 campaignId);

    /// @param accessAddress   Deployed GiveChainAccess.
    /// @param registryAddress Deployed ProjectRegistry.
    /// @param tokenAddress    Deployed donation token (MockUSDC).
    constructor(address accessAddress, address registryAddress, address tokenAddress)
        BaselineAccessControlBase(accessAddress)
    {
        if (registryAddress == address(0) || tokenAddress == address(0)) revert ZeroAddress();
        registry = IProjectRegistry(registryAddress);
        token = IERC20(tokenAddress);
    }

    /// @dev Only the linked MilestoneDisbursement contract. While it is not yet set,
    ///      nobody passes, because msg.sender is never the zero address.
    modifier onlyDisbursement() {
        if (msg.sender != disbursementContract) revert NotDisbursementContract(msg.sender);
        _;
    }

    // ------------------------------------------------------------------
    // Setup
    // ------------------------------------------------------------------

    /// @notice Links the MilestoneDisbursement contract. Can only ever be done once,
    ///         so nobody (not even the admin) can later redirect payouts.
    function setDisbursementContract(address disbursement)
        external
        onlyRole(Roles.ADMIN_ROLE)
    {
        if (disbursementContract != address(0)) revert DisbursementAlreadySet();
        if (disbursement == address(0)) revert ZeroAddress();
        if (disbursement.code.length == 0) revert NotAContract(disbursement);

        disbursementContract = disbursement;
        emit DisbursementContractSet(disbursement);
    }

    // ------------------------------------------------------------------
    // Donors
    // ------------------------------------------------------------------

    /// @notice Donates `amount` tokens to an Active campaign.
    /// @dev The donor must first approve this vault to spend `amount` tokens.
    function donate(uint256 campaignId, uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (registry.campaignStatus(campaignId) != IProjectRegistry.CampaignStatus.Active) {
            revert CampaignNotActive(campaignId);
        }

        campaignFunds[campaignId].donated += amount;
        contributions[campaignId][msg.sender] += amount;

        token.safeTransferFrom(msg.sender, address(this), amount);

        emit DonationReceived(campaignId, msg.sender, amount);
    }

    /// @notice Returns the caller's share of a closed campaign's unspent money.
    /// @dev refund = contribution * (donated - released) / donated, claimable once.
    function claimRefund(uint256 campaignId) external whenNotPaused nonReentrant {
        uint256 amount = _refundableAmount(campaignId, msg.sender, true);

        refundClaimed[campaignId][msg.sender] = true;
        campaignFunds[campaignId].refunded += amount;

        token.safeTransfer(msg.sender, amount);

        emit RefundClaimed(campaignId, msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // MilestoneDisbursement only
    // ------------------------------------------------------------------

    /// @inheritdoc IDonationVault
    function reserveFunds(
        uint256 campaignId,
        uint256 milestoneId,
        address beneficiary,
        uint256 amount
    ) external onlyDisbursement whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (reservations[milestoneId].status != ReservationStatus.None) {
            revert ReservationExists(milestoneId);
        }
        if (!registry.isBeneficiaryEligible(campaignId, beneficiary)) {
            revert BeneficiaryNotEligible(campaignId, beneficiary);
        }
        uint256 available = availableBalance(campaignId);
        if (amount > available) {
            revert InsufficientCampaignFunds(campaignId, amount, available);
        }

        campaignFunds[campaignId].reserved += amount;
        reservations[milestoneId] = Reservation({
            campaignId: campaignId,
            beneficiary: beneficiary,
            amount: amount,
            status: ReservationStatus.Reserved
        });

        emit FundsReserved(campaignId, milestoneId, beneficiary, amount);
    }

    /// @inheritdoc IDonationVault
    function releaseFunds(uint256 milestoneId)
        external
        onlyDisbursement
        whenNotPaused
        nonReentrant
    {
        Reservation storage reservation = reservations[milestoneId];
        if (reservation.status != ReservationStatus.Reserved) {
            revert InvalidReservationStatus(milestoneId, reservation.status);
        }
        if (!registry.isBeneficiaryEligible(reservation.campaignId, reservation.beneficiary)) {
            revert BeneficiaryNotEligible(reservation.campaignId, reservation.beneficiary);
        }

        // Effects before the token transfer (checks-effects-interactions).
        reservation.status = ReservationStatus.Released;
        campaignFunds[reservation.campaignId].reserved -= reservation.amount;
        campaignFunds[reservation.campaignId].released += reservation.amount;

        token.safeTransfer(reservation.beneficiary, reservation.amount);

        emit FundsReleased(
            reservation.campaignId,
            milestoneId,
            reservation.beneficiary,
            reservation.amount
        );
    }

    /// @inheritdoc IDonationVault
    function cancelReservation(uint256 milestoneId) external onlyDisbursement whenNotPaused {
        Reservation storage reservation = reservations[milestoneId];
        if (reservation.status != ReservationStatus.Reserved) {
            revert InvalidReservationStatus(milestoneId, reservation.status);
        }

        reservation.status = ReservationStatus.Cancelled;
        campaignFunds[reservation.campaignId].reserved -= reservation.amount;

        emit ReservationCancelled(reservation.campaignId, milestoneId, reservation.amount);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @inheritdoc IDonationVault
    /// @dev Never reverts: returns 0 if reservations exceed what the campaign still holds
    ///      (possible after a closed campaign's refunds).
    function availableBalance(uint256 campaignId) public view returns (uint256) {
        CampaignFunds storage funds = campaignFunds[campaignId];
        uint256 held = funds.donated - funds.released - funds.refunded;
        return held > funds.reserved ? held - funds.reserved : 0;
    }

    /// @notice Tokens the vault still holds for a campaign (reserved or not).
    function heldBalance(uint256 campaignId) external view returns (uint256) {
        CampaignFunds storage funds = campaignFunds[campaignId];
        return funds.donated - funds.released - funds.refunded;
    }

    /// @notice What `donor` could claim right now from `campaignId` (0 if nothing).
    function refundableAmount(uint256 campaignId, address donor) external view returns (uint256) {
        return _refundableAmount(campaignId, donor, false);
    }

    /// @notice All money totals for a campaign.
    function getCampaignFunds(uint256 campaignId) external view returns (CampaignFunds memory) {
        return campaignFunds[campaignId];
    }

    /// @notice The reservation recorded for a milestone.
    function getReservation(uint256 milestoneId) external view returns (Reservation memory) {
        return reservations[milestoneId];
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    /// @dev With `strict` true, reverts with the reason a refund is not possible;
    ///      otherwise returns 0 in those cases.
    function _refundableAmount(uint256 campaignId, address donor, bool strict)
        internal
        view
        returns (uint256)
    {
        IProjectRegistry.CampaignStatus status = registry.campaignStatus(campaignId);
        if (
            status != IProjectRegistry.CampaignStatus.Completed &&
            status != IProjectRegistry.CampaignStatus.Cancelled
        ) {
            if (strict) revert CampaignNotClosed(campaignId);
            return 0;
        }

        uint256 contribution = contributions[campaignId][donor];
        if (contribution == 0) {
            if (strict) revert NoContribution(campaignId, donor);
            return 0;
        }
        if (refundClaimed[campaignId][donor]) {
            if (strict) revert RefundAlreadyClaimed(campaignId, donor);
            return 0;
        }

        CampaignFunds storage funds = campaignFunds[campaignId];
        uint256 amount = (contribution * (funds.donated - funds.released)) / funds.donated;
        if (amount == 0 && strict) revert NothingToRefund(campaignId);
        return amount;
    }
}
