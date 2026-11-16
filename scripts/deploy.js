
const { ethers } = require("hardhat");

async function main() {

    const [admin, ngo, auditor] = await ethers.getSigners();

    console.log("Deploying GiveChain...");
    console.log("Admin:", admin.address);
    console.log("NGO:", ngo.address);
    console.log("Auditor:", auditor.address);

    // 1. Deploy DonationVault
    const Vault = await ethers.getContractFactory("DonationVault");
    const vault = await Vault.deploy();
    await vault.waitForDeployment();

    console.log("DonationVault:", await vault.getAddress());

    // 2. Deploy ProjectRegistry
    const Registry = await ethers.getContractFactory("ProjectRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    console.log("ProjectRegistry:", await registry.getAddress());

    // 3. Deploy MilestoneDisbursement
    const Milestone = await ethers.getContractFactory("MilestoneDisbursement");

    const milestone = await Milestone.deploy(
        await registry.getAddress(),
        await vault.getAddress()
    );

    await milestone.waitForDeployment();

    console.log("MilestoneDisbursement:", await milestone.getAddress());

    // 4. Assign NGO role in Registry
    await registry.grantRole(
        await registry.NGO_ROLE(),
        ngo.address
    );

    // 5. Assign Auditor role in Registry
    await registry.grantRole(
        await registry.AUDITOR_ROLE(),
        auditor.address
    );

    // 6. Assign NGO role in Milestone contract
    await milestone.grantRole(
        await milestone.NGO_ROLE(),
        ngo.address
    );

    // 7. Assign Auditor role in Milestone contract
    await milestone.grantRole(
        await milestone.AUDITOR_ROLE(),
        auditor.address
    );

    // 8. Allow Milestone contract to reserve vault funds
    await vault.grantRole(
        await vault.MILESTONE_ROLE(),
        await milestone.getAddress()
    );

    // 9. Allow Milestone contract to release vault funds
    await vault.grantRole(
        await vault.DISBURSEMENT_ROLE(),
        await milestone.getAddress()
    );

    console.log("All roles assigned successfully!");

}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
