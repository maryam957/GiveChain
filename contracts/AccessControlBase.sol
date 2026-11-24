// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IGiveChainAccess.sol";
import "./libraries/Roles.sol";

/// @title AccessControlBase
/// @notice Shared security behaviour inherited by ProjectRegistry, DonationVault
///         and MilestoneDisbursement: role checks, the emergency pause and
///         reentrancy protection.
/// @dev Roles and the pause switch are stored once in GiveChainAccess. This base
///      contract only asks it, so every inheriting contract follows the same
///      rules without keeping its own copy of the roles.
abstract contract AccessControlBase is ReentrancyGuard {
    /// @notice The GiveChainAccess contract that stores roles and the pause state.
    IGiveChainAccess public access;

    /// @notice A required address was the zero address.
    error ZeroAddress();

    /// @notice `account` does not hold `role`.
    error MissingRole(address account, bytes32 role);

    /// @notice The system-wide emergency pause is active.
    error SystemPaused();

    /// @param accessAddress Address of the deployed GiveChainAccess contract.
    constructor(address accessAddress) {
        if (accessAddress == address(0)) revert ZeroAddress();
        access = IGiveChainAccess(accessAddress);
    }

    /// @notice Allows the call only if the sender holds `role`.
    modifier onlyRole(bytes32 role) {
        _checkRole(role, msg.sender);
        _;
    }

    /// @notice Allows the call only while the system is not paused.
    modifier whenNotPaused() {
        if (access.paused()) revert SystemPaused();
        _;
    }

    /// @dev Reverts with MissingRole if `account` does not hold `role`.
    function _checkRole(bytes32 role, address account) internal view {
        if (!access.hasRole(role, account)) revert MissingRole(account, role);
    }

    /// @dev Returns true if `account` holds `role`.
    function _hasRole(bytes32 role, address account) internal view returns (bool) {
        return access.hasRole(role, account);
    }
}
