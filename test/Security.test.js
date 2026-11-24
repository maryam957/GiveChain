const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const {
    USDC,
    identityCommitment,
    MilestoneStatus,
    SAMPLE_CID,
    EVIDENCE_CID,
    deploySystemFixture,
    deployVaultFixture,
} = require("./helpers/fixtures");

// Security evidence for docs/GiveChain-Security-Package.md.
// S1-S8 are the eight negative scenarios required by the project specification.
// M1-M5 are GiveChain-specific misuse scenarios.
// Every test runs against the full real system (no mocks) unless stated.

describe("Security scenarios", function () {
    // Full system with milestone 1 (300 for `beneficiary`) approved and ready to release.
    async function withApprovedMilestone() {
        const ctx = await deploySystemFixture();
        await ctx.milestones
            .connect(ctx.ngo)
            .submitMilestone(1, ctx.beneficiary.address, USDC(300), EVIDENCE_CID);
        await ctx.milestones.connect(ctx.auditor).approveMilestone(1);
        return ctx;
    }

    describe("S1: unauthorized user attempts to release funds", function () {
        it("blocks everyone except the campaign's NGO from releasing a milestone", async function () {
            const { milestones, ngo2, auditor, admin, donor, beneficiary, stranger } =
                await loadFixture(withApprovedMilestone);
            await expect(milestones.connect(ngo2).releaseMilestone(1))
                .to.be.revertedWithCustomError(milestones, "NotCampaignNgo");
            for (const account of [auditor, admin, donor, beneficiary, stranger]) {
                await expect(milestones.connect(account).releaseMilestone(1))
                    .to.be.revertedWithCustomError(milestones, "MissingRole");
            }
        });

        it("blocks everyone, including the admin and NGO, from calling the vault directly", async function () {
            const { vault, admin, ngo, auditor, stranger, beneficiary } =
                await loadFixture(withApprovedMilestone);
            for (const account of [admin, ngo, auditor, stranger]) {
                await expect(vault.connect(account).releaseFunds(1))
                    .to.be.revertedWithCustomError(vault, "NotDisbursementContract");
                await expect(
                    vault.connect(account).reserveFunds(1, 99, beneficiary.address, USDC(1))
                ).to.be.revertedWithCustomError(vault, "NotDisbursementContract");
            }
        });

        it("leaves the vault balance untouched after all the failed attempts", async function () {
            const { vault, token } = await loadFixture(withApprovedMilestone);
            expect(await token.balanceOf(await vault.getAddress())).to.equal(USDC(1000));
        });
    });

    describe("S2: reentrancy attack against a refund", function () {
        // Same system, but built on HookToken: every transfer to a contract triggers a
        // callback, giving the attacker a chance to re-enter claimRefund.
        async function hookTokenSystem() {
            const [admin, ngo, auditor, donor] = await ethers.getSigners();
            const access = await (await ethers.getContractFactory("GiveChainAccess")).deploy(
                admin.address
            );
            const token = await (await ethers.getContractFactory("HookToken")).deploy();
            const registry = await (await ethers.getContractFactory("ProjectRegistry")).deploy(
                await access.getAddress()
            );
            const vault = await (await ethers.getContractFactory("DonationVault")).deploy(
                await access.getAddress(),
                await registry.getAddress(),
                await token.getAddress()
            );
            const milestones = await (
                await ethers.getContractFactory("MilestoneDisbursement")
            ).deploy(
                await access.getAddress(),
                await registry.getAddress(),
                await vault.getAddress()
            );
            await vault.setDisbursementContract(await milestones.getAddress());
            await access.grantRole(await access.NGO_ROLE(), ngo.address);
            await access.grantRole(await access.AUDITOR_ROLE(), auditor.address);
            await registry.connect(ngo).createCampaign(USDC(1000), SAMPLE_CID);

            const attacker = await (
                await ethers.getContractFactory("RefundReentrancyAttacker")
            ).deploy(await vault.getAddress(), await token.getAddress());

            // An honest donor gives 900; the attacker contract gives 100.
            await token.connect(donor).faucet(USDC(900));
            await token.connect(donor).approve(await vault.getAddress(), USDC(900));
            await vault.connect(donor).donate(1, USDC(900));
            await token.connect(donor).faucet(USDC(100));
            await token.connect(donor).transfer(await attacker.getAddress(), USDC(100));
            await attacker.donate(1, USDC(100));

            await registry.connect(ngo).cancelCampaign(1);
            return { vault, token, attacker, donor };
        }

        it("blocks the second, re-entrant refund claim", async function () {
            const { vault, attacker } = await loadFixture(hookTokenSystem);
            await attacker.attack(1);

            expect(await attacker.reentryAttempted()).to.equal(true);
            expect(await attacker.reentrySucceeded()).to.equal(false);
            const selector = vault.interface.getError("ReentrancyGuardReentrantCall").selector;
            expect(await attacker.reentryError()).to.equal(selector);
        });

        it("pays the attacker exactly its own share, once", async function () {
            const { vault, token, attacker } = await loadFixture(hookTokenSystem);
            await attacker.attack(1);
            expect(await token.balanceOf(await attacker.getAddress())).to.equal(USDC(100));
            expect((await vault.getCampaignFunds(1)).refunded).to.equal(USDC(100));
            await expect(attacker.attack(1))
                .to.be.revertedWithCustomError(vault, "RefundAlreadyClaimed");
        });

        it("control: the same attack DOES steal from a vault without these protections", async function () {
            // Proves the test is meaningful: against VulnerableRefundVault (transfer before
            // state update, no reentrancy guard) the identical attacker gets paid twice.
            const [, donor] = await ethers.getSigners();
            const token = await (await ethers.getContractFactory("HookToken")).deploy();
            const weakVault = await (
                await ethers.getContractFactory("VulnerableRefundVault")
            ).deploy(await token.getAddress());
            const attacker = await (
                await ethers.getContractFactory("RefundReentrancyAttacker")
            ).deploy(await weakVault.getAddress(), await token.getAddress());

            await token.connect(donor).faucet(USDC(1000));
            await token.connect(donor).approve(await weakVault.getAddress(), USDC(900));
            await weakVault.connect(donor).donate(1, USDC(900));
            await token.connect(donor).transfer(await attacker.getAddress(), USDC(100));
            await attacker.donate(1, USDC(100));
            await weakVault.close();

            await attacker.attack(1);
            expect(await attacker.reentrySucceeded()).to.equal(true);
            // Donated 100, walked away with 200: 100 of it was the honest donor's money.
            expect(await token.balanceOf(await attacker.getAddress())).to.equal(USDC(200));
            expect(await token.balanceOf(await weakVault.getAddress())).to.equal(USDC(800));
        });

        it("leaves the honest donor's money in the vault and claimable", async function () {
            const { vault, token, attacker, donor } = await loadFixture(hookTokenSystem);
            await attacker.attack(1);
            expect(await token.balanceOf(await vault.getAddress())).to.equal(USDC(900));
            await vault.connect(donor).claimRefund(1);
            expect(await token.balanceOf(donor.address)).to.equal(USDC(900));
        });
    });

    describe("S3: duplicate beneficiary registration", function () {
        it("rejects the same wallet twice", async function () {
            const { registry, ngo, beneficiary } = await loadFixture(deploySystemFixture);
            await expect(
                registry
                    .connect(ngo)
                    .registerBeneficiary(1, beneficiary.address, identityCommitment("x", "new-id"))
            ).to.be.revertedWithCustomError(registry, "BeneficiaryAlreadyRegistered");
        });

        it("rejects the same person under a new wallet (identity commitment reuse)", async function () {
            const { registry, ngo, stranger } = await loadFixture(deploySystemFixture);
            // `beneficiary` was registered with identityCommitment("s1", "id-1").
            await expect(
                registry
                    .connect(ngo)
                    .registerBeneficiary(1, stranger.address, identityCommitment("s1", "id-1"))
            ).to.be.revertedWithCustomError(registry, "IdentityAlreadyUsed");
        });
    });

    describe("S4: repeated distribution of the same allocation", function () {
        it("pays a milestone only once, however often release is called", async function () {
            const { milestones, token, ngo, beneficiary } =
                await loadFixture(withApprovedMilestone);
            await milestones.connect(ngo).releaseMilestone(1);
            for (let i = 0; i < 3; i++) {
                await expect(milestones.connect(ngo).releaseMilestone(1))
                    .to.be.revertedWithCustomError(milestones, "InvalidMilestoneStatus")
                    .withArgs(1n, MilestoneStatus.Released);
            }
            expect(await token.balanceOf(beneficiary.address)).to.equal(USDC(300));
        });

        it("cannot re-approve a paid milestone to reserve its money again", async function () {
            const { milestones, vault, ngo, auditor } = await loadFixture(withApprovedMilestone);
            await milestones.connect(ngo).releaseMilestone(1);
            await expect(milestones.connect(auditor).approveMilestone(1))
                .to.be.revertedWithCustomError(milestones, "InvalidMilestoneStatus");
            expect(await vault.availableBalance(1)).to.equal(USDC(700));
        });

        it("the vault itself refuses a second payout of the same reservation (defence in depth)", async function () {
            // Uses MockDisbursementCaller, which forwards requests without any checks,
            // to prove the vault does not rely on MilestoneDisbursement for this.
            const { vault, caller, donor, beneficiary } = await loadFixture(deployVaultFixture);
            await vault.connect(donor).donate(1, USDC(100));
            await caller.reserve(1, 1, beneficiary.address, USDC(100));
            await caller.release(1);
            await expect(caller.release(1))
                .to.be.revertedWithCustomError(vault, "InvalidReservationStatus");
        });
    });

    describe("S5: unauthorized milestone approval", function () {
        it("rejects approval by the NGO, the admin, a donor, the beneficiary or a stranger", async function () {
            const { milestones, ngo, admin, donor, beneficiary, stranger } =
                await loadFixture(deploySystemFixture);
            await milestones
                .connect(ngo)
                .submitMilestone(1, beneficiary.address, USDC(1), EVIDENCE_CID);
            for (const account of [ngo, admin, donor, beneficiary, stranger]) {
                await expect(milestones.connect(account).approveMilestone(1))
                    .to.be.revertedWithCustomError(milestones, "MissingRole");
            }
        });

        it("rejects approval by an auditor whose wallet owns the campaign", async function () {
            const { milestones, registry, access, roles, ngo2, auditor, beneficiary } =
                await loadFixture(deploySystemFixture);
            await registry.connect(ngo2).createCampaign(USDC(1), SAMPLE_CID);
            await registry
                .connect(ngo2)
                .registerBeneficiary(2, beneficiary.address, identityCommitment("s1", "id-1"));
            await registry.connect(auditor).approveBeneficiary(2, beneficiary.address);
            await milestones
                .connect(ngo2)
                .submitMilestone(2, beneficiary.address, USDC(1), EVIDENCE_CID);
            await access.revokeRole(roles.NGO, ngo2.address);
            await access.grantRole(roles.AUDITOR, ngo2.address);
            await expect(milestones.connect(ngo2).approveMilestone(1))
                .to.be.revertedWithCustomError(milestones, "ApproverIsCampaignNgo");
        });
    });

    describe("S6: invalid or missing milestone evidence", function () {
        it("rejects a milestone without an evidence CID", async function () {
            const { milestones, ngo, beneficiary } = await loadFixture(deploySystemFixture);
            await expect(
                milestones.connect(ngo).submitMilestone(1, beneficiary.address, USDC(1), "")
            ).to.be.revertedWithCustomError(milestones, "EmptyEvidenceCID");
            expect(await milestones.milestoneCount()).to.equal(0n);
        });

        it("records the exact evidence CID on-chain so it cannot be swapped later", async function () {
            const { milestones } = await loadFixture(withApprovedMilestone);
            expect((await milestones.getMilestone(1)).evidenceCID).to.equal(EVIDENCE_CID);
            // There is no function that changes evidenceCID after submission.
            expect(milestones.interface.fragments.map((f) => f.name)).to.not.include(
                "updateEvidence"
            );
        });
    });

    describe("S7: release attempt without sufficient funds", function () {
        it("refuses to approve (reserve) more than the campaign holds", async function () {
            const { milestones, vault, ngo, auditor, beneficiary } =
                await loadFixture(deploySystemFixture);
            await milestones
                .connect(ngo)
                .submitMilestone(1, beneficiary.address, USDC(1001), EVIDENCE_CID);
            await expect(milestones.connect(auditor).approveMilestone(1))
                .to.be.revertedWithCustomError(vault, "InsufficientCampaignFunds");
        });

        it("refuses to let two approvals together exceed the campaign's money", async function () {
            const { milestones, vault, ngo, auditor, beneficiary, beneficiary2 } =
                await loadFixture(deploySystemFixture);
            await milestones
                .connect(ngo)
                .submitMilestone(1, beneficiary.address, USDC(600), EVIDENCE_CID);
            await milestones
                .connect(ngo)
                .submitMilestone(1, beneficiary2.address, USDC(600), EVIDENCE_CID);
            await milestones.connect(auditor).approveMilestone(1);
            await expect(milestones.connect(auditor).approveMilestone(2))
                .to.be.revertedWithCustomError(vault, "InsufficientCampaignFunds")
                .withArgs(1n, USDC(600), USDC(400));
        });
    });

    describe("S8: actions while the system is paused", function () {
        it("blocks every state-changing action in every contract", async function () {
            const ctx = await loadFixture(withApprovedMilestone);
            const { access, registry, vault, milestones, ngo, auditor, donor, beneficiary } = ctx;
            const id = identityCommitment("p", "paused-id");
            await access.pause();

            const blocked = [
                [registry, registry.connect(ngo).createCampaign(USDC(1), SAMPLE_CID)],
                [registry, registry.connect(ngo).completeCampaign(1)],
                [registry, registry.connect(ngo).cancelCampaign(1)],
                [registry, registry.connect(ngo).registerBeneficiary(1, donor.address, id)],
                [registry, registry.connect(auditor).approveBeneficiary(1, beneficiary.address)],
                [registry, registry.connect(auditor).revokeBeneficiary(1, beneficiary.address)],
                [vault, vault.connect(donor).donate(1, USDC(1))],
                [vault, vault.connect(donor).claimRefund(1)],
                [
                    milestones,
                    milestones
                        .connect(ngo)
                        .submitMilestone(1, beneficiary.address, USDC(1), EVIDENCE_CID),
                ],
                [milestones, milestones.connect(auditor).approveMilestone(1)],
                [milestones, milestones.connect(auditor).rejectMilestone(1)],
                [milestones, milestones.connect(auditor).cancelMilestone(1)],
                [milestones, milestones.connect(ngo).releaseMilestone(1)],
                [milestones, milestones.connect(beneficiary).confirmReceipt(1)],
            ];
            for (const [contract, tx] of blocked) {
                await expect(tx).to.be.revertedWithCustomError(contract, "SystemPaused");
            }
        });

        it("still lets anyone read data while paused", async function () {
            const { access, vault, milestones, registry } = await loadFixture(withApprovedMilestone);
            await access.pause();
            expect(await vault.availableBalance(1)).to.equal(USDC(700));
            expect((await milestones.getMilestone(1)).status).to.equal(MilestoneStatus.Approved);
            expect(await registry.campaignCount()).to.equal(1n);
        });

        it("resumes normally after unpausing", async function () {
            const { access, milestones, token, ngo, beneficiary } =
                await loadFixture(withApprovedMilestone);
            await access.pause();
            await access.unpause();
            await milestones.connect(ngo).releaseMilestone(1);
            expect(await token.balanceOf(beneficiary.address)).to.equal(USDC(300));
        });

        it("cannot be triggered or lifted by anyone without the pauser role", async function () {
            const { access, ngo, auditor, stranger } = await loadFixture(deploySystemFixture);
            for (const account of [ngo, auditor, stranger]) {
                await expect(access.connect(account).pause())
                    .to.be.revertedWithCustomError(access, "AccessControlUnauthorizedAccount");
            }
            await access.pause();
            await expect(access.connect(stranger).unpause())
                .to.be.revertedWithCustomError(access, "AccessControlUnauthorizedAccount");
        });
    });

    describe("M1: an NGO tries to pay itself", function () {
        it("cannot register its own wallet as a beneficiary", async function () {
            const { registry, ngo } = await loadFixture(deploySystemFixture);
            await expect(
                registry.connect(ngo).registerBeneficiary(1, ngo.address, identityCommitment("n", "n"))
            ).to.be.revertedWithCustomError(registry, "NgoCannotBeBeneficiary");
        });

        it("cannot get a sockpuppet wallet paid without an auditor approving it", async function () {
            const { registry, milestones, ngo, stranger } = await loadFixture(deploySystemFixture);
            await registry
                .connect(ngo)
                .registerBeneficiary(1, stranger.address, identityCommitment("sock", "fake"));
            await expect(
                milestones.connect(ngo).submitMilestone(1, stranger.address, USDC(500), EVIDENCE_CID)
            ).to.be.revertedWithCustomError(milestones, "BeneficiaryNotEligible");
        });

        it("never receives any tokens during a full payout", async function () {
            const { milestones, token, ngo } = await loadFixture(withApprovedMilestone);
            await milestones.connect(ngo).releaseMilestone(1);
            expect(await token.balanceOf(ngo.address)).to.equal(0n);
        });
    });

    describe("M2: a campaign tries to spend another campaign's donations", function () {
        it("is limited to its own balance even when the vault holds more", async function () {
            const { registry, vault, milestones, token, ngo2, auditor, beneficiary } =
                await loadFixture(deploySystemFixture);
            // Campaign 2 (ngo2) has no donations; campaign 1 holds 1,000.
            await registry.connect(ngo2).createCampaign(USDC(1), SAMPLE_CID);
            await registry
                .connect(ngo2)
                .registerBeneficiary(2, beneficiary.address, identityCommitment("s1", "id-1"));
            await registry.connect(auditor).approveBeneficiary(2, beneficiary.address);
            await milestones
                .connect(ngo2)
                .submitMilestone(2, beneficiary.address, USDC(1), EVIDENCE_CID);

            expect(await token.balanceOf(await vault.getAddress())).to.equal(USDC(1000));
            await expect(milestones.connect(auditor).approveMilestone(1))
                .to.be.revertedWithCustomError(vault, "InsufficientCampaignFunds")
                .withArgs(2n, USDC(1), 0n);
        });
    });

    describe("M3: the admin key is stolen", function () {
        it("cannot move money, approve anything, or redirect the vault", async function () {
            const { vault, milestones, registry, admin, beneficiary } =
                await loadFixture(withApprovedMilestone);
            await expect(vault.connect(admin).releaseFunds(1))
                .to.be.revertedWithCustomError(vault, "NotDisbursementContract");
            await expect(milestones.connect(admin).releaseMilestone(1))
                .to.be.revertedWithCustomError(milestones, "MissingRole");
            await expect(registry.connect(admin).approveBeneficiary(1, beneficiary.address))
                .to.be.revertedWithCustomError(registry, "MissingRole");
            await expect(vault.connect(admin).setDisbursementContract(await registry.getAddress()))
                .to.be.revertedWithCustomError(vault, "DisbursementAlreadySet");
        });

        it("can only cancel campaigns, which sends unspent money back to donors, not to the admin", async function () {
            const { vault, registry, token, admin, donor } = await loadFixture(withApprovedMilestone);
            await registry.connect(admin).cancelCampaign(1);
            await vault.connect(donor).claimRefund(1);
            expect(await token.balanceOf(donor.address)).to.equal(USDC(10000));
            expect(await token.balanceOf(admin.address)).to.equal(0n);
        });
    });

    describe("M4: refund abuse", function () {
        it("blocks refunds while a campaign is still running", async function () {
            const { vault, donor } = await loadFixture(deploySystemFixture);
            await expect(vault.connect(donor).claimRefund(1))
                .to.be.revertedWithCustomError(vault, "CampaignNotClosed");
        });

        it("blocks a second claim and claims by non-donors", async function () {
            const { vault, registry, ngo, donor, stranger } = await loadFixture(deploySystemFixture);
            await registry.connect(ngo).cancelCampaign(1);
            await vault.connect(donor).claimRefund(1);
            await expect(vault.connect(donor).claimRefund(1))
                .to.be.revertedWithCustomError(vault, "RefundAlreadyClaimed");
            await expect(vault.connect(stranger).claimRefund(1))
                .to.be.revertedWithCustomError(vault, "NoContribution");
        });

        it("does not refund money that was already paid to beneficiaries", async function () {
            const { vault, milestones, registry, token, ngo, donor } =
                await loadFixture(withApprovedMilestone);
            await milestones.connect(ngo).releaseMilestone(1);
            await registry.connect(ngo).completeCampaign(1);
            await vault.connect(donor).claimRefund(1);
            // Donor gave 1,000; 300 was paid out, so 700 comes back.
            expect(await token.balanceOf(donor.address)).to.equal(USDC(9700));
        });
    });

    describe("M5: one person holding conflicting roles", function () {
        it("cannot be both NGO and auditor", async function () {
            const { access, roles, ngo, auditor } = await loadFixture(deploySystemFixture);
            await expect(access.grantRole(roles.AUDITOR, ngo.address))
                .to.be.revertedWithCustomError(access, "ConflictingRole");
            await expect(access.grantRole(roles.NGO, auditor.address))
                .to.be.revertedWithCustomError(access, "ConflictingRole");
        });
    });
});
