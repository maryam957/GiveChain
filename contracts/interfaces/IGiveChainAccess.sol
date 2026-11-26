// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IGiveChainAccess
/// @notice The single source of truth for roles and the system-wide pause switch.
/// @dev Every GiveChain contract asks this contract "does this account have this role?"
///      and "is the system paused?". Roles are granted once here, not in each contract.
interface IGiveChainAccess {
    /// @notice Returns true if `account` holds `role`.
    function hasRole(bytes32 role, address account) external view returns (bool);

    /// @notice Returns true while the emergency pause is active.
    function paused() external view returns (bool);
}
