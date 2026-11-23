
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AccessControlBase.sol";
import "./ProjectRegistry.sol";
import "./DonationVault.sol";

contract MilestoneDisbursement is AccessControlBase {

    ProjectRegistry public registry;
    DonationVault public vault;

    uint256 public nextMilestoneId = 1;

    enum Status {
        Pending,
        Released,
        Rejected
    }

    struct Milestone {
        uint256 id;
        uint256 projectId;
        address beneficiary;
        uint256 amount;
        string evidenceCID;
        Status status;
    }

    mapping(uint256 => Milestone) public milestones;

    event MilestoneCreated(
        uint256 indexed milestoneId,
        uint256 indexed projectId,
        address indexed beneficiary,
        uint256 amount
    );

    event MilestoneReleased(
        uint256 indexed milestoneId,
        address indexed beneficiary,
        uint256 amount,
        address auditor
    );

    event MilestoneRejected(
        uint256 indexed milestoneId,
        address auditor
    );

    constructor(address registryAddress, address vaultAddress) {
        require(registryAddress != address(0), "Invalid registry address");
        require(vaultAddress != address(0), "Invalid vault address");

        registry = ProjectRegistry(registryAddress);
        vault = DonationVault(payable(vaultAddress));
    }

    // NGO creates a milestone with supporting evidence
    function createMilestone(
        uint256 projectId,
        address beneficiary,
        uint256 amount,
        string calldata evidenceCID
    )
        external
        onlyRole(NGO_ROLE)
        whenNotPaused
        returns (uint256)
    {
        require(registry.isProjectActive(projectId), "Project inactive");
        require(registry.isProjectNGO(projectId, msg.sender), "Not project owner");

        require(
            registry.isBeneficiaryApproved(projectId, beneficiary),
            "Beneficiary not approved"
        );

        require(amount > 0, "Invalid amount");
        require(bytes(evidenceCID).length > 0, "Evidence required");

        uint256 milestoneId = nextMilestoneId++;

        milestones[milestoneId] = Milestone({
            id: milestoneId,
            projectId: projectId,
            beneficiary: beneficiary,
            amount: amount,
            evidenceCID: evidenceCID,
            status: Status.Pending
        });

        emit MilestoneCreated(
            milestoneId,
            projectId,
            beneficiary,
            amount
        );

        return milestoneId;
    }

    // Auditor approves milestone and releases ETH
    function approveMilestone(uint256 milestoneId)
        external
        onlyRole(AUDITOR_ROLE)
        whenNotPaused
        nonReentrant
    {
        Milestone storage milestone = milestones[milestoneId];

        uint256 milestoneIdValue = milestone.id;
        uint256 projectId = milestone.projectId;
        address beneficiary = milestone.beneficiary;
        uint256 amount = milestone.amount;

        require(milestoneIdValue != 0, "Milestone does not exist");
        require(milestone.status == Status.Pending, "Not pending");

        require(
            registry.isBeneficiaryApproved(
                projectId,
                beneficiary
            ),
            "Beneficiary approval missing"
        );

        // Update status before external calls
        milestone.status = Status.Released;

        // Reserve and transfer funds through the vault
        vault.reserveFunds(amount);

        vault.releaseTo(
            payable(beneficiary),
            amount
        );

        emit MilestoneReleased(
            milestoneId,
            beneficiary,
            amount,
            msg.sender
        );
    }

    // Auditor rejects a milestone
    function rejectMilestone(uint256 milestoneId)
        external
        onlyRole(AUDITOR_ROLE)
        whenNotPaused
    {
        Milestone storage milestone = milestones[milestoneId];

        require(milestone.id != 0, "Milestone does not exist");
        require(milestone.status == Status.Pending, "Not pending");

        milestone.status = Status.Rejected;

        emit MilestoneRejected(milestoneId, msg.sender);
    }

    // View complete milestone information
    function getMilestone(uint256 milestoneId)
        external
        view
        returns (Milestone memory)
    {
        return milestones[milestoneId];
    }
}
