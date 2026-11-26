// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../AccessControlBase.sol";

/// @title AccessControlBaseHarness
/// @notice Test-only contract. AccessControlBase is abstract, so this gives the
///         tests something concrete that uses each of its modifiers.
contract AccessControlBaseHarness is AccessControlBase {
    uint256 public counter;

    constructor(address accessAddress) AccessControlBase(accessAddress) {}

    function ngoOnly() external onlyRole(Roles.NGO_ROLE) {
        counter++;
    }

    function auditorOnly() external onlyRole(Roles.AUDITOR_ROLE) {
        counter++;
    }

    function pausable() external whenNotPaused {
        counter++;
    }

    function guarded() external nonReentrant {
        counter++;
        // Calls itself again to prove the reentrancy guard blocks it.
        this.guardedInner();
    }

    function guardedInner() external nonReentrant {
        counter++;
    }
}
