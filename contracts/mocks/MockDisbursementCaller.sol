// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IDonationVault.sol";

/// @title MockDisbursementCaller
/// @notice Test-only stand-in for MilestoneDisbursement. It forwards any request to
///         the vault without checking anything, so tests can prove the vault does
///         its own checks instead of trusting its caller.
contract MockDisbursementCaller {
    IDonationVault public immutable vault;

    constructor(address vaultAddress) {
        vault = IDonationVault(vaultAddress);
    }

    function reserve(
        uint256 campaignId,
        uint256 milestoneId,
        address beneficiary,
        uint256 amount
    ) external {
        vault.reserveFunds(campaignId, milestoneId, beneficiary, amount);
    }

    function release(uint256 milestoneId) external {
        vault.releaseFunds(milestoneId);
    }

    function cancel(uint256 milestoneId) external {
        vault.cancelReservation(milestoneId);
    }
}
