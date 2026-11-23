// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./DonationVault.sol";

contract GasMilestoneStorageAfter {
    DonationVault public vault;

    struct Milestone {
        uint256 id;
        address beneficiary;
        uint256 amount;
    }

    mapping(uint256 => Milestone) public milestones;

    constructor(address vaultAddress) {
        vault = DonationVault(payable(vaultAddress));
    }

    function createMilestone(address beneficiary, uint256 amount) external returns (uint256) {
        uint256 milestoneId = 1;
        milestones[milestoneId] = Milestone({
            id: milestoneId,
            beneficiary: beneficiary,
            amount: amount
        });
        return milestoneId;
    }

    function approveMilestone(uint256 milestoneId) external {
        Milestone storage milestone = milestones[milestoneId];

        uint256 milestoneIdValue = milestone.id;
        address beneficiary = milestone.beneficiary;
        uint256 amount = milestone.amount;

        require(milestoneIdValue != 0, "Milestone does not exist");
        vault.reserveFunds(amount);
        vault.releaseTo(payable(beneficiary), amount);
    }
}
