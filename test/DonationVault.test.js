const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const {
    USDC,
    identityCommitment,
    ReservationStatus,
    SAMPLE_CID,
    deployVaultFixture,
} = require("./helpers/fixtures");

describe("DonationVault", function () {
    // Campaign 1 with 1,000 mUSDC donated by `donor`.
    async function withDonation() {
        const ctx = await deployVaultFixture();
        await ctx.vault.connect(ctx.donor).donate(1, USDC(1000));
        return ctx;
    }

    // withDonation plus milestone 1: 300 mUSDC reserved for `beneficiary`.
    async function withReservation() {
        const ctx = await withDonation();
        await ctx.caller.reserve(1, 1, ctx.beneficiary.address, USDC(300));
        return ctx;
    }

    // A second Active campaign (id 2) owned by ngo2, with `beneficiary` approved in it.
    async function addSecondCampaign(ctx) {
        await ctx.registry.connect(ctx.ngo2).createCampaign(USDC(500), SAMPLE_CID);
        await ctx.registry
            .connect(ctx.ngo2)
            .registerBeneficiary(2, ctx.beneficiary.address, identityCommitment("s1", "id-1"));
        await ctx.registry.connect(ctx.auditor).approveBeneficiary(2, ctx.beneficiary.address);
    }

    async function vaultTokenBalance(ctx) {
        return ctx.token.balanceOf(await ctx.vault.getAddress());
    }

    describe("Deployment and setup", function () {
        it("stores the access, registry and token addresses", async function () {
            const { vault, access, registry, token } = await loadFixture(deployVaultFixture);
            expect(await vault.access()).to.equal(await access.getAddress());
            expect(await vault.registry()).to.equal(await registry.getAddress());
            expect(await vault.token()).to.equal(await token.getAddress());
        });

        it("rejects zero addresses in the constructor", async function () {
            const { access, registry, token } = await loadFixture(deployVaultFixture);
            const Vault = await ethers.getContractFactory("DonationVault");
            const a = await access.getAddress();
            const r = await registry.getAddress();
            const t = await token.getAddress();
            const Z = ethers.ZeroAddress;
            await expect(Vault.deploy(Z, r, t)).to.be.revertedWithCustomError(Vault, "ZeroAddress");
            await expect(Vault.deploy(a, Z, t)).to.be.revertedWithCustomError(Vault, "ZeroAddress");
            await expect(Vault.deploy(a, r, Z)).to.be.revertedWithCustomError(Vault, "ZeroAddress");
        });

        it("links the disbursement contract and emits an event", async function () {
            const { vault, caller } = await loadFixture(deployVaultFixture);
            expect(await vault.disbursementContract()).to.equal(await caller.getAddress());
        });

        it("allows linking the disbursement contract only once", async function () {
            const { vault, caller } = await loadFixture(deployVaultFixture);
            await expect(vault.setDisbursementContract(await caller.getAddress()))
                .to.be.revertedWithCustomError(vault, "DisbursementAlreadySet");
        });

        describe("on a fresh vault", function () {
            async function freshVault() {
                const ctx = await deployVaultFixture();
                const vault = await (await ethers.getContractFactory("DonationVault")).deploy(
                    await ctx.access.getAddress(),
                    await ctx.registry.getAddress(),
                    await ctx.token.getAddress()
                );
                return { ...ctx, vault };
            }

            it("emits DisbursementContractSet", async function () {
                const { vault, caller } = await loadFixture(freshVault);
                await expect(vault.setDisbursementContract(await caller.getAddress()))
                    .to.emit(vault, "DisbursementContractSet")
                    .withArgs(await caller.getAddress());
            });

            it("rejects linking by a non-admin", async function () {
                const { vault, caller, ngo } = await loadFixture(freshVault);
                await expect(
                    vault.connect(ngo).setDisbursementContract(await caller.getAddress())
                ).to.be.revertedWithCustomError(vault, "MissingRole");
            });

            it("rejects the zero address and wallets that are not contracts", async function () {
                const { vault, stranger } = await loadFixture(freshVault);
                await expect(vault.setDisbursementContract(ethers.ZeroAddress))
                    .to.be.revertedWithCustomError(vault, "ZeroAddress");
                await expect(vault.setDisbursementContract(stranger.address))
                    .to.be.revertedWithCustomError(vault, "NotAContract")
                    .withArgs(stranger.address);
            });

            it("lets nobody reserve before the link is set", async function () {
                const { vault, stranger, beneficiary } = await loadFixture(freshVault);
                await expect(
                    vault.connect(stranger).reserveFunds(1, 1, beneficiary.address, 1)
                ).to.be.revertedWithCustomError(vault, "NotDisbursementContract");
            });
        });
    });

    describe("donate", function () {
        it("moves tokens into the vault and records them for the campaign and donor", async function () {
            const ctx = await loadFixture(deployVaultFixture);
            const { vault, token, donor } = ctx;

            await expect(vault.connect(donor).donate(1, USDC(250)))
                .to.emit(vault, "DonationReceived")
                .withArgs(1n, donor.address, USDC(250));

            expect(await vaultTokenBalance(ctx)).to.equal(USDC(250));
            expect(await token.balanceOf(donor.address)).to.equal(USDC(9750));
            expect(await vault.contributions(1, donor.address)).to.equal(USDC(250));
            expect((await vault.getCampaignFunds(1)).donated).to.equal(USDC(250));
            expect(await vault.availableBalance(1)).to.equal(USDC(250));
        });

        it("adds up repeated donations from several donors", async function () {
            const { vault, donor, donor2 } = await loadFixture(deployVaultFixture);
            await vault.connect(donor).donate(1, USDC(100));
            await vault.connect(donor).donate(1, USDC(50));
            await vault.connect(donor2).donate(1, USDC(25));
            expect(await vault.contributions(1, donor.address)).to.equal(USDC(150));
            expect(await vault.contributions(1, donor2.address)).to.equal(USDC(25));
            expect((await vault.getCampaignFunds(1)).donated).to.equal(USDC(175));
        });

        it("accepts the smallest amount (1 unit)", async function () {
            const { vault, donor } = await loadFixture(deployVaultFixture);
            await vault.connect(donor).donate(1, 1);
            expect(await vault.availableBalance(1)).to.equal(1n);
        });

        it("rejects a zero donation", async function () {
            const { vault, donor } = await loadFixture(deployVaultFixture);
            await expect(vault.connect(donor).donate(1, 0))
                .to.be.revertedWithCustomError(vault, "ZeroAmount");
        });

        it("rejects donations to a campaign that does not exist", async function () {
            const { vault, donor } = await loadFixture(deployVaultFixture);
            await expect(vault.connect(donor).donate(99, USDC(1)))
                .to.be.revertedWithCustomError(vault, "CampaignNotActive")
                .withArgs(99n);
        });

        it("rejects donations to a completed or cancelled campaign", async function () {
            const { vault, registry, ngo, ngo2, donor } = await loadFixture(deployVaultFixture);
            await registry.connect(ngo).completeCampaign(1);
            await expect(vault.connect(donor).donate(1, USDC(1)))
                .to.be.revertedWithCustomError(vault, "CampaignNotActive");

            await registry.connect(ngo2).createCampaign(USDC(1), SAMPLE_CID);
            await registry.connect(ngo2).cancelCampaign(2);
            await expect(vault.connect(donor).donate(2, USDC(1)))
                .to.be.revertedWithCustomError(vault, "CampaignNotActive");
        });

        it("fails without enough token allowance and records nothing", async function () {
            const { vault, token, donor } = await loadFixture(deployVaultFixture);
            await token.connect(donor).approve(await vault.getAddress(), USDC(10));
            await expect(vault.connect(donor).donate(1, USDC(11)))
                .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
            expect(await vault.contributions(1, donor.address)).to.equal(0n);
        });

        it("fails when the donor does not own enough tokens", async function () {
            const { vault, token, stranger } = await loadFixture(deployVaultFixture);
            await token.connect(stranger).approve(await vault.getAddress(), USDC(1));
            await expect(vault.connect(stranger).donate(1, USDC(1)))
                .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
        });

        it("is blocked while the system is paused", async function () {
            const { vault, access, donor } = await loadFixture(deployVaultFixture);
            await access.pause();
            await expect(vault.connect(donor).donate(1, USDC(1)))
                .to.be.revertedWithCustomError(vault, "SystemPaused");
        });
    });

    describe("Separate balance per campaign", function () {
        it("keeps each campaign's donations apart", async function () {
            const ctx = await loadFixture(withDonation);
            await addSecondCampaign(ctx);
            await ctx.vault.connect(ctx.donor2).donate(2, USDC(200));

            expect(await ctx.vault.availableBalance(1)).to.equal(USDC(1000));
            expect(await ctx.vault.availableBalance(2)).to.equal(USDC(200));
            expect(await vaultTokenBalance(ctx)).to.equal(USDC(1200));
        });

        it("never lets a campaign spend another campaign's money", async function () {
            const ctx = await loadFixture(withDonation);
            await addSecondCampaign(ctx);
            await ctx.vault.connect(ctx.donor2).donate(2, USDC(200));

            // The vault holds 1,200 in total, but campaign 2 only owns 200.
            await expect(ctx.caller.reserve(2, 1, ctx.beneficiary.address, USDC(201)))
                .to.be.revertedWithCustomError(ctx.vault, "InsufficientCampaignFunds")
                .withArgs(2n, USDC(201), USDC(200));
        });
    });

    describe("reserveFunds", function () {
        it("sets money aside for a milestone and lowers the available balance", async function () {
            const { vault, caller, beneficiary } = await loadFixture(withDonation);
            await expect(caller.reserve(1, 7, beneficiary.address, USDC(300)))
                .to.emit(vault, "FundsReserved")
                .withArgs(1n, 7n, beneficiary.address, USDC(300));

            const reservation = await vault.getReservation(7);
            expect(reservation.campaignId).to.equal(1n);
            expect(reservation.beneficiary).to.equal(beneficiary.address);
            expect(reservation.amount).to.equal(USDC(300));
            expect(reservation.status).to.equal(ReservationStatus.Reserved);

            expect((await vault.getCampaignFunds(1)).reserved).to.equal(USDC(300));
            expect(await vault.availableBalance(1)).to.equal(USDC(700));
            expect(await vault.heldBalance(1)).to.equal(USDC(1000));
        });

        it("allows reserving exactly the whole available balance", async function () {
            const { vault, caller, beneficiary } = await loadFixture(withDonation);
            await caller.reserve(1, 1, beneficiary.address, USDC(1000));
            expect(await vault.availableBalance(1)).to.equal(0n);
        });

        it("rejects reserving one unit more than available", async function () {
            const { vault, caller, beneficiary } = await loadFixture(withReservation);
            await expect(caller.reserve(1, 2, beneficiary.address, USDC(700) + 1n))
                .to.be.revertedWithCustomError(vault, "InsufficientCampaignFunds")
                .withArgs(1n, USDC(700) + 1n, USDC(700));
        });

        it("rejects a second reservation for the same milestone", async function () {
            const { vault, caller, beneficiary2 } = await loadFixture(withReservation);
            await expect(caller.reserve(1, 1, beneficiary2.address, USDC(1)))
                .to.be.revertedWithCustomError(vault, "ReservationExists")
                .withArgs(1n);
        });

        it("rejects a zero amount", async function () {
            const { vault, caller, beneficiary } = await loadFixture(withDonation);
            await expect(caller.reserve(1, 1, beneficiary.address, 0))
                .to.be.revertedWithCustomError(vault, "ZeroAmount");
        });

        it("does its own eligibility check: rejects an unregistered wallet", async function () {
            const { vault, caller, stranger } = await loadFixture(withDonation);
            await expect(caller.reserve(1, 1, stranger.address, USDC(1)))
                .to.be.revertedWithCustomError(vault, "BeneficiaryNotEligible")
                .withArgs(1n, stranger.address);
        });

        it("rejects a revoked beneficiary", async function () {
            const { vault, caller, registry, auditor, beneficiary } =
                await loadFixture(withDonation);
            await registry.connect(auditor).revokeBeneficiary(1, beneficiary.address);
            await expect(caller.reserve(1, 1, beneficiary.address, USDC(1)))
                .to.be.revertedWithCustomError(vault, "BeneficiaryNotEligible");
        });

        it("rejects a beneficiary approved only in a different campaign", async function () {
            const ctx = await loadFixture(withDonation);
            await ctx.registry.connect(ctx.ngo2).createCampaign(USDC(1), SAMPLE_CID);
            await ctx.vault.connect(ctx.donor2).donate(2, USDC(100));
            // `beneficiary` is approved in campaign 1 but not in campaign 2.
            await expect(ctx.caller.reserve(2, 1, ctx.beneficiary.address, USDC(1)))
                .to.be.revertedWithCustomError(ctx.vault, "BeneficiaryNotEligible");
        });

        it("rejects reservations in a closed campaign", async function () {
            const { vault, caller, registry, ngo, beneficiary } = await loadFixture(withDonation);
            await registry.connect(ngo).completeCampaign(1);
            await expect(caller.reserve(1, 1, beneficiary.address, USDC(1)))
                .to.be.revertedWithCustomError(vault, "BeneficiaryNotEligible");
        });

        it("rejects direct calls from anyone but the linked contract", async function () {
            const { vault, admin, ngo, auditor, stranger, beneficiary } =
                await loadFixture(withDonation);
            for (const account of [admin, ngo, auditor, stranger]) {
                await expect(
                    vault.connect(account).reserveFunds(1, 1, beneficiary.address, USDC(1))
                )
                    .to.be.revertedWithCustomError(vault, "NotDisbursementContract")
                    .withArgs(account.address);
            }
        });

        it("is blocked while the system is paused", async function () {
            const { vault, caller, access, beneficiary } = await loadFixture(withDonation);
            await access.pause();
            await expect(caller.reserve(1, 1, beneficiary.address, USDC(1)))
                .to.be.revertedWithCustomError(vault, "SystemPaused");
        });
    });

    describe("releaseFunds", function () {
        it("pays the reserved beneficiary directly and updates the totals", async function () {
            const ctx = await loadFixture(withReservation);
            const { vault, caller, token, beneficiary } = ctx;

            await expect(caller.release(1))
                .to.emit(vault, "FundsReleased")
                .withArgs(1n, 1n, beneficiary.address, USDC(300));

            expect(await token.balanceOf(beneficiary.address)).to.equal(USDC(300));
            expect(await vaultTokenBalance(ctx)).to.equal(USDC(700));

            const funds = await vault.getCampaignFunds(1);
            expect(funds.reserved).to.equal(0n);
            expect(funds.released).to.equal(USDC(300));
            expect(await vault.availableBalance(1)).to.equal(USDC(700));
            expect((await vault.getReservation(1)).status).to.equal(ReservationStatus.Released);
        });

        it("never pays the same milestone twice", async function () {
            const ctx = await loadFixture(withReservation);
            await ctx.caller.release(1);
            await expect(ctx.caller.release(1))
                .to.be.revertedWithCustomError(ctx.vault, "InvalidReservationStatus")
                .withArgs(1n, ReservationStatus.Released);
            expect(await ctx.token.balanceOf(ctx.beneficiary.address)).to.equal(USDC(300));
        });

        it("rejects releasing a milestone that was never reserved", async function () {
            const { vault, caller } = await loadFixture(withDonation);
            await expect(caller.release(42))
                .to.be.revertedWithCustomError(vault, "InvalidReservationStatus")
                .withArgs(42n, ReservationStatus.None);
        });

        it("rejects releasing a cancelled reservation", async function () {
            const { vault, caller } = await loadFixture(withReservation);
            await caller.cancel(1);
            await expect(caller.release(1))
                .to.be.revertedWithCustomError(vault, "InvalidReservationStatus")
                .withArgs(1n, ReservationStatus.Cancelled);
        });

        it("re-checks eligibility: blocks payout if the beneficiary was revoked after approval", async function () {
            const { vault, caller, registry, auditor, beneficiary } =
                await loadFixture(withReservation);
            await registry.connect(auditor).revokeBeneficiary(1, beneficiary.address);
            await expect(caller.release(1))
                .to.be.revertedWithCustomError(vault, "BeneficiaryNotEligible")
                .withArgs(1n, beneficiary.address);
        });

        it("blocks payout once the campaign is closed", async function () {
            const { vault, caller, registry, ngo } = await loadFixture(withReservation);
            await registry.connect(ngo).cancelCampaign(1);
            await expect(caller.release(1))
                .to.be.revertedWithCustomError(vault, "BeneficiaryNotEligible");
        });

        it("rejects direct calls from anyone but the linked contract", async function () {
            const { vault, ngo, beneficiary } = await loadFixture(withReservation);
            await expect(vault.connect(ngo).releaseFunds(1))
                .to.be.revertedWithCustomError(vault, "NotDisbursementContract");
            await expect(vault.connect(beneficiary).releaseFunds(1))
                .to.be.revertedWithCustomError(vault, "NotDisbursementContract");
        });

        it("is blocked while the system is paused", async function () {
            const { vault, caller, access } = await loadFixture(withReservation);
            await access.pause();
            await expect(caller.release(1))
                .to.be.revertedWithCustomError(vault, "SystemPaused");
        });
    });

    describe("cancelReservation", function () {
        it("returns the reserved money to the available balance", async function () {
            const { vault, caller } = await loadFixture(withReservation);
            await expect(caller.cancel(1))
                .to.emit(vault, "ReservationCancelled")
                .withArgs(1n, 1n, USDC(300));
            expect(await vault.availableBalance(1)).to.equal(USDC(1000));
            expect((await vault.getCampaignFunds(1)).reserved).to.equal(0n);
            expect((await vault.getReservation(1)).status).to.equal(ReservationStatus.Cancelled);
        });

        it("rejects cancelling twice, after payout, or a missing reservation", async function () {
            const { vault, caller, beneficiary } = await loadFixture(withReservation);
            await caller.cancel(1);
            await expect(caller.cancel(1))
                .to.be.revertedWithCustomError(vault, "InvalidReservationStatus");

            await caller.reserve(1, 2, beneficiary.address, USDC(10));
            await caller.release(2);
            await expect(caller.cancel(2))
                .to.be.revertedWithCustomError(vault, "InvalidReservationStatus")
                .withArgs(2n, ReservationStatus.Released);

            await expect(caller.cancel(99))
                .to.be.revertedWithCustomError(vault, "InvalidReservationStatus")
                .withArgs(99n, ReservationStatus.None);
        });

        it("does not allow reusing a cancelled milestone id", async function () {
            const { vault, caller, beneficiary } = await loadFixture(withReservation);
            await caller.cancel(1);
            await expect(caller.reserve(1, 1, beneficiary.address, USDC(1)))
                .to.be.revertedWithCustomError(vault, "ReservationExists");
        });

        it("rejects direct calls from anyone but the linked contract", async function () {
            const { vault, auditor } = await loadFixture(withReservation);
            await expect(vault.connect(auditor).cancelReservation(1))
                .to.be.revertedWithCustomError(vault, "NotDisbursementContract");
        });

        it("is blocked while the system is paused", async function () {
            const { vault, caller, access } = await loadFixture(withReservation);
            await access.pause();
            await expect(caller.cancel(1)).to.be.revertedWithCustomError(vault, "SystemPaused");
        });
    });

    describe("Refunds", function () {
        // Campaign 1: donor gives 600, donor2 gives 400 (1,000 total).
        async function withTwoDonors() {
            const ctx = await deployVaultFixture();
            await ctx.vault.connect(ctx.donor).donate(1, USDC(600));
            await ctx.vault.connect(ctx.donor2).donate(1, USDC(400));
            return ctx;
        }

        it("is not possible while the campaign is Active", async function () {
            const { vault, donor } = await loadFixture(withTwoDonors);
            await expect(vault.connect(donor).claimRefund(1))
                .to.be.revertedWithCustomError(vault, "CampaignNotClosed")
                .withArgs(1n);
            expect(await vault.refundableAmount(1, donor.address)).to.equal(0n);
        });

        it("returns every donor's full contribution when nothing was spent", async function () {
            const ctx = await loadFixture(withTwoDonors);
            const { vault, registry, token, ngo, donor, donor2 } = ctx;
            await registry.connect(ngo).cancelCampaign(1);

            await expect(vault.connect(donor).claimRefund(1))
                .to.emit(vault, "RefundClaimed")
                .withArgs(1n, donor.address, USDC(600));
            await vault.connect(donor2).claimRefund(1);

            expect(await token.balanceOf(donor.address)).to.equal(USDC(10000));
            expect(await token.balanceOf(donor2.address)).to.equal(USDC(10000));
            expect(await vaultTokenBalance(ctx)).to.equal(0n);
        });

        it("splits the unspent money pro-rata after some payouts", async function () {
            const ctx = await loadFixture(withTwoDonors);
            const { vault, caller, registry, ngo, donor, donor2, beneficiary } = ctx;
            await caller.reserve(1, 1, beneficiary.address, USDC(400));
            await caller.release(1);
            await registry.connect(ngo).completeCampaign(1);

            // 600 left. donor gave 60% -> 360, donor2 gave 40% -> 240.
            expect(await vault.refundableAmount(1, donor.address)).to.equal(USDC(360));
            expect(await vault.refundableAmount(1, donor2.address)).to.equal(USDC(240));

            await vault.connect(donor).claimRefund(1);
            await vault.connect(donor2).claimRefund(1);
            expect(await vaultTokenBalance(ctx)).to.equal(0n);
            expect((await vault.getCampaignFunds(1)).refunded).to.equal(USDC(600));
        });

        it("treats approved-but-unpaid money as refundable once the campaign closes", async function () {
            const ctx = await loadFixture(withTwoDonors);
            const { vault, caller, registry, ngo, donor, donor2, beneficiary } = ctx;
            await caller.reserve(1, 1, beneficiary.address, USDC(500));
            await registry.connect(ngo).cancelCampaign(1);

            expect(await vault.refundableAmount(1, donor.address)).to.equal(USDC(600));
            await vault.connect(donor).claimRefund(1);
            await vault.connect(donor2).claimRefund(1);
            expect(await vaultTokenBalance(ctx)).to.equal(0n);

            // The stale reservation can no longer be paid, and views do not underflow.
            await expect(caller.release(1))
                .to.be.revertedWithCustomError(vault, "BeneficiaryNotEligible");
            expect(await vault.availableBalance(1)).to.equal(0n);
            expect(await vault.heldBalance(1)).to.equal(0n);
        });

        it("lets each donor claim only once", async function () {
            const { vault, registry, ngo, donor } = await loadFixture(withTwoDonors);
            await registry.connect(ngo).cancelCampaign(1);
            await vault.connect(donor).claimRefund(1);
            await expect(vault.connect(donor).claimRefund(1))
                .to.be.revertedWithCustomError(vault, "RefundAlreadyClaimed")
                .withArgs(1n, donor.address);
            expect(await vault.refundableAmount(1, donor.address)).to.equal(0n);
        });

        it("rejects a refund from someone who never donated", async function () {
            const { vault, registry, ngo, stranger } = await loadFixture(withTwoDonors);
            await registry.connect(ngo).cancelCampaign(1);
            await expect(vault.connect(stranger).claimRefund(1))
                .to.be.revertedWithCustomError(vault, "NoContribution")
                .withArgs(1n, stranger.address);
        });

        it("rejects a refund when everything was already paid out", async function () {
            const { vault, caller, registry, ngo, donor, beneficiary } =
                await loadFixture(withTwoDonors);
            await caller.reserve(1, 1, beneficiary.address, USDC(1000));
            await caller.release(1);
            await registry.connect(ngo).completeCampaign(1);
            await expect(vault.connect(donor).claimRefund(1))
                .to.be.revertedWithCustomError(vault, "NothingToRefund")
                .withArgs(1n);
        });

        it("only refunds from the closed campaign, not from other campaigns", async function () {
            const ctx = await loadFixture(withTwoDonors);
            await addSecondCampaign(ctx);
            await ctx.vault.connect(ctx.donor).donate(2, USDC(100));
            await ctx.registry.connect(ctx.ngo).cancelCampaign(1);

            await ctx.vault.connect(ctx.donor).claimRefund(1);
            expect(await ctx.vault.heldBalance(2)).to.equal(USDC(100));
            await expect(ctx.vault.connect(ctx.donor).claimRefund(2))
                .to.be.revertedWithCustomError(ctx.vault, "CampaignNotClosed");
        });

        it("rounds down, leaving at most a tiny remainder in the vault", async function () {
            const ctx = await deployVaultFixture();
            const { vault, caller, registry, ngo, donor, donor2, beneficiary } = ctx;
            await vault.connect(donor).donate(1, 1n); // 1 unit
            await vault.connect(donor2).donate(1, 2n); // 2 units
            await caller.reserve(1, 1, beneficiary.address, 1n);
            await caller.release(1);
            await registry.connect(ngo).completeCampaign(1);

            // 2 units left: donor gets floor(1*2/3)=0, donor2 gets floor(2*2/3)=1.
            await expect(vault.connect(donor).claimRefund(1))
                .to.be.revertedWithCustomError(vault, "NothingToRefund");
            await vault.connect(donor2).claimRefund(1);
            expect(await vaultTokenBalance(ctx)).to.equal(1n);
        });

        it("is blocked while the system is paused", async function () {
            const { vault, access, registry, ngo, donor } = await loadFixture(withTwoDonors);
            await registry.connect(ngo).cancelCampaign(1);
            await access.pause();
            await expect(vault.connect(donor).claimRefund(1))
                .to.be.revertedWithCustomError(vault, "SystemPaused");
        });
    });

    describe("Accounting invariant", function () {
        it("vault token balance always equals the sum of what each campaign holds", async function () {
            const ctx = await loadFixture(withDonation);
            const { vault, caller, registry, ngo, ngo2, donor, donor2, beneficiary, beneficiary2 } =
                ctx;
            await addSecondCampaign(ctx);

            const check = async () => {
                const total = (await vault.heldBalance(1)) + (await vault.heldBalance(2));
                expect(await vaultTokenBalance(ctx)).to.equal(total);
            };

            await vault.connect(donor2).donate(2, USDC(300));
            await check();
            await caller.reserve(1, 1, beneficiary.address, USDC(250));
            await caller.reserve(1, 2, beneficiary2.address, USDC(100));
            await caller.reserve(2, 3, beneficiary.address, USDC(300));
            await check();
            await caller.release(1);
            await caller.cancel(2);
            await caller.release(3);
            await check();
            await registry.connect(ngo).completeCampaign(1);
            await vault.connect(donor).claimRefund(1);
            await check();
            await registry.connect(ngo2).cancelCampaign(2);
            await expect(vault.connect(donor2).claimRefund(2))
                .to.be.revertedWithCustomError(vault, "NothingToRefund");
            await check();
        });
    });
});
