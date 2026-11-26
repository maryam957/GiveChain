const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const {
    USDC,
    identityCommitment,
    CampaignStatus,
    BeneficiaryStatus,
    SAMPLE_CID,
    deployRegistryFixture,
    deployRegistryWithCampaignFixture,
} = require("./helpers/fixtures");

const ID_ALI = identityCommitment("salt-ali", "35202-1234567-1");
const ID_SARA = identityCommitment("salt-sara", "35202-7654321-2");

describe("ProjectRegistry", function () {
    // Campaign 1 with `beneficiary` registered (not yet approved).
    async function withRegisteredBeneficiary() {
        const ctx = await deployRegistryWithCampaignFixture();
        await ctx.registry
            .connect(ctx.ngo)
            .registerBeneficiary(ctx.campaignId, ctx.beneficiary.address, ID_ALI);
        return ctx;
    }

    // Campaign 1 with `beneficiary` registered and approved.
    async function withApprovedBeneficiary() {
        const ctx = await withRegisteredBeneficiary();
        await ctx.registry
            .connect(ctx.auditor)
            .approveBeneficiary(ctx.campaignId, ctx.beneficiary.address);
        return ctx;
    }

    describe("Deployment", function () {
        it("stores the access contract and starts with no campaigns", async function () {
            const { registry, access } = await loadFixture(deployRegistryFixture);
            expect(await registry.access()).to.equal(await access.getAddress());
            expect(await registry.campaignCount()).to.equal(0n);
            expect(await registry.nextCampaignId()).to.equal(1n);
        });

        it("rejects the zero address as access contract", async function () {
            const Registry = await ethers.getContractFactory("ProjectRegistry");
            await expect(Registry.deploy(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(Registry, "ZeroAddress");
        });
    });

    describe("createCampaign", function () {
        it("creates an Active campaign owned by the calling NGO", async function () {
            const { registry, ngo } = await loadFixture(deployRegistryFixture);
            await registry.connect(ngo).createCampaign(USDC(5000), SAMPLE_CID);

            const campaign = await registry.getCampaign(1);
            expect(campaign.ngo).to.equal(ngo.address);
            expect(campaign.targetAmount).to.equal(USDC(5000));
            // Storage keeps keccak256(CID); the full CID is in the CampaignCreated event.
            expect(campaign.metadataHash).to.equal(ethers.id(SAMPLE_CID));
            expect(campaign.status).to.equal(CampaignStatus.Active);
            expect(campaign.createdAt).to.be.greaterThan(0n);
            expect(await registry.campaignCount()).to.equal(1n);
        });

        it("emits CampaignCreated", async function () {
            const { registry, ngo } = await loadFixture(deployRegistryFixture);
            await expect(registry.connect(ngo).createCampaign(USDC(5000), SAMPLE_CID))
                .to.emit(registry, "CampaignCreated")
                .withArgs(1n, ngo.address, USDC(5000), SAMPLE_CID);
        });

        it("gives each new campaign the next id", async function () {
            const { registry, ngo, ngo2 } = await loadFixture(deployRegistryFixture);
            await registry.connect(ngo).createCampaign(USDC(1), SAMPLE_CID);
            await registry.connect(ngo2).createCampaign(USDC(2), SAMPLE_CID);
            expect(await registry.campaignNgo(1)).to.equal(ngo.address);
            expect(await registry.campaignNgo(2)).to.equal(ngo2.address);
            expect(await registry.campaignCount()).to.equal(2n);
        });

        it("rejects a caller without the NGO role", async function () {
            const { registry, stranger, roles } = await loadFixture(deployRegistryFixture);
            await expect(registry.connect(stranger).createCampaign(USDC(1), SAMPLE_CID))
                .to.be.revertedWithCustomError(registry, "MissingRole")
                .withArgs(stranger.address, roles.NGO);
        });

        it("rejects an auditor and the admin", async function () {
            const { registry, auditor, admin } = await loadFixture(deployRegistryFixture);
            await expect(registry.connect(auditor).createCampaign(USDC(1), SAMPLE_CID))
                .to.be.revertedWithCustomError(registry, "MissingRole");
            await expect(registry.connect(admin).createCampaign(USDC(1), SAMPLE_CID))
                .to.be.revertedWithCustomError(registry, "MissingRole");
        });

        it("rejects a zero target", async function () {
            const { registry, ngo } = await loadFixture(deployRegistryFixture);
            await expect(registry.connect(ngo).createCampaign(0, SAMPLE_CID))
                .to.be.revertedWithCustomError(registry, "InvalidTarget");
        });

        it("accepts the smallest possible target (1 unit)", async function () {
            const { registry, ngo } = await loadFixture(deployRegistryFixture);
            await registry.connect(ngo).createCampaign(1, SAMPLE_CID);
            expect((await registry.getCampaign(1)).targetAmount).to.equal(1n);
        });

        it("rejects an empty metadata CID", async function () {
            const { registry, ngo } = await loadFixture(deployRegistryFixture);
            await expect(registry.connect(ngo).createCampaign(USDC(1), ""))
                .to.be.revertedWithCustomError(registry, "EmptyMetadataCID");
        });

        it("is blocked while the system is paused", async function () {
            const { registry, access, ngo } = await loadFixture(deployRegistryFixture);
            await access.pause();
            await expect(registry.connect(ngo).createCampaign(USDC(1), SAMPLE_CID))
                .to.be.revertedWithCustomError(registry, "SystemPaused");
        });
    });

    describe("Campaign status changes", function () {
        it("lets the owning NGO complete its campaign", async function () {
            const { registry, ngo, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await expect(registry.connect(ngo).completeCampaign(campaignId))
                .to.emit(registry, "CampaignStatusChanged")
                .withArgs(campaignId, CampaignStatus.Completed, ngo.address);
            expect(await registry.campaignStatus(campaignId)).to.equal(CampaignStatus.Completed);
        });

        it("lets the owning NGO cancel its campaign", async function () {
            const { registry, ngo, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await expect(registry.connect(ngo).cancelCampaign(campaignId))
                .to.emit(registry, "CampaignStatusChanged")
                .withArgs(campaignId, CampaignStatus.Cancelled, ngo.address);
            expect(await registry.campaignStatus(campaignId)).to.equal(CampaignStatus.Cancelled);
        });

        it("lets the admin cancel any campaign", async function () {
            const { registry, admin, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await registry.connect(admin).cancelCampaign(campaignId);
            expect(await registry.campaignStatus(campaignId)).to.equal(CampaignStatus.Cancelled);
        });

        it("does not let the admin complete a campaign", async function () {
            const { registry, admin, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await expect(registry.connect(admin).completeCampaign(campaignId))
                .to.be.revertedWithCustomError(registry, "MissingRole");
        });

        it("does not let another NGO complete or cancel the campaign", async function () {
            const { registry, ngo2, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await expect(registry.connect(ngo2).completeCampaign(campaignId))
                .to.be.revertedWithCustomError(registry, "NotCampaignNgo")
                .withArgs(campaignId, ngo2.address);
            await expect(registry.connect(ngo2).cancelCampaign(campaignId))
                .to.be.revertedWithCustomError(registry, "NotAllowedToCancel")
                .withArgs(campaignId, ngo2.address);
        });

        it("does not let a stranger or auditor cancel the campaign", async function () {
            const { registry, stranger, auditor, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await expect(registry.connect(stranger).cancelCampaign(campaignId))
                .to.be.revertedWithCustomError(registry, "NotAllowedToCancel");
            await expect(registry.connect(auditor).cancelCampaign(campaignId))
                .to.be.revertedWithCustomError(registry, "NotAllowedToCancel");
        });

        it("stops an NGO whose role was revoked from cancelling its own campaign", async function () {
            const { registry, access, roles, ngo, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await access.revokeRole(roles.NGO, ngo.address);
            await expect(registry.connect(ngo).cancelCampaign(campaignId))
                .to.be.revertedWithCustomError(registry, "NotAllowedToCancel");
        });

        it("cannot change a campaign that is already closed", async function () {
            const { registry, ngo, admin, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await registry.connect(ngo).completeCampaign(campaignId);
            await expect(registry.connect(ngo).cancelCampaign(campaignId))
                .to.be.revertedWithCustomError(registry, "CampaignNotActive")
                .withArgs(campaignId);
            await expect(registry.connect(admin).cancelCampaign(campaignId))
                .to.be.revertedWithCustomError(registry, "CampaignNotActive");
            await expect(registry.connect(ngo).completeCampaign(campaignId))
                .to.be.revertedWithCustomError(registry, "CampaignNotActive");
        });

        it("rejects status changes for a campaign that does not exist", async function () {
            const { registry, ngo, admin } = await loadFixture(deployRegistryFixture);
            await expect(registry.connect(ngo).completeCampaign(99))
                .to.be.revertedWithCustomError(registry, "CampaignNotActive")
                .withArgs(99n);
            await expect(registry.connect(admin).cancelCampaign(0))
                .to.be.revertedWithCustomError(registry, "CampaignNotActive");
        });

        it("is blocked while the system is paused", async function () {
            const { registry, access, ngo, admin, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await access.pause();
            await expect(registry.connect(ngo).completeCampaign(campaignId))
                .to.be.revertedWithCustomError(registry, "SystemPaused");
            await expect(registry.connect(admin).cancelCampaign(campaignId))
                .to.be.revertedWithCustomError(registry, "SystemPaused");
        });
    });

    describe("registerBeneficiary", function () {
        it("registers a beneficiary as Registered and emits events", async function () {
            const { registry, ngo, beneficiary, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await expect(
                registry.connect(ngo).registerBeneficiary(campaignId, beneficiary.address, ID_ALI)
            )
                .to.emit(registry, "BeneficiaryRegistered")
                .withArgs(campaignId, beneficiary.address, ID_ALI)
                .and.to.emit(registry, "BeneficiaryStatusChanged")
                .withArgs(campaignId, beneficiary.address, BeneficiaryStatus.Registered, ngo.address);

            const record = await registry.getBeneficiary(campaignId, beneficiary.address);
            expect(record.identityCommitment).to.equal(ID_ALI);
            expect(record.status).to.equal(BeneficiaryStatus.Registered);
            expect(await registry.identityUsed(campaignId, ID_ALI)).to.equal(true);
        });

        it("does not make a merely registered beneficiary eligible", async function () {
            const { registry, beneficiary, campaignId } = await loadFixture(withRegisteredBeneficiary);
            expect(await registry.isBeneficiaryEligible(campaignId, beneficiary.address)).to.equal(
                false
            );
        });

        it("rejects a caller without the NGO role", async function () {
            const { registry, stranger, beneficiary, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await expect(
                registry
                    .connect(stranger)
                    .registerBeneficiary(campaignId, beneficiary.address, ID_ALI)
            ).to.be.revertedWithCustomError(registry, "MissingRole");
        });

        it("rejects an NGO registering into another NGO's campaign", async function () {
            const { registry, ngo2, beneficiary, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await expect(
                registry.connect(ngo2).registerBeneficiary(campaignId, beneficiary.address, ID_ALI)
            )
                .to.be.revertedWithCustomError(registry, "NotCampaignNgo")
                .withArgs(campaignId, ngo2.address);
        });

        it("rejects the zero wallet", async function () {
            const { registry, ngo, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await expect(
                registry.connect(ngo).registerBeneficiary(campaignId, ethers.ZeroAddress, ID_ALI)
            ).to.be.revertedWithCustomError(registry, "ZeroAddress");
        });

        it("rejects the NGO registering its own wallet", async function () {
            const { registry, ngo, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await expect(registry.connect(ngo).registerBeneficiary(campaignId, ngo.address, ID_ALI))
                .to.be.revertedWithCustomError(registry, "NgoCannotBeBeneficiary")
                .withArgs(campaignId);
        });

        it("rejects an empty identity commitment", async function () {
            const { registry, ngo, beneficiary, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await expect(
                registry
                    .connect(ngo)
                    .registerBeneficiary(campaignId, beneficiary.address, ethers.ZeroHash)
            ).to.be.revertedWithCustomError(registry, "InvalidIdentityCommitment");
        });

        it("rejects registering the same wallet twice", async function () {
            const { registry, ngo, beneficiary, campaignId } = await loadFixture(
                withRegisteredBeneficiary
            );
            await expect(
                registry.connect(ngo).registerBeneficiary(campaignId, beneficiary.address, ID_SARA)
            )
                .to.be.revertedWithCustomError(registry, "BeneficiaryAlreadyRegistered")
                .withArgs(campaignId, beneficiary.address);
        });

        it("rejects the same person (identity) under a second wallet", async function () {
            const { registry, ngo, beneficiary2, campaignId } = await loadFixture(
                withRegisteredBeneficiary
            );
            await expect(
                registry.connect(ngo).registerBeneficiary(campaignId, beneficiary2.address, ID_ALI)
            )
                .to.be.revertedWithCustomError(registry, "IdentityAlreadyUsed")
                .withArgs(campaignId, ID_ALI);
        });

        it("allows the same person in a different campaign", async function () {
            const { registry, ngo, beneficiary } = await loadFixture(withRegisteredBeneficiary);
            await registry.connect(ngo).createCampaign(USDC(10), SAMPLE_CID);
            await registry.connect(ngo).registerBeneficiary(2, beneficiary.address, ID_ALI);
            expect(await registry.beneficiaryStatus(2, beneficiary.address)).to.equal(
                BeneficiaryStatus.Registered
            );
        });

        it("rejects registration in a closed or non-existent campaign", async function () {
            const { registry, ngo, beneficiary, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await expect(
                registry.connect(ngo).registerBeneficiary(99, beneficiary.address, ID_ALI)
            ).to.be.revertedWithCustomError(registry, "CampaignNotActive");

            await registry.connect(ngo).cancelCampaign(campaignId);
            await expect(
                registry.connect(ngo).registerBeneficiary(campaignId, beneficiary.address, ID_ALI)
            ).to.be.revertedWithCustomError(registry, "CampaignNotActive");
        });

        it("is blocked while the system is paused", async function () {
            const { registry, access, ngo, beneficiary, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await access.pause();
            await expect(
                registry.connect(ngo).registerBeneficiary(campaignId, beneficiary.address, ID_ALI)
            ).to.be.revertedWithCustomError(registry, "SystemPaused");
        });
    });

    describe("approveBeneficiary", function () {
        it("lets an auditor approve a registered beneficiary, making them eligible", async function () {
            const { registry, auditor, beneficiary, campaignId } = await loadFixture(
                withRegisteredBeneficiary
            );
            await expect(
                registry.connect(auditor).approveBeneficiary(campaignId, beneficiary.address)
            )
                .to.emit(registry, "BeneficiaryStatusChanged")
                .withArgs(campaignId, beneficiary.address, BeneficiaryStatus.Approved, auditor.address);
            expect(await registry.isBeneficiaryEligible(campaignId, beneficiary.address)).to.equal(
                true
            );
        });

        it("rejects the NGO approving its own beneficiary", async function () {
            const { registry, ngo, beneficiary, roles, campaignId } = await loadFixture(
                withRegisteredBeneficiary
            );
            await expect(registry.connect(ngo).approveBeneficiary(campaignId, beneficiary.address))
                .to.be.revertedWithCustomError(registry, "MissingRole")
                .withArgs(ngo.address, roles.AUDITOR);
        });

        it("rejects a stranger and the admin", async function () {
            const { registry, stranger, admin, beneficiary, campaignId } = await loadFixture(
                withRegisteredBeneficiary
            );
            await expect(
                registry.connect(stranger).approveBeneficiary(campaignId, beneficiary.address)
            ).to.be.revertedWithCustomError(registry, "MissingRole");
            await expect(
                registry.connect(admin).approveBeneficiary(campaignId, beneficiary.address)
            ).to.be.revertedWithCustomError(registry, "MissingRole");
        });

        it("rejects approving an unregistered wallet", async function () {
            const { registry, auditor, stranger, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await expect(registry.connect(auditor).approveBeneficiary(campaignId, stranger.address))
                .to.be.revertedWithCustomError(registry, "InvalidBeneficiaryStatus")
                .withArgs(campaignId, stranger.address, BeneficiaryStatus.None);
        });

        it("rejects approving the same beneficiary twice", async function () {
            const { registry, auditor, beneficiary, campaignId } = await loadFixture(
                withApprovedBeneficiary
            );
            await expect(
                registry.connect(auditor).approveBeneficiary(campaignId, beneficiary.address)
            )
                .to.be.revertedWithCustomError(registry, "InvalidBeneficiaryStatus")
                .withArgs(campaignId, beneficiary.address, BeneficiaryStatus.Approved);
        });

        it("rejects an auditor approving their own wallet", async function () {
            const { registry, ngo, auditor, campaignId } = await loadFixture(
                deployRegistryWithCampaignFixture
            );
            await registry.connect(ngo).registerBeneficiary(campaignId, auditor.address, ID_SARA);
            await expect(registry.connect(auditor).approveBeneficiary(campaignId, auditor.address))
                .to.be.revertedWithCustomError(registry, "AuditorCannotApproveSelf");
        });

        it("rejects approval in a closed campaign", async function () {
            const { registry, ngo, auditor, beneficiary, campaignId } = await loadFixture(
                withRegisteredBeneficiary
            );
            await registry.connect(ngo).completeCampaign(campaignId);
            await expect(
                registry.connect(auditor).approveBeneficiary(campaignId, beneficiary.address)
            ).to.be.revertedWithCustomError(registry, "CampaignNotActive");
        });

        it("is blocked while the system is paused", async function () {
            const { registry, access, auditor, beneficiary, campaignId } = await loadFixture(
                withRegisteredBeneficiary
            );
            await access.pause();
            await expect(
                registry.connect(auditor).approveBeneficiary(campaignId, beneficiary.address)
            ).to.be.revertedWithCustomError(registry, "SystemPaused");
        });
    });

    describe("revokeBeneficiary", function () {
        it("lets an auditor revoke an approved beneficiary, ending eligibility", async function () {
            const { registry, auditor, beneficiary, campaignId } = await loadFixture(
                withApprovedBeneficiary
            );
            await expect(registry.connect(auditor).revokeBeneficiary(campaignId, beneficiary.address))
                .to.emit(registry, "BeneficiaryStatusChanged")
                .withArgs(campaignId, beneficiary.address, BeneficiaryStatus.Revoked, auditor.address);
            expect(await registry.isBeneficiaryEligible(campaignId, beneficiary.address)).to.equal(
                false
            );
        });

        it("lets an auditor revoke a beneficiary who was never approved", async function () {
            const { registry, auditor, beneficiary, campaignId } = await loadFixture(
                withRegisteredBeneficiary
            );
            await registry.connect(auditor).revokeBeneficiary(campaignId, beneficiary.address);
            expect(await registry.beneficiaryStatus(campaignId, beneficiary.address)).to.equal(
                BeneficiaryStatus.Revoked
            );
        });

        it("makes revocation permanent: no re-approval, no re-registration", async function () {
            const { registry, ngo, auditor, beneficiary, beneficiary2, campaignId } =
                await loadFixture(withApprovedBeneficiary);
            await registry.connect(auditor).revokeBeneficiary(campaignId, beneficiary.address);

            await expect(
                registry.connect(auditor).approveBeneficiary(campaignId, beneficiary.address)
            ).to.be.revertedWithCustomError(registry, "InvalidBeneficiaryStatus");
            await expect(
                registry.connect(ngo).registerBeneficiary(campaignId, beneficiary.address, ID_SARA)
            ).to.be.revertedWithCustomError(registry, "BeneficiaryAlreadyRegistered");
            await expect(
                registry.connect(ngo).registerBeneficiary(campaignId, beneficiary2.address, ID_ALI)
            ).to.be.revertedWithCustomError(registry, "IdentityAlreadyUsed");
        });

        it("rejects revoking twice or revoking an unregistered wallet", async function () {
            const { registry, auditor, beneficiary, stranger, campaignId } = await loadFixture(
                withApprovedBeneficiary
            );
            await registry.connect(auditor).revokeBeneficiary(campaignId, beneficiary.address);
            await expect(registry.connect(auditor).revokeBeneficiary(campaignId, beneficiary.address))
                .to.be.revertedWithCustomError(registry, "InvalidBeneficiaryStatus")
                .withArgs(campaignId, beneficiary.address, BeneficiaryStatus.Revoked);
            await expect(registry.connect(auditor).revokeBeneficiary(campaignId, stranger.address))
                .to.be.revertedWithCustomError(registry, "InvalidBeneficiaryStatus")
                .withArgs(campaignId, stranger.address, BeneficiaryStatus.None);
        });

        it("rejects the NGO revoking", async function () {
            const { registry, ngo, beneficiary, campaignId } = await loadFixture(
                withApprovedBeneficiary
            );
            await expect(registry.connect(ngo).revokeBeneficiary(campaignId, beneficiary.address))
                .to.be.revertedWithCustomError(registry, "MissingRole");
        });

        it("is blocked while the system is paused", async function () {
            const { registry, access, auditor, beneficiary, campaignId } = await loadFixture(
                withApprovedBeneficiary
            );
            await access.pause();
            await expect(registry.connect(auditor).revokeBeneficiary(campaignId, beneficiary.address))
                .to.be.revertedWithCustomError(registry, "SystemPaused");
        });
    });

    describe("Eligibility (used by the vault and milestone contracts)", function () {
        it("is true only for an Approved beneficiary in an Active campaign", async function () {
            const { registry, beneficiary, beneficiary2, campaignId } = await loadFixture(
                withApprovedBeneficiary
            );
            expect(await registry.isBeneficiaryEligible(campaignId, beneficiary.address)).to.equal(
                true
            );
            expect(await registry.isBeneficiaryEligible(campaignId, beneficiary2.address)).to.equal(
                false
            );
            expect(await registry.isBeneficiaryEligible(99, beneficiary.address)).to.equal(false);
        });

        it("becomes false when the campaign is completed", async function () {
            const { registry, ngo, beneficiary, campaignId } = await loadFixture(
                withApprovedBeneficiary
            );
            await registry.connect(ngo).completeCampaign(campaignId);
            expect(await registry.isBeneficiaryEligible(campaignId, beneficiary.address)).to.equal(
                false
            );
        });

        it("becomes false when the campaign is cancelled", async function () {
            const { registry, admin, beneficiary, campaignId } = await loadFixture(
                withApprovedBeneficiary
            );
            await registry.connect(admin).cancelCampaign(campaignId);
            expect(await registry.isBeneficiaryEligible(campaignId, beneficiary.address)).to.equal(
                false
            );
        });

        it("does not carry over to another campaign", async function () {
            const { registry, ngo, beneficiary } = await loadFixture(withApprovedBeneficiary);
            await registry.connect(ngo).createCampaign(USDC(10), SAMPLE_CID);
            expect(await registry.isBeneficiaryEligible(2, beneficiary.address)).to.equal(false);
        });

        it("still allows reading data while paused", async function () {
            const { registry, access, beneficiary, campaignId } = await loadFixture(
                withApprovedBeneficiary
            );
            await access.pause();
            expect(await registry.isBeneficiaryEligible(campaignId, beneficiary.address)).to.equal(
                true
            );
            expect(await registry.campaignStatus(campaignId)).to.equal(CampaignStatus.Active);
        });
    });
});
