// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./HookToken.sol";

interface IAttackedVault {
    function donate(uint256 campaignId, uint256 amount) external;
    function claimRefund(uint256 campaignId) external;
}

/// @title RefundReentrancyAttacker
/// @notice Test-only attacker. It donates, waits for the campaign to close, then claims
///         a refund. When the refund tokens arrive, its hook immediately tries to claim
///         the refund a second time, before the first claim has finished.
/// @dev The second claim is wrapped in try/catch so the attack itself does not revert;
///      the test then checks whether the re-entry succeeded or was blocked.
contract RefundReentrancyAttacker is ITokenReceiver {
    IAttackedVault public immutable vault;
    IERC20 public immutable token;

    uint256 public targetCampaign;
    bool public attacking;
    bool public reentryAttempted;
    bool public reentrySucceeded;
    bytes public reentryError;

    constructor(address vaultAddress, address tokenAddress) {
        vault = IAttackedVault(vaultAddress);
        token = IERC20(tokenAddress);
    }

    function donate(uint256 campaignId, uint256 amount) external {
        token.approve(address(vault), amount);
        vault.donate(campaignId, amount);
    }

    function attack(uint256 campaignId) external {
        targetCampaign = campaignId;
        attacking = true;
        vault.claimRefund(campaignId);
        attacking = false;
    }

    function onTokenReceived(address, uint256) external override {
        if (!attacking || reentryAttempted) return;
        reentryAttempted = true;
        try vault.claimRefund(targetCampaign) {
            reentrySucceeded = true;
        } catch (bytes memory reason) {
            reentryError = reason;
        }
    }
}
