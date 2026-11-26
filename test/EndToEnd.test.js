const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
    USDC,
    identityCommitment,
    CampaignStatus,
    BeneficiaryStatus,
    MilestoneStatus,
    SAMPLE_CID,
    EVIDENCE_CID,
} = require("./helpers/fixtures");

// The whole GiveChain story, deployed from scratch in the documented order
// (docs/ARCHITECTURE.md section 9), with every role played by a separate wallet.
describe("End-to-end: a full campaign from creation to refunds", function () {
    it("runs the complete workflow and keeps every balance correct", async function () {
        const [admin, ngo, auditor, ali, sara, donorA, donorB] = await ethers.getSigners();

        // 1. Deploy in the documented order.
        const access = await (await ethers.getContractFactory("GiveChainAccess")).deploy(
            admin.address
        );
        const token = await (await ethers.getContractFactory("MockUSDC")).deploy();
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
        ).deploy(await access.getAddress(), await registry.getAddress(), await vault.getAddress());
        await vault.setDisbursementContract(await milestones.getAddress());
        await access.grantRole(await access.NGO_ROLE(), ngo.address);
        await access.grantRole(await access.AUDITOR_ROLE(), auditor.address);

        // 2. NGO creates a campaign with a 2,000 mUSDC target.
        await registry.connect(ngo).createCampaign(USDC(2000), SAMPLE_CID);
        expect(await registry.campaignStatus(1)).to.equal(CampaignStatus.Active);

        // 3. NGO registers two beneficiaries; the auditor approves both.
        await registry
            .connect(ngo)
            .registerBeneficiary(1, ali.address, identityCommitment("salt-a", "ID-ALI"));
        await registry
            .connect(ngo)
            .registerBeneficiary(1, sara.address, identityCommitment("salt-s", "ID-SARA"));
        await registry.connect(auditor).approveBeneficiary(1, ali.address);
        await registry.connect(auditor).approveBeneficiary(1, sara.address);
        expect(await registry.beneficiaryStatus(1, sara.address)).to.equal(
            BeneficiaryStatus.Approved
        );

        // 4. Two donors get test tokens and donate 1,200 + 800.
        const vaultAddress = await vault.getAddress();
        for (const [donor, amount] of [
            [donorA, USDC(1200)],
            [donorB, USDC(800)],
        ]) {
            await token.connect(donor).faucet(amount);
            await token.connect(donor).approve(vaultAddress, amount);
            await vault.connect(donor).donate(1, amount);
        }
        expect(await vault.availableBalance(1)).to.equal(USDC(2000));
        expect(await token.balanceOf(vaultAddress)).to.equal(USDC(2000));

        // 5. NGO submits three payment requests with evidence.
        await milestones.connect(ngo).submitMilestone(1, ali.address, USDC(500), EVIDENCE_CID);
        await milestones.connect(ngo).submitMilestone(1, sara.address, USDC(300), EVIDENCE_CID);
        await milestones.connect(ngo).submitMilestone(1, sara.address, USDC(9999), EVIDENCE_CID);

        // 6. Auditor approves the first two and rejects the oversized third.
        await milestones.connect(auditor).approveMilestone(1);
        await milestones.connect(auditor).approveMilestone(2);
        await milestones.connect(auditor).rejectMilestone(3);
        expect(await vault.availableBalance(1)).to.equal(USDC(1200));

        // 7. NGO releases Ali's payment; the money goes straight to Ali's wallet.
        await milestones.connect(ngo).releaseMilestone(1);
        expect(await token.balanceOf(ali.address)).to.equal(USDC(500));
        expect(await token.balanceOf(ngo.address)).to.equal(0n);

        // 8. Ali confirms receipt.
        await milestones.connect(ali).confirmReceipt(1);
        expect((await milestones.getMilestone(1)).status).to.equal(MilestoneStatus.Confirmed);

        // 9. Sara is found ineligible: auditor revokes her and cancels her approved payment.
        await registry.connect(auditor).revokeBeneficiary(1, sara.address);
        await milestones.connect(auditor).cancelMilestone(2);
        expect(await vault.availableBalance(1)).to.equal(USDC(1500));
        expect(await token.balanceOf(sara.address)).to.equal(0n);

        // 10. NGO completes the campaign; donors claim their share of the 1,500 left.
        await registry.connect(ngo).completeCampaign(1);
        // donorA gave 60% -> 900; donorB gave 40% -> 600.
        await vault.connect(donorA).claimRefund(1);
        await vault.connect(donorB).claimRefund(1);
        expect(await token.balanceOf(donorA.address)).to.equal(USDC(900));
        expect(await token.balanceOf(donorB.address)).to.equal(USDC(600));

        // 11. Final books: 2,000 in = 500 paid to Ali + 1,500 refunded; vault is empty.
        const funds = await vault.getCampaignFunds(1);
        expect(funds.donated).to.equal(USDC(2000));
        expect(funds.released).to.equal(USDC(500));
        expect(funds.refunded).to.equal(USDC(1500));
        expect(funds.reserved).to.equal(0n);
        expect(await token.balanceOf(vaultAddress)).to.equal(0n);
    });
});
