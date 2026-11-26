// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IProjectRegistry
/// @notice What other GiveChain contracts need to know from the registry:
///         campaign status, campaign owner and beneficiary eligibility.
/// @dev Only the cross-contract surface is defined here. User-facing functions
///      (createCampaign, registerBeneficiary, ...) live in ProjectRegistry itself.
interface IProjectRegistry {
    /// @notice Campaign lifecycle.
    /// None      = campaign id does not exist
    /// Active    = accepting donations and payouts
    /// Completed = closed by its NGO after finishing; unspent funds become refundable
    /// Cancelled = stopped by its NGO or the admin; unspent funds become refundable
    enum CampaignStatus {
        None,
        Active,
        Completed,
        Cancelled
    }

    /// @notice Beneficiary lifecycle, per campaign.
    /// None       = not registered in this campaign
    /// Registered = added by the campaign's NGO, waiting for an auditor
    /// Approved   = checked by an auditor; can receive payouts
    /// Revoked    = removed by an auditor; can never receive payouts again
    enum BeneficiaryStatus {
        None,
        Registered,
        Approved,
        Revoked
    }

    /// @notice Current status of a campaign.
    function campaignStatus(uint256 campaignId) external view returns (CampaignStatus);

    /// @notice The NGO wallet that owns a campaign (address(0) if it does not exist).
    function campaignNgo(uint256 campaignId) external view returns (address);

    /// @notice Current status of a beneficiary within a campaign.
    function beneficiaryStatus(uint256 campaignId, address wallet)
        external
        view
        returns (BeneficiaryStatus);

    /// @notice True only if the campaign is Active and the beneficiary is Approved in it.
    function isBeneficiaryEligible(uint256 campaignId, address wallet)
        external
        view
        returns (bool);
}
