// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Roles
/// @notice Role identifiers shared by every GiveChain contract.
/// @dev The admin role is OpenZeppelin's DEFAULT_ADMIN_ROLE (bytes32(0)),
///      which can grant and revoke all the roles below.
library Roles {
    /// @notice Manages all roles; can cancel any campaign. Same id as OpenZeppelin's DEFAULT_ADMIN_ROLE.
    bytes32 internal constant ADMIN_ROLE = 0x00;

    /// @notice Creates and runs campaigns, registers beneficiaries, submits and releases milestones.
    bytes32 internal constant NGO_ROLE = keccak256("NGO_ROLE");

    /// @notice Independently approves beneficiaries and milestones.
    bytes32 internal constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");

    /// @notice Can switch the system-wide emergency pause on and off.
    bytes32 internal constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
}
