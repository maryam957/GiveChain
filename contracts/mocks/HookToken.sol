// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../MockUSDC.sol";

/// @notice Implemented by contracts that want to be told when they receive HookToken.
interface ITokenReceiver {
    function onTokenReceived(address from, uint256 amount) external;
}

/// @title HookToken
/// @notice Test-only token. Like MockUSDC, but after every transfer to a contract it
///         calls that contract's onTokenReceived hook if it has one (similar to
///         ERC-777 / ERC-1363). This gives a malicious recipient a chance to call back
///         into the vault in the middle of a payout, which is exactly what the
///         reentrancy tests need.
/// @dev Contracts without the hook (like the vault) are skipped: the failed hook call
///      is ignored. The attacker records the outcome of its own re-entry attempt.
contract HookToken is MockUSDC {
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from != address(0) && to.code.length > 0) {
            try ITokenReceiver(to).onTokenReceived(from, value) {} catch {}
        }
    }
}
