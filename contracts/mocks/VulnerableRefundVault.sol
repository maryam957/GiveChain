// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title VulnerableRefundVault
/// @notice TEST-ONLY, DELIBERATELY INSECURE. A stripped-down refund vault with the two
///         mistakes DonationVault avoids: it sends tokens BEFORE recording the refund
///         (breaking checks-effects-interactions) and has no reentrancy guard.
///         The security tests run the same attacker against this contract and against
///         DonationVault, to show the attack is real and the protections stop it.
contract VulnerableRefundVault {
    IERC20 public immutable token;
    bool public closed;

    mapping(uint256 => mapping(address => uint256)) public contributions;
    mapping(uint256 => mapping(address => bool)) public refundClaimed;

    constructor(address tokenAddress) {
        token = IERC20(tokenAddress);
    }

    function donate(uint256 campaignId, uint256 amount) external {
        contributions[campaignId][msg.sender] += amount;
        token.transferFrom(msg.sender, address(this), amount);
    }

    function close() external {
        closed = true;
    }

    function claimRefund(uint256 campaignId) external {
        require(closed, "not closed");
        require(!refundClaimed[campaignId][msg.sender], "already claimed");
        uint256 amount = contributions[campaignId][msg.sender];

        // BUG: interaction before effects. The attacker re-enters here.
        token.transfer(msg.sender, amount);

        refundClaimed[campaignId][msg.sender] = true;
    }
}
