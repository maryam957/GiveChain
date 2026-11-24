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

module.exports = {
    USDC,
    identityCommitment,
    CampaignStatus,
    BeneficiaryStatus,
    SAMPLE_CID,
    deployRegistryFixture,
    deployRegistryWithCampaignFixture,
};
