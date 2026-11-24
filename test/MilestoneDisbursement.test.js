const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const {
    USDC,
    identityCommitment,
    MilestoneStatus,
    ReservationStatus,
    SAMPLE_CID,
    EVIDENCE_CID,
    deploySystemFixture,
} = require("./helpers/fixtures");

describe("MilestoneDisbursement", function () {
    // Milestone 1: 300 mUSDC for `beneficiary`, submitted by `ngo`.
    async function withSubmitted() {
        const ctx = await deploySystemFixture();
        await ctx.milestones
            .connect(ctx.ngo)
            .submitMilestone(1, ctx.beneficiary.address, USDC(300), EVIDENCE_CID);
        return ctx;
    }

    // withSubmitted plus auditor approval (300 reserved in the vault).
    async function withApproved() {
        const ctx = await withSubmitted();
        await ctx.milestones.connect(ctx.auditor).approveMilestone(1);
        return ctx;
    }

    // withApproved plus release (300 paid to `beneficiary`).
    async function withReleased() {
        const ctx = await withApproved();
        await ctx.milestones.connect(ctx.ngo).releaseMilestone(1);
        return ctx;
    }

    describe("Deployment", function () {
        it("stores the registry and vault addresses", async function () {
            const { milestones, registry, vault } = await loadFixture(deploySystemFixture);
            expect(await milestones.registry()).to.equal(await registry.getAddress());
            expect(await milestones.vault()).to.equal(await vault.getAddress());
            expect(await milestones.milestoneCount()).to.equal(0n);
        });

        it("rejects zero addresses in the constructor", async function () {
            const { access, registry, vault } = await loadFixture(deploySystemFixture);
            const Milestones = await ethers.getContractFactory("MilestoneDisbursement");
            const a = await access.getAddress();
            const r = await registry.getAddress();
            const v = await vault.getAddress();
            const Z = ethers.ZeroAddress;
            for (const args of [
                [Z, r, v],
                [a, Z, v],
                [a, r, Z],
            ]) {
                await expect(Milestones.deploy(...args)).to.be.revertedWithCustomError(
                    Milestones,
                    "ZeroAddress"
                );
            }
        });
    });

    describe("submitMilestone", function () {
        it("records a Submitted milestone and emits an event", async function () {
            const { milestones, ngo, beneficiary } = await loadFixture(deploySystemFixture);
            await expect(
                milestones
                    .connect(ngo)
                    .submitMilestone(1, beneficiary.address, USDC(300), EVIDENCE_CID)
            )
                .to.emit(milestones, "MilestoneSubmitted")
                .withArgs(1n, 1n, beneficiary.address, USDC(300), EVIDENCE_CID);

            const m = await milestones.getMilestone(1);
            expect(m.campaignId).to.equal(1n);
            expect(m.beneficiary).to.equal(beneficiary.address);
            expect(m.amount).to.equal(USDC(300));
            // Storage keeps keccak256(CID); the full CID is in the MilestoneSubmitted event.
            expect(m.evidenceHash).to.equal(ethers.id(EVIDENCE_CID));
            expect(m.status).to.equal(MilestoneStatus.Submitted);
            expect(m.submittedAt).to.be.greaterThan(0n);
            expect(m.reviewedBy).to.equal(ethers.ZeroAddress);
            expect(await milestones.milestoneCount()).to.equal(1n);
        });

        it("does not reserve any money yet", async function () {
            const { vault } = await loadFixture(withSubmitted);
            expect(await vault.availableBalance(1)).to.equal(USDC(1000));
        });

        it("allows requesting more than the campaign currently holds", async function () {
            const { milestones, ngo, beneficiary } = await loadFixture(deploySystemFixture);
            await milestones
                .connect(ngo)
                .submitMilestone(1, beneficiary.address, USDC(5000), EVIDENCE_CID);
            expect((await milestones.getMilestone(1)).status).to.equal(MilestoneStatus.Submitted);
        });

        it("allows several milestones for the same beneficiary", async function () {
            const { milestones, ngo, beneficiary } = await loadFixture(withSubmitted);
            await milestones
                .connect(ngo)
                .submitMilestone(1, beneficiary.address, USDC(100), EVIDENCE_CID);
            expect(await milestones.milestoneCount()).to.equal(2n);
        });

        it("rejects a caller without the NGO role", async function () {
            const { milestones, auditor, stranger, beneficiary } =
                await loadFixture(deploySystemFixture);
            for (const account of [auditor, stranger, beneficiary]) {
                await expect(
                    milestones
                        .connect(account)
                        .submitMilestone(1, beneficiary.address, USDC(1), EVIDENCE_CID)
                ).to.be.revertedWithCustomError(milestones, "MissingRole");
            }
        });

        it("rejects an NGO submitting for another NGO's campaign", async function () {
            const { milestones, ngo2, beneficiary } = await loadFixture(deploySystemFixture);
            await expect(
                milestones
                    .connect(ngo2)
                    .submitMilestone(1, beneficiary.address, USDC(1), EVIDENCE_CID)
            )
                .to.be.revertedWithCustomError(milestones, "NotCampaignNgo")
                .withArgs(1n, ngo2.address);
        });

        it("rejects missing evidence", async function () {
            const { milestones, ngo, beneficiary } = await loadFixture(deploySystemFixture);
            await expect(
                milestones.connect(ngo).submitMilestone(1, beneficiary.address, USDC(1), "")
            ).to.be.revertedWithCustomError(milestones, "EmptyEvidenceCID");
        });

        it("rejects a zero amount", async function () {
            const { milestones, ngo, beneficiary } = await loadFixture(deploySystemFixture);
            await expect(
                milestones.connect(ngo).submitMilestone(1, beneficiary.address, 0, EVIDENCE_CID)
            ).to.be.revertedWithCustomError(milestones, "ZeroAmount");
        });

        it("rejects an unregistered, unapproved or revoked beneficiary", async function () {
            const { milestones, registry, ngo, auditor, beneficiary, stranger } =
                await loadFixture(deploySystemFixture);

            await expect(
                milestones.connect(ngo).submitMilestone(1, stranger.address, USDC(1), EVIDENCE_CID)
            )
                .to.be.revertedWithCustomError(milestones, "BeneficiaryNotEligible")
                .withArgs(1n, stranger.address);

            await registry
                .connect(ngo)
                .registerBeneficiary(1, stranger.address, identityCommitment("s9", "id-9"));
            await expect(
                milestones.connect(ngo).submitMilestone(1, stranger.address, USDC(1), EVIDENCE_CID)
            ).to.be.revertedWithCustomError(milestones, "BeneficiaryNotEligible");

            await registry.connect(auditor).revokeBeneficiary(1, beneficiary.address);
            await expect(
                milestones
                    .connect(ngo)
                    .submitMilestone(1, beneficiary.address, USDC(1), EVIDENCE_CID)
            ).to.be.revertedWithCustomError(milestones, "BeneficiaryNotEligible");
        });

        it("rejects a closed or non-existent campaign", async function () {
            const { milestones, registry, ngo, beneficiary } =
                await loadFixture(deploySystemFixture);
            await expect(
                milestones
                    .connect(ngo)
                    .submitMilestone(99, beneficiary.address, USDC(1), EVIDENCE_CID)
            )
                .to.be.revertedWithCustomError(milestones, "CampaignNotActive")
                .withArgs(99n);

            await registry.connect(ngo).completeCampaign(1);
            await expect(
                milestones
                    .connect(ngo)
                    .submitMilestone(1, beneficiary.address, USDC(1), EVIDENCE_CID)
            ).to.be.revertedWithCustomError(milestones, "CampaignNotActive");
        });

        it("is blocked while the system is paused", async function () {
            const { milestones, access, ngo, beneficiary } =
                await loadFixture(deploySystemFixture);
            await access.pause();
            await expect(
                milestones
                    .connect(ngo)
                    .submitMilestone(1, beneficiary.address, USDC(1), EVIDENCE_CID)
            ).to.be.revertedWithCustomError(milestones, "SystemPaused");
        });
    });

    describe("approveMilestone", function () {
        it("approves, records the auditor and reserves the money in the vault", async function () {
            const { milestones, vault, auditor, beneficiary } = await loadFixture(withSubmitted);
            await expect(milestones.connect(auditor).approveMilestone(1))
                .to.emit(milestones, "MilestoneApproved")
                .withArgs(1n, auditor.address)
                .and.to.emit(vault, "FundsReserved")
                .withArgs(1n, 1n, beneficiary.address, USDC(300));

            const m = await milestones.getMilestone(1);
            expect(m.status).to.equal(MilestoneStatus.Approved);
            expect(m.reviewedBy).to.equal(auditor.address);
            expect(await vault.availableBalance(1)).to.equal(USDC(700));
            expect((await vault.getReservation(1)).status).to.equal(ReservationStatus.Reserved);
        });

        it("rejects the NGO, the admin and strangers", async function () {
            const { milestones, ngo, admin, stranger, roles } = await loadFixture(withSubmitted);
            await expect(milestones.connect(ngo).approveMilestone(1))
                .to.be.revertedWithCustomError(milestones, "MissingRole")
                .withArgs(ngo.address, roles.AUDITOR);
            await expect(milestones.connect(admin).approveMilestone(1))
                .to.be.revertedWithCustomError(milestones, "MissingRole");
            await expect(milestones.connect(stranger).approveMilestone(1))
                .to.be.revertedWithCustomError(milestones, "MissingRole");
        });

        it("rejects approving twice", async function () {
            const { milestones, auditor } = await loadFixture(withApproved);
            await expect(milestones.connect(auditor).approveMilestone(1))
                .to.be.revertedWithCustomError(milestones, "InvalidMilestoneStatus")
                .withArgs(1n, MilestoneStatus.Approved);
        });

        it("rejects approving a rejected or non-existent milestone", async function () {
            const { milestones, auditor } = await loadFixture(withSubmitted);
            await milestones.connect(auditor).rejectMilestone(1);
            await expect(milestones.connect(auditor).approveMilestone(1))
                .to.be.revertedWithCustomError(milestones, "InvalidMilestoneStatus")
                .withArgs(1n, MilestoneStatus.Rejected);
            await expect(milestones.connect(auditor).approveMilestone(42))
                .to.be.revertedWithCustomError(milestones, "InvalidMilestoneStatus")
                .withArgs(42n, MilestoneStatus.None);
        });

        it("fails, leaving the milestone Submitted, if the campaign lacks money", async function () {
            const { milestones, vault, ngo, auditor, beneficiary } =
                await loadFixture(deploySystemFixture);
            await milestones
                .connect(ngo)
                .submitMilestone(1, beneficiary.address, USDC(1000) + 1n, EVIDENCE_CID);
            await expect(milestones.connect(auditor).approveMilestone(1))
                .to.be.revertedWithCustomError(vault, "InsufficientCampaignFunds")
                .withArgs(1n, USDC(1000) + 1n, USDC(1000));
            expect((await milestones.getMilestone(1)).status).to.equal(MilestoneStatus.Submitted);
        });

        it("succeeds once enough donations arrive", async function () {
            const { milestones, vault, ngo, auditor, donor2, beneficiary } =
                await loadFixture(deploySystemFixture);
            await milestones
                .connect(ngo)
                .submitMilestone(1, beneficiary.address, USDC(1500), EVIDENCE_CID);
            await expect(milestones.connect(auditor).approveMilestone(1)).to.be.reverted;
            await vault.connect(donor2).donate(1, USDC(500));
            await milestones.connect(auditor).approveMilestone(1);
            expect(await vault.availableBalance(1)).to.equal(0n);
        });

        it("fails if the beneficiary was revoked after submission", async function () {
            const { milestones, vault, registry, auditor, beneficiary } =
                await loadFixture(withSubmitted);
            await registry.connect(auditor).revokeBeneficiary(1, beneficiary.address);
            await expect(milestones.connect(auditor).approveMilestone(1))
                .to.be.revertedWithCustomError(vault, "BeneficiaryNotEligible");
        });

        it("fails if the campaign closed after submission", async function () {
            const { milestones, vault, registry, ngo, auditor } = await loadFixture(withSubmitted);
            await registry.connect(ngo).cancelCampaign(1);
            await expect(milestones.connect(auditor).approveMilestone(1))
                .to.be.revertedWithCustomError(vault, "BeneficiaryNotEligible");
        });

        it("blocks an auditor from approving a campaign whose NGO wallet is their own", async function () {
            // A wallet creates a campaign as an NGO, loses the NGO role and becomes an auditor.
            const { milestones, registry, access, vault, roles, ngo2, auditor, beneficiary } =
                await loadFixture(deploySystemFixture);
            await registry.connect(ngo2).createCampaign(USDC(100), SAMPLE_CID);
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
                .to.be.revertedWithCustomError(milestones, "ApproverIsCampaignNgo")
                .withArgs(1n);
            expect(await vault.availableBalance(2)).to.equal(0n);
        });

        it("blocks an auditor from approving a payment to themselves", async function () {
            const { milestones, registry, access, roles, ngo, auditor, stranger } =
                await loadFixture(deploySystemFixture);
            // `stranger` is a beneficiary approved by `auditor`, and later becomes an auditor too.
            await registry
                .connect(ngo)
                .registerBeneficiary(1, stranger.address, identityCommitment("s7", "id-7"));
            await registry.connect(auditor).approveBeneficiary(1, stranger.address);
            await milestones.connect(ngo).submitMilestone(1, stranger.address, USDC(1), EVIDENCE_CID);
            await access.grantRole(roles.AUDITOR, stranger.address);

            await expect(milestones.connect(stranger).approveMilestone(1))
                .to.be.revertedWithCustomError(milestones, "ApproverIsBeneficiary")
                .withArgs(1n);
        });

        it("is blocked while the system is paused", async function () {
            const { milestones, access, auditor } = await loadFixture(withSubmitted);
            await access.pause();
            await expect(milestones.connect(auditor).approveMilestone(1))
                .to.be.revertedWithCustomError(milestones, "SystemPaused");
        });
    });

    describe("rejectMilestone", function () {
        it("rejects a submitted milestone without touching money", async function () {
            const { milestones, vault, auditor } = await loadFixture(withSubmitted);
            await expect(milestones.connect(auditor).rejectMilestone(1))
                .to.emit(milestones, "MilestoneRejected")
                .withArgs(1n, auditor.address);
            const m = await milestones.getMilestone(1);
            expect(m.status).to.equal(MilestoneStatus.Rejected);
            expect(m.reviewedBy).to.equal(auditor.address);
            expect(await vault.availableBalance(1)).to.equal(USDC(1000));
        });

        it("rejects callers without the auditor role", async function () {
            const { milestones, ngo } = await loadFixture(withSubmitted);
            await expect(milestones.connect(ngo).rejectMilestone(1))
                .to.be.revertedWithCustomError(milestones, "MissingRole");
        });

        it("only works on Submitted milestones", async function () {
            const { milestones, auditor } = await loadFixture(withApproved);
            await expect(milestones.connect(auditor).rejectMilestone(1))
                .to.be.revertedWithCustomError(milestones, "InvalidMilestoneStatus")
                .withArgs(1n, MilestoneStatus.Approved);
        });

        it("is blocked while the system is paused", async function () {
            const { milestones, access, auditor } = await loadFixture(withSubmitted);
            await access.pause();
            await expect(milestones.connect(auditor).rejectMilestone(1))
                .to.be.revertedWithCustomError(milestones, "SystemPaused");
        });
    });

    describe("releaseMilestone", function () {
        it("pays the beneficiary directly from the vault", async function () {
            const { milestones, vault, token, ngo, beneficiary } = await loadFixture(withApproved);
            await expect(milestones.connect(ngo).releaseMilestone(1))
                .to.emit(milestones, "MilestoneReleased")
                .withArgs(1n, beneficiary.address, USDC(300))
                .and.to.emit(vault, "FundsReleased")
                .withArgs(1n, 1n, beneficiary.address, USDC(300));

            expect(await token.balanceOf(beneficiary.address)).to.equal(USDC(300));
            expect(await token.balanceOf(ngo.address)).to.equal(0n);
            expect(await token.balanceOf(await milestones.getAddress())).to.equal(0n);
            expect((await milestones.getMilestone(1)).status).to.equal(MilestoneStatus.Released);
            expect((await vault.getCampaignFunds(1)).released).to.equal(USDC(300));
        });

        it("never pays the same milestone twice", async function () {
            const { milestones, token, ngo, beneficiary } = await loadFixture(withReleased);
            await expect(milestones.connect(ngo).releaseMilestone(1))
                .to.be.revertedWithCustomError(milestones, "InvalidMilestoneStatus")
                .withArgs(1n, MilestoneStatus.Released);
            expect(await token.balanceOf(beneficiary.address)).to.equal(USDC(300));
        });

        it("cannot release before approval or after rejection", async function () {
            const { milestones, ngo, auditor } = await loadFixture(withSubmitted);
            await expect(milestones.connect(ngo).releaseMilestone(1))
                .to.be.revertedWithCustomError(milestones, "InvalidMilestoneStatus")
                .withArgs(1n, MilestoneStatus.Submitted);
            await milestones.connect(auditor).rejectMilestone(1);
            await expect(milestones.connect(ngo).releaseMilestone(1))
                .to.be.revertedWithCustomError(milestones, "InvalidMilestoneStatus")
                .withArgs(1n, MilestoneStatus.Rejected);
        });

        it("only lets the campaign's own NGO release", async function () {
            const { milestones, ngo2, auditor, beneficiary, stranger } =
                await loadFixture(withApproved);
            await expect(milestones.connect(ngo2).releaseMilestone(1))
                .to.be.revertedWithCustomError(milestones, "NotCampaignNgo")
                .withArgs(1n, ngo2.address);
            for (const account of [auditor, beneficiary, stranger]) {
                await expect(milestones.connect(account).releaseMilestone(1))
                    .to.be.revertedWithCustomError(milestones, "MissingRole");
            }
        });

        it("is blocked if the beneficiary was revoked after approval", async function () {
            const { milestones, vault, registry, ngo, auditor, beneficiary } =
                await loadFixture(withApproved);
            await registry.connect(auditor).revokeBeneficiary(1, beneficiary.address);
            await expect(milestones.connect(ngo).releaseMilestone(1))
                .to.be.revertedWithCustomError(vault, "BeneficiaryNotEligible");
            expect((await milestones.getMilestone(1)).status).to.equal(MilestoneStatus.Approved);
        });

        it("is blocked once the campaign is closed", async function () {
            const { milestones, vault, registry, ngo } = await loadFixture(withApproved);
            await registry.connect(ngo).completeCampaign(1);
            await expect(milestones.connect(ngo).releaseMilestone(1))
                .to.be.revertedWithCustomError(vault, "BeneficiaryNotEligible");
        });

        it("is blocked while the system is paused", async function () {
            const { milestones, access, ngo } = await loadFixture(withApproved);
            await access.pause();
            await expect(milestones.connect(ngo).releaseMilestone(1))
                .to.be.revertedWithCustomError(milestones, "SystemPaused");
        });
    });

    describe("cancelMilestone", function () {
        it("cancels an approved milestone and frees its money", async function () {
            const { milestones, vault, auditor } = await loadFixture(withApproved);
            await expect(milestones.connect(auditor).cancelMilestone(1))
                .to.emit(milestones, "MilestoneCancelled")
                .withArgs(1n, auditor.address)
                .and.to.emit(vault, "ReservationCancelled");
            expect((await milestones.getMilestone(1)).status).to.equal(MilestoneStatus.Cancelled);
            expect(await vault.availableBalance(1)).to.equal(USDC(1000));
        });

        it("is how stuck money is recovered after a beneficiary is revoked", async function () {
            const { milestones, vault, registry, ngo, auditor, beneficiary } =
                await loadFixture(withApproved);
            await registry.connect(auditor).revokeBeneficiary(1, beneficiary.address);
            await milestones.connect(auditor).cancelMilestone(1);
            expect(await vault.availableBalance(1)).to.equal(USDC(1000));
            await expect(milestones.connect(ngo).releaseMilestone(1))
                .to.be.revertedWithCustomError(milestones, "InvalidMilestoneStatus");
        });

        it("only works on Approved milestones", async function () {
            const ctx = await loadFixture(withReleased);
            await expect(ctx.milestones.connect(ctx.auditor).cancelMilestone(1))
                .to.be.revertedWithCustomError(ctx.milestones, "InvalidMilestoneStatus")
                .withArgs(1n, MilestoneStatus.Released);

            await ctx.milestones
                .connect(ctx.ngo)
                .submitMilestone(1, ctx.beneficiary.address, USDC(1), EVIDENCE_CID);
            await expect(ctx.milestones.connect(ctx.auditor).cancelMilestone(2))
                .to.be.revertedWithCustomError(ctx.milestones, "InvalidMilestoneStatus")
                .withArgs(2n, MilestoneStatus.Submitted);
        });

        it("rejects callers without the auditor role", async function () {
            const { milestones, ngo } = await loadFixture(withApproved);
            await expect(milestones.connect(ngo).cancelMilestone(1))
                .to.be.revertedWithCustomError(milestones, "MissingRole");
        });

        it("is blocked while the system is paused", async function () {
            const { milestones, access, auditor } = await loadFixture(withApproved);
            await access.pause();
            await expect(milestones.connect(auditor).cancelMilestone(1))
                .to.be.revertedWithCustomError(milestones, "SystemPaused");
        });
    });

    describe("confirmReceipt", function () {
        it("lets the beneficiary confirm a released milestone", async function () {
            const { milestones, beneficiary } = await loadFixture(withReleased);
            await expect(milestones.connect(beneficiary).confirmReceipt(1))
                .to.emit(milestones, "ReceiptConfirmed")
                .withArgs(1n, beneficiary.address);
            expect((await milestones.getMilestone(1)).status).to.equal(MilestoneStatus.Confirmed);
        });

        it("rejects anyone else confirming", async function () {
            const { milestones, ngo, beneficiary2 } = await loadFixture(withReleased);
            for (const account of [ngo, beneficiary2]) {
                await expect(milestones.connect(account).confirmReceipt(1))
                    .to.be.revertedWithCustomError(milestones, "NotMilestoneBeneficiary")
                    .withArgs(1n, account.address);
            }
        });

        it("rejects confirming before payment or twice", async function () {
            const ctx = await loadFixture(withApproved);
            await expect(ctx.milestones.connect(ctx.beneficiary).confirmReceipt(1))
                .to.be.revertedWithCustomError(ctx.milestones, "InvalidMilestoneStatus")
                .withArgs(1n, MilestoneStatus.Approved);

            await ctx.milestones.connect(ctx.ngo).releaseMilestone(1);
            await ctx.milestones.connect(ctx.beneficiary).confirmReceipt(1);
            await expect(ctx.milestones.connect(ctx.beneficiary).confirmReceipt(1))
                .to.be.revertedWithCustomError(ctx.milestones, "InvalidMilestoneStatus")
                .withArgs(1n, MilestoneStatus.Confirmed);
        });

        it("is blocked while the system is paused", async function () {
            const { milestones, access, beneficiary } = await loadFixture(withReleased);
            await access.pause();
            await expect(milestones.connect(beneficiary).confirmReceipt(1))
                .to.be.revertedWithCustomError(milestones, "SystemPaused");
        });
    });
});
