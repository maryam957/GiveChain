
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AccessControlBase.sol";

contract ProjectRegistry is AccessControlBase {

    uint256 public nextProjectId = 1;

    struct Project {
        uint256 id;
        string name;
        string description;
        address ngo;
        bool active;
    }

    struct Beneficiary {
        address wallet;
        bytes32 identityCommitment;
        bool approved;
        bool exists;
    }

    mapping(uint256 => Project) public projects;

    mapping(uint256 => mapping(address => Beneficiary))
        private beneficiaries;

    mapping(uint256 => mapping(bytes32 => bool))
        public usedIdentityCommitments;

    event ProjectCreated(
        uint256 indexed projectId,
        address indexed ngo,
        string name
    );

    event BeneficiaryRegistered(
        uint256 indexed projectId,
        address indexed wallet,
        bytes32 identityCommitment
    );

    event BeneficiaryApproved(
        uint256 indexed projectId,
        address indexed wallet,
        address auditor
    );

    // NGO creates a new project
    function createProject(
        string calldata name,
        string calldata description
    )
        external
        onlyRole(NGO_ROLE)
        whenNotPaused
        returns (uint256)
    {
        require(bytes(name).length > 0, "Project name required");

        uint256 projectId = nextProjectId++;

        projects[projectId] = Project({
            id: projectId,
            name: name,
            description: description,
            ngo: msg.sender,
            active: true
        });

        emit ProjectCreated(projectId, msg.sender, name);

        return projectId;
    }

    // NGO registers a beneficiary
    function registerBeneficiary(
        uint256 projectId,
        address wallet,
        bytes32 identityCommitment
    )
        external
        onlyRole(NGO_ROLE)
        whenNotPaused
    {
        require(projects[projectId].active, "Project does not exist or is inactive");
        require(projects[projectId].ngo == msg.sender, "Not project owner");
        require(wallet != address(0), "Invalid wallet");
        require(identityCommitment != bytes32(0), "Invalid identity commitment");

        require(
            !beneficiaries[projectId][wallet].exists,
            "Beneficiary already registered"
        );

        require(
            !usedIdentityCommitments[projectId][identityCommitment],
            "Identity already registered"
        );

        beneficiaries[projectId][wallet] = Beneficiary({
            wallet: wallet,
            identityCommitment: identityCommitment,
            approved: false,
            exists: true
        });

        usedIdentityCommitments[projectId][identityCommitment] = true;

        emit BeneficiaryRegistered(
            projectId,
            wallet,
            identityCommitment
        );
    }

    // Auditor independently approves a beneficiary
    function approveBeneficiary(
        uint256 projectId,
        address wallet
    )
        external
        onlyRole(AUDITOR_ROLE)
        whenNotPaused
    {
        require(
            beneficiaries[projectId][wallet].exists,
            "Beneficiary not registered"
        );

        require(
            !beneficiaries[projectId][wallet].approved,
            "Already approved"
        );

        beneficiaries[projectId][wallet].approved = true;

        emit BeneficiaryApproved(projectId, wallet, msg.sender);
    }

    // Return beneficiary information
    function getBeneficiary(
        uint256 projectId,
        address wallet
    )
        external
        view
        returns (Beneficiary memory)
    {
        return beneficiaries[projectId][wallet];
    }

    // Check whether a beneficiary has auditor approval
    function isBeneficiaryApproved(
        uint256 projectId,
        address wallet
    )
        external
        view
        returns (bool)
    {
        return beneficiaries[projectId][wallet].approved;
    }

    // Check whether an NGO owns a project
    function isProjectNGO(
        uint256 projectId,
        address ngo
    )
        external
        view
        returns (bool)
    {
        return projects[projectId].ngo == ngo;
    }

    // Check whether a project is active
    function isProjectActive(uint256 projectId)
        external
        view
        returns (bool)
    {
        return projects[projectId].active;
    }
}
