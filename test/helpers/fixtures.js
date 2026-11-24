const { ethers } = require("hardhat");

/** Converts a human amount like "100.5" to MockUSDC units (6 decimals). */
const USDC = (amount) => ethers.parseUnits(String(amount), 6);

/** Builds an identity commitment the way the NGO would off-chain: keccak256(salt, id). */
const identityCommitment = (salt, nationalId) =>
    ethers.solidityPackedKeccak256(["bytes32", "string"], [ethers.id(salt), nationalId]);

/** Status enums, mirroring IProjectRegistry. */
const CampaignStatus = { None: 0n, Active: 1n, Completed: 2n, Cancelled: 3n };
const BeneficiaryStatus = { None: 0n, Registered: 1n, Approved: 2n, Revoked: 3n };

/** A sample IPFS CID used in tests. */
const SAMPLE_CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

/**
 * Deploys GiveChainAccess, MockUSDC and ProjectRegistry, and grants roles.
 * Signers: admin, ngo, ngo2, auditor, donor, donor2, beneficiary, beneficiary2, stranger.
 */
async function deployRegistryFixture() {
    const [admin, ngo, ngo2, auditor, donor, donor2, beneficiary, beneficiary2, stranger] =
        await ethers.getSigners();

    const access = await (await ethers.getContractFactory("GiveChainAccess")).deploy(
        admin.address
    );
    const token = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const registry = await (await ethers.getContractFactory("ProjectRegistry")).deploy(
        await access.getAddress()
    );

    const roles = {
        ADMIN: await access.DEFAULT_ADMIN_ROLE(),
        NGO: await access.NGO_ROLE(),
        AUDITOR: await access.AUDITOR_ROLE(),
        PAUSER: await access.PAUSER_ROLE(),
    };
    await access.grantRole(roles.NGO, ngo.address);
    await access.grantRole(roles.NGO, ngo2.address);
    await access.grantRole(roles.AUDITOR, auditor.address);

    return {
        access,
        token,
        registry,
        roles,
        admin,
        ngo,
        ngo2,
        auditor,
        donor,
        donor2,
        beneficiary,
        beneficiary2,
        stranger,
    };
}

/** Registry fixture plus one Active campaign (id 1) owned by `ngo`, target 1,000 mUSDC. */
async function deployRegistryWithCampaignFixture() {
    const ctx = await deployRegistryFixture();
    await ctx.registry.connect(ctx.ngo).createCampaign(USDC(1000), SAMPLE_CID);
    return { ...ctx, campaignId: 1n };
}

/** Reservation status enum, mirroring DonationVault. */
const ReservationStatus = { None: 0n, Reserved: 1n, Released: 2n, Cancelled: 3n };

/**
 * Campaign 1 (owned by `ngo`) with `beneficiary` and `beneficiary2` approved,
 * plus DonationVault linked to a MockDisbursementCaller (`caller`), which stands
 * in for MilestoneDisbursement. Donors each hold 10,000 mUSDC and have approved
 * the vault to spend all of it.
 */
async function deployVaultFixture() {
    const ctx = await deployRegistryWithCampaignFixture();
    const { registry, token, access, ngo, auditor, beneficiary, beneficiary2, donor, donor2 } =
        ctx;

    await registry
        .connect(ngo)
        .registerBeneficiary(1, beneficiary.address, identityCommitment("s1", "id-1"));
    await registry
        .connect(ngo)
        .registerBeneficiary(1, beneficiary2.address, identityCommitment("s2", "id-2"));
    await registry.connect(auditor).approveBeneficiary(1, beneficiary.address);
    await registry.connect(auditor).approveBeneficiary(1, beneficiary2.address);

    const vault = await (await ethers.getContractFactory("DonationVault")).deploy(
        await access.getAddress(),
        await registry.getAddress(),
        await token.getAddress()
    );
    const caller = await (await ethers.getContractFactory("MockDisbursementCaller")).deploy(
        await vault.getAddress()
    );
    await vault.setDisbursementContract(await caller.getAddress());

    for (const d of [donor, donor2]) {
        await token.connect(d).faucet(USDC(10000));
        await token.connect(d).approve(await vault.getAddress(), ethers.MaxUint256);
    }

    return { ...ctx, vault, caller };
}

module.exports = {
    USDC,
    identityCommitment,
    CampaignStatus,
    BeneficiaryStatus,
    ReservationStatus,
    SAMPLE_CID,
    deployRegistryFixture,
    deployRegistryWithCampaignFixture,
    deployVaultFixture,
};
