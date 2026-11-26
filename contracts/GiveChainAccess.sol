// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IGiveChainAccess.sol";
import "./libraries/Roles.sol";

/// @title GiveChainAccess
/// @notice Holds every GiveChain role and the single system-wide emergency pause.
/// @dev Other GiveChain contracts inherit AccessControlBase, which asks this
///      contract for role checks and pause state. A role is therefore granted
///      once here and applies to the whole system.
///
///      Separation of duties: one account can never hold both NGO_ROLE and
///      AUDITOR_ROLE, so nobody can approve their own payment requests.
contract GiveChainAccess is AccessControl, Pausable, IGiveChainAccess {
    /// @notice Role ids, exposed so the frontend and scripts can read them.
    bytes32 public constant NGO_ROLE = Roles.NGO_ROLE;
    bytes32 public constant AUDITOR_ROLE = Roles.AUDITOR_ROLE;
    bytes32 public constant PAUSER_ROLE = Roles.PAUSER_ROLE;

    /// @notice The admin address given to the constructor was the zero address.
    error ZeroAddress();

    /// @notice Granting `role` to `account` would give it both NGO and auditor powers.
    error ConflictingRole(address account, bytes32 role);

    /// @param admin Receives the admin role (manages all roles) and the pauser role.
    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    /// @notice Stops every pausable action in all GiveChain contracts.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Lifts the emergency pause.
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @inheritdoc IGiveChainAccess
    function hasRole(bytes32 role, address account)
        public
        view
        override(AccessControl, IGiveChainAccess)
        returns (bool)
    {
        return super.hasRole(role, account);
    }

    /// @inheritdoc IGiveChainAccess
    function paused() public view override(Pausable, IGiveChainAccess) returns (bool) {
        return super.paused();
    }

    /// @dev Blocks giving one account both the NGO and auditor roles.
    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        if (
            (role == NGO_ROLE && hasRole(AUDITOR_ROLE, account)) ||
            (role == AUDITOR_ROLE && hasRole(NGO_ROLE, account))
        ) {
            revert ConflictingRole(account, role);
        }
        return super._grantRole(role, account);
    }
}
