// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./DonationVault.sol";

contract GasMilestoneStorageBaseline {
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
        require(milestones[milestoneId].id != 0, "Milestone does not exist");
        vault.reserveFunds(milestones[milestoneId].amount);
        vault.releaseTo(
            payable(milestones[milestoneId].beneficiary),
            milestones[milestoneId].amount
        );
    }
}
