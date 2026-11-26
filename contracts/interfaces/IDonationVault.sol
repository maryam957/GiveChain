// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IDonationVault
/// @notice The functions MilestoneDisbursement uses to move campaign money.
/// @dev Only the linked MilestoneDisbursement contract may call the state-changing
///      functions. The vault re-checks every request itself (campaign status,
///      beneficiary eligibility, available balance, duplicate payout) and does not
///      trust the caller's checks. Donor functions (donate, claimRefund) live in
///      DonationVault itself.
interface IDonationVault {
    /// @notice Sets aside `amount` of a campaign's money for an approved milestone.
    /// @dev Reverts if the campaign is not Active, the beneficiary is not eligible,
    ///      the campaign's available balance is too low, or the milestone already
    ///      has a reservation.
    function reserveFunds(
        uint256 campaignId,
        uint256 milestoneId,
        address beneficiary,
        uint256 amount
    ) external;

    /// @notice Pays a reserved milestone directly to its beneficiary's wallet.
    /// @dev The beneficiary and amount come from the reservation, not from the caller.
    ///      Reverts if the reservation does not exist, was already paid or cancelled,
    ///      the campaign is not Active, or the beneficiary is no longer eligible.
    function releaseFunds(uint256 milestoneId) external;

    /// @notice Returns a reservation's money to the campaign's available balance.
    /// @dev Used when an auditor cancels an approved milestone before it is paid.
    function cancelReservation(uint256 milestoneId) external;

    /// @notice Campaign money that is neither reserved, paid out nor refunded.
    function availableBalance(uint256 campaignId) external view returns (uint256);
}
