const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GiveChain Complete Test Suite", function () {
    let admin, ngo, ngo2, auditor, donor, beneficiary, attacker;
    let vault, registry, milestone;

    const ETH = ethers.parseEther;

    async function deploySystem() {
        [admin, ngo, ngo2, auditor, donor, beneficiary, attacker] =
            await ethers.getSigners();

        const Vault = await ethers.getContractFactory("DonationVault");
        vault = await Vault.deploy();
        await vault.waitForDeployment();

        const Registry = await ethers.getContractFactory("ProjectRegistry");
        registry = await Registry.deploy();
        await registry.waitForDeployment();

        const Milestone = await ethers.getContractFactory(
            "MilestoneDisbursement"
        );
        milestone = await Milestone.deploy(
            await registry.getAddress(),
            await vault.getAddress()
        );
        await milestone.waitForDeployment();

        await registry.grantRole(await registry.NGO_ROLE(), ngo.address);
        await registry.grantRole(await registry.NGO_ROLE(), ngo2.address);
        await registry.grantRole(await registry.AUDITOR_ROLE(), auditor.address);
        await milestone.grantRole(await milestone.NGO_ROLE(), ngo.address);
        await milestone.grantRole(await milestone.NGO_ROLE(), ngo2.address);
        await milestone.grantRole(await milestone.AUDITOR_ROLE(), auditor.address);
        await vault.grantRole(await vault.MILESTONE_ROLE(), await milestone.getAddress());
        await vault.grantRole(await vault.DISBURSEMENT_ROLE(), await milestone.getAddress());
    }

    async function createApprovedBeneficiary() {
        await registry.connect(ngo).createProject(
            "Education Support",
            "Financial assistance for students"
        );
        await registry.connect(ngo).registerBeneficiary(
            1,
            beneficiary.address,
            ethers.keccak256(ethers.toUtf8Bytes("identity-secret"))
        );
        await registry.connect(auditor).approveBeneficiary(
            1,
            beneficiary.address
        );
    }

    async function assertVaultAccountingInvariants() {
        const vaultAddress = await vault.getAddress();
        const balance = await ethers.provider.getBalance(vaultAddress);
        const refundable = await vault.totalRefundable();
        const committed = await vault.totalCommitted();
        const donated = await vault.totalDonated();
        const refunded = await vault.totalRefunded();
        const released = await vault.totalReleased();

        expect(refundable + committed).to.be.at.most(balance);
        expect(refundable + committed).to.equal(balance);
        expect(donated).to.equal(refunded + released + refundable + committed);
        expect(refunded).to.be.at.most(donated);
    }

    beforeEach(async function () {
        await deploySystem();
    });

    describe("DonationVault - Donations", function () {
        it("should accept a donation", async function () {
            await vault.connect(donor).deposit({ value: ETH("5") });
            expect(await vault.donorBalance(donor.address)).to.equal(ETH("5"));
            expect(await ethers.provider.getBalance(await vault.getAddress()))
                .to.equal(ETH("5"));
            await assertVaultAccountingInvariants();
        });

        it("should reject a zero donation", async function () {
            await expect(vault.connect(donor).deposit({ value: 0 }))
                .to.be.revertedWithCustomError(vault, "ZeroDonation");
        });

        it("should accept a direct ETH transfer", async function () {
            await donor.sendTransaction({
                to: await vault.getAddress(),
                value: ETH("1")
            });
            expect(await vault.donorBalance(donor.address)).to.equal(ETH("1"));
        });

        it("should track total donations", async function () {
            await vault.connect(donor).deposit({ value: ETH("3") });
            await vault.connect(attacker).deposit({ value: ETH("2") });
            expect(await vault.totalDonated()).to.equal(ETH("5"));
        });
    });

    describe("DonationVault - Refunds", function () {
        beforeEach(async function () {
            await vault.connect(donor).deposit({ value: ETH("5") });
        });

        it("should refund a donor", async function () {
            await vault.connect(donor).refund(ETH("2"));
            expect(await vault.donorBalance(donor.address)).to.equal(ETH("3"));
            expect(await vault.totalRefunded()).to.equal(ETH("2"));
            expect(await ethers.provider.getBalance(await vault.getAddress()))
                .to.equal(ETH("3"));
            await assertVaultAccountingInvariants();
        });

        it("should reject a zero refund", async function () {
            await expect(vault.connect(donor).refund(0))
                .to.be.revertedWithCustomError(vault, "ZeroRefund");
        });

        it("should reject a refund exceeding donor balance", async function () {
            await expect(vault.connect(donor).refund(ETH("6")))
                .to.be.revertedWithCustomError(vault, "InsufficientDonorBalance");
        });

        it("should reject a refund from a non-donor", async function () {
            await expect(vault.connect(attacker).refund(ETH("1")))
                .to.be.revertedWithCustomError(vault, "InsufficientDonorBalance");
        });

        it("should allow only repeated refunds up to the donor's remaining balance", async function () {
            await vault.connect(donor).refund(ETH("2"));
            await vault.connect(donor).refund(ETH("2"));

            expect(await vault.donorBalance(donor.address)).to.equal(ETH("1"));
            expect(await vault.totalRefunded()).to.equal(ETH("4"));

            await expect(vault.connect(donor).refund(ETH("2")))
                .to.be.revertedWithCustomError(vault, "InsufficientDonorBalance");
        });

        it("should close refunds after a successful reservation", async function () {
            await vault.connect(attacker).deposit({ value: ETH("3") });
            await vault.grantRole(
                await vault.MILESTONE_ROLE(),
                admin.address
            );
            await vault.connect(admin).reserveFunds(ETH("2"));

            expect(await vault.refundsClosed()).to.equal(true);
            await expect(vault.connect(donor).refund(ETH("1")))
                .to.be.revertedWithCustomError(vault, "RefundsClosed");
            await expect(vault.connect(attacker).refund(ETH("1")))
                .to.be.revertedWithCustomError(vault, "RefundsClosed");

            expect(await vault.donorBalance(donor.address)).to.equal(ETH("5"));
            expect(await vault.donorBalance(attacker.address)).to.equal(ETH("3"));
            expect(await vault.totalRefunded()).to.equal(0);
        });

        it("should not close refunds after a failed reservation", async function () {
            await vault.grantRole(await vault.MILESTONE_ROLE(), admin.address);

            await expect(vault.connect(admin).reserveFunds(ETH("6")))
                .to.be.revertedWithCustomError(vault, "InsufficientUncommittedFunds");

            expect(await vault.refundsClosed()).to.equal(false);
            await vault.connect(donor).refund(ETH("1"));
            expect(await vault.totalRefunded()).to.equal(ETH("1"));
        });

        it("should leave balances unchanged when refund after closure is attempted", async function () {
            await vault.grantRole(await vault.MILESTONE_ROLE(), admin.address);
            await vault.connect(donor).refund(ETH("1"));

            await vault.connect(attacker).deposit({ value: ETH("2") });
            await vault.connect(admin).reserveFunds(ETH("2"));

            const donorBalance = await vault.donorBalance(donor.address);
            const attackerBalance = await vault.donorBalance(attacker.address);
            const refundable = await vault.totalRefundable();
            const committed = await vault.totalCommitted();

            await expect(vault.connect(donor).refund(ETH("3")))
                .to.be.revertedWithCustomError(vault, "RefundsClosed");

            expect(await vault.donorBalance(donor.address)).to.equal(donorBalance);
            expect(await vault.donorBalance(attacker.address)).to.equal(attackerBalance);
            expect(await vault.totalRefundable()).to.equal(refundable);
            expect(await vault.totalCommitted()).to.equal(committed);
        });

        it("should keep released funds out of the refundable pool", async function () {
            await vault.grantRole(await vault.MILESTONE_ROLE(), admin.address);
            await vault.grantRole(await vault.DISBURSEMENT_ROLE(), admin.address);

            await vault.connect(admin).reserveFunds(ETH("2"));
            expect(await vault.totalRefundable()).to.equal(ETH("3"));

            await vault.connect(admin).releaseTo(
                beneficiary.address,
                ETH("2")
            );

            expect(await vault.totalCommitted()).to.equal(0);
            expect(await vault.totalRefundable()).to.equal(ETH("3"));
            await assertVaultAccountingInvariants();
        });
    });

    describe("Access Control", function () {
        it("should reject unauthorized project creation", async function () {
            await expect(registry.connect(attacker).createProject(
                "Fake Project",
                "Unauthorized"
            )).to.be.reverted;
        });

        it("should reject unauthorized beneficiary approval", async function () {
            await registry.connect(ngo).createProject("Project", "Description");
            await registry.connect(ngo).registerBeneficiary(
                1,
                beneficiary.address,
                ethers.keccak256(ethers.toUtf8Bytes("secret"))
            );
            await expect(registry.connect(ngo).approveBeneficiary(
                1,
                beneficiary.address
            )).to.be.reverted;
        });

        it("should reject unauthorized fund reservation", async function () {
            await expect(vault.connect(attacker).reserveFunds(ETH("1")))
                .to.be.reverted;
        });

        it("should reject unauthorized direct fund release", async function () {
            await expect(vault.connect(attacker).releaseTo(
                beneficiary.address,
                ETH("1")
            )).to.be.reverted;
        });

        it("should reject unauthorized milestone approval", async function () {
            await createApprovedBeneficiary();
            await milestone.connect(ngo).createMilestone(
                1,
                beneficiary.address,
                ETH("1"),
                "QmEvidenceCID"
            );
            await expect(milestone.connect(ngo).approveMilestone(1))
                .to.be.reverted;
        });
    });

    describe("ProjectRegistry", function () {
        it("should allow NGO to create a project", async function () {
            await registry.connect(ngo).createProject(
                "Education Support",
                "Student assistance"
            );
            const project = await registry.projects(1);
            expect(project.ngo).to.equal(ngo.address);
            expect(project.active).to.equal(true);
        });

        it("should reject an empty project name", async function () {
            await expect(registry.connect(ngo).createProject("", "Description"))
                .to.be.revertedWith("Project name required");
        });

        it("should allow NGO to register a beneficiary", async function () {
            await registry.connect(ngo).createProject("Project", "Description");
            await registry.connect(ngo).registerBeneficiary(
                1,
                beneficiary.address,
                ethers.keccak256(ethers.toUtf8Bytes("unique-secret"))
            );
            const record = await registry.getBeneficiary(
                1,
                beneficiary.address
            );
            expect(record.exists).to.equal(true);
            expect(record.approved).to.equal(false);
        });

        it("should reject duplicate beneficiary registration", async function () {
            await registry.connect(ngo).createProject("Project", "Description");
            const commitment = ethers.keccak256(
                ethers.toUtf8Bytes("secret")
            );
            await registry.connect(ngo).registerBeneficiary(
                1,
                beneficiary.address,
                commitment
            );
            await expect(registry.connect(ngo).registerBeneficiary(
                1,
                beneficiary.address,
                ethers.keccak256(ethers.toUtf8Bytes("another-secret"))
            )).to.be.revertedWith("Beneficiary already registered");
        });

        it("should reject duplicate identity commitments", async function () {
            await registry.connect(ngo).createProject("Project", "Description");
            const commitment = ethers.keccak256(
                ethers.toUtf8Bytes("same-secret")
            );
            await registry.connect(ngo).registerBeneficiary(
                1,
                beneficiary.address,
                commitment
            );
            await expect(registry.connect(ngo).registerBeneficiary(
                1,
                attacker.address,
                commitment
            )).to.be.revertedWith("Identity already registered");
        });

        it("should allow auditor to approve a beneficiary", async function () {
            await createApprovedBeneficiary();
            expect(await registry.isBeneficiaryApproved(
                1,
                beneficiary.address
            )).to.equal(true);
        });

        it("should prevent cross-project beneficiary reuse", async function () {
            await createApprovedBeneficiary();

            await registry.connect(ngo).createProject(
                "Second Project",
                "Separate project"
            );

            await expect(
                milestone.connect(ngo).createMilestone(
                    2,
                    beneficiary.address,
                    ETH("1"),
                    "QmCrossProjectEvidence"
                )
            ).to.be.revertedWith("Beneficiary not approved");
        });

        it("should prevent NGO 2 from registering a beneficiary in NGO 1's project", async function () {
            await registry.connect(ngo).createProject("Project", "Description");

            await expect(registry.connect(ngo2).registerBeneficiary(
                1,
                beneficiary.address,
                ethers.keccak256(ethers.toUtf8Bytes("ngo2-secret"))
            )).to.be.revertedWith("Not project owner");
        });
    });

    describe("MilestoneDisbursement", function () {
        beforeEach(async function () {
            await createApprovedBeneficiary();
            await vault.connect(donor).deposit({ value: ETH("5") });
        });

        it("should allow NGO to create a milestone", async function () {
            await milestone.connect(ngo).createMilestone(
                1,
                beneficiary.address,
                ETH("2"),
                "QmEvidenceCID"
            );
            const record = await milestone.getMilestone(1);
            expect(record.amount).to.equal(ETH("2"));
            expect(record.status).to.equal(0);
        });

        it("should reject milestone for an unapproved beneficiary", async function () {
            await registry.connect(ngo).registerBeneficiary(
                1,
                attacker.address,
                ethers.keccak256(ethers.toUtf8Bytes("second-secret"))
            );
            await expect(milestone.connect(ngo).createMilestone(
                1,
                attacker.address,
                ETH("1"),
                "QmEvidenceCID"
            )).to.be.revertedWith("Beneficiary not approved");
        });

        it("should reject milestone with missing evidence", async function () {
            await expect(milestone.connect(ngo).createMilestone(
                1,
                beneficiary.address,
                ETH("1"),
                ""
            )).to.be.revertedWith("Evidence required");
        });

        it("should release funds after auditor approval", async function () {
            await milestone.connect(ngo).createMilestone(
                1,
                beneficiary.address,
                ETH("2"),
                "QmEvidenceCID"
            );
            const before = await ethers.provider.getBalance(beneficiary.address);
            await milestone.connect(auditor).approveMilestone(1);
            const after = await ethers.provider.getBalance(beneficiary.address);
            expect(after - before).to.equal(ETH("2"));
            expect(await vault.totalReleased()).to.equal(ETH("2"));
            const record = await milestone.getMilestone(1);
            expect(record.status).to.equal(1);
        });

        it("should reject approval of an already released milestone", async function () {
            await milestone.connect(ngo).createMilestone(
                1,
                beneficiary.address,
                ETH("1"),
                "QmEvidenceCID"
            );
            await milestone.connect(auditor).approveMilestone(1);
            await expect(milestone.connect(auditor).approveMilestone(1))
                .to.be.revertedWith("Not pending");
        });

        it("should allow auditor to reject a milestone", async function () {
            await milestone.connect(ngo).createMilestone(
                1,
                beneficiary.address,
                ETH("1"),
                "QmEvidenceCID"
            );
            await milestone.connect(auditor).rejectMilestone(1);
            const record = await milestone.getMilestone(1);
            expect(record.status).to.equal(2);
        });

        it("should reject release when vault has insufficient funds", async function () {
            await milestone.connect(ngo).createMilestone(
                1,
                beneficiary.address,
                ETH("6"),
                "QmEvidenceCID"
            );
            await expect(milestone.connect(auditor).approveMilestone(1))
                .to.be.revertedWithCustomError(vault, "InsufficientUncommittedFunds");
            const record = await milestone.getMilestone(1);
            expect(record.status).to.equal(0);
            expect(await vault.totalCommitted()).to.equal(0);
        });

        it("should prevent NGO 2 from creating a milestone in NGO 1's project", async function () {
            await expect(milestone.connect(ngo2).createMilestone(
                1,
                beneficiary.address,
                ETH("1"),
                "QmNgo2Evidence"
            )).to.be.revertedWith("Not project owner");
        });

        it("should reject approval after a milestone is rejected", async function () {
            await milestone.connect(ngo).createMilestone(
                1,
                beneficiary.address,
                ETH("1"),
                "QmEvidenceCID"
            );
            await milestone.connect(auditor).rejectMilestone(1);

            await expect(milestone.connect(auditor).approveMilestone(1))
                .to.be.revertedWith("Not pending");
            expect(await vault.refundsClosed()).to.equal(false);
        });

        it("should roll back reservation and closure when ETH release fails", async function () {
            const RevertingBeneficiary =
                await ethers.getContractFactory("RevertingBeneficiary");
            const revertingBeneficiary = await RevertingBeneficiary.deploy();
            await revertingBeneficiary.waitForDeployment();

            await registry.connect(ngo).registerBeneficiary(
                1,
                revertingBeneficiary.getAddress(),
                ethers.keccak256(ethers.toUtf8Bytes("reverting-secret"))
            );
            await registry.connect(auditor).approveBeneficiary(
                1,
                await revertingBeneficiary.getAddress()
            );

            await milestone.connect(ngo).createMilestone(
                1,
                await revertingBeneficiary.getAddress(),
                ETH("1"),
                "QmRevertingEvidence"
            );

            await expect(milestone.connect(auditor).approveMilestone(1))
                .to.be.revertedWithCustomError(vault, "BeneficiaryTransferFailed");

            const record = await milestone.getMilestone(1);
            expect(record.status).to.equal(0);
            expect(await vault.totalCommitted()).to.equal(0);
            expect(await vault.refundsClosed()).to.equal(false);
        });
    });

    describe("Emergency Pause", function () {
        it("should stop donations when vault is paused", async function () {
            await vault.connect(admin).pause();
            await expect(vault.connect(donor).deposit({ value: ETH("1") }))
                .to.be.reverted;
        });

        it("should reject pause by an unauthorized account", async function () {
            await expect(vault.connect(attacker).pause()).to.be.reverted;
        });

        it("should allow admin to unpause the vault", async function () {
            await vault.connect(admin).pause();
            await vault.connect(admin).unpause();
            await vault.connect(donor).deposit({ value: ETH("1") });
            expect(await vault.donorBalance(donor.address)).to.equal(ETH("1"));
        });

        it("should stop project creation when registry is paused", async function () {
            await registry.connect(admin).pause();
            await expect(registry.connect(ngo).createProject(
                "Project",
                "Description"
            )).to.be.reverted;
        });

        it("should stop milestone creation and approval while milestone contract is paused", async function () {
            await createApprovedBeneficiary();
            await milestone.connect(admin).pause();

            await expect(milestone.connect(ngo).createMilestone(
                1,
                beneficiary.address,
                ETH("1"),
                "QmPausedEvidence"
            )).to.be.reverted;

            await milestone.connect(admin).unpause();
            await milestone.connect(ngo).createMilestone(
                1,
                beneficiary.address,
                ETH("1"),
                "QmPausedEvidence"
            );

            await milestone.connect(admin).pause();
            await expect(milestone.connect(auditor).approveMilestone(1))
                .to.be.reverted;
        });

        it("should reject milestone pause by an unauthorized account", async function () {
            await expect(milestone.connect(attacker).pause()).to.be.reverted;
        });

        it("should keep vault and milestone pause states independent", async function () {
            await vault.connect(admin).pause();
            expect(await vault.paused()).to.equal(true);
            expect(await milestone.paused()).to.equal(false);

            await milestone.connect(admin).pause();
            expect(await vault.paused()).to.equal(true);
            expect(await milestone.paused()).to.equal(true);
        });
    });

    describe("Reentrancy Protection", function () {
        it("should block a reentrant refund attack", async function () {
            const Attacker = await ethers.getContractFactory(
                "ReentrancyAttacker"
            );
            const malicious = await Attacker.deploy(await vault.getAddress());
            await malicious.waitForDeployment();

            await malicious.donate({ value: ETH("2") });
            await malicious.attack(ETH("1"));

            expect(await malicious.reentryBlocked()).to.equal(true);
            expect(await vault.donorBalance(await malicious.getAddress()))
                .to.equal(ETH("1"));
            expect(await vault.totalRefunded()).to.equal(ETH("1"));
        });
    });

    describe("Gas Measurements", function () {
        it("should record gas used by key operations", async function () {
            const donation = await vault.connect(donor).deposit({
                value: ETH("1")
            });
            const donationReceipt = await donation.wait();

            await registry.connect(ngo).createProject(
                "Gas Test Project",
                "Gas measurement"
            );

            const registration = await registry.connect(ngo).registerBeneficiary(
                1,
                beneficiary.address,
                ethers.keccak256(ethers.toUtf8Bytes("gas-secret"))
            );
            const registrationReceipt = await registration.wait();

            await registry.connect(auditor).approveBeneficiary(
                1,
                beneficiary.address
            );

            const creation = await milestone.connect(ngo).createMilestone(
                1,
                beneficiary.address,
                ETH("1"),
                "QmGasEvidence"
            );
            const creationReceipt = await creation.wait();

            const approval = await milestone.connect(auditor).approveMilestone(1);
            const approvalReceipt = await approval.wait();

            console.log("\n--- GIVECHAIN GAS REPORT ---");
            console.log("Donation:", donationReceipt.gasUsed.toString());
            console.log("Beneficiary registration:", registrationReceipt.gasUsed.toString());
            console.log("Milestone creation:", creationReceipt.gasUsed.toString());
            console.log("Milestone approval + release:", approvalReceipt.gasUsed.toString());
        });
    });
});
