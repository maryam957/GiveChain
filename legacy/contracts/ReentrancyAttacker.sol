// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAttackTargetVault {
    function deposit() external payable;
    function refund(uint256 amount) external;
}

contract ReentrancyAttacker {
    IAttackTargetVault public vault;
    uint256 public attackAmount;
    bool public reentryBlocked;

    constructor(address vaultAddress) {
        vault = IAttackTargetVault(vaultAddress);
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
