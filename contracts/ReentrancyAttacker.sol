// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IDonationVault {
    function deposit() external payable;
    function refund(uint256 amount) external;
}

contract ReentrancyAttacker {
    IDonationVault public vault;
    uint256 public attackAmount;
    bool public reentryBlocked;

    constructor(address vaultAddress) {
        vault = IDonationVault(vaultAddress);
    }

    function donate() external payable {
        vault.deposit{value: msg.value}();
    }

    function attack(uint256 amount) external {
        attackAmount = amount;
        vault.refund(amount);
    }

    receive() external payable {
        try vault.refund(attackAmount) {
            // Re-entry unexpectedly succeeded.
        } catch {
            reentryBlocked = true;
        }
    }
}
