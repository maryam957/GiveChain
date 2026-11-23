
const { ethers } = require("hardhat");

async function main() {

    // Get test accounts
    const accounts = await ethers.getSigners();

    const admin = accounts[0];
    const donor = accounts[3];

    // Connect to the already deployed DonationVault
    const vaultAddress =
        "0x5fbdb2315678afecb367f032d93f642f64180aa3";

    const vault = await ethers.getContractAt(
        "DonationVault",
        vaultAddress
    );

    console.log("\n--- GIVECHAIN DONATION TEST ---");

    console.log("Admin:", admin.address);
    console.log("Donor:", donor.address);

    // Check donor balance before donation
    const donorBalanceBefore =
        await vault.donorBalance(donor.address);

    const vaultBalanceBefore =
        await ethers.provider.getBalance(vaultAddress);

    console.log(
        "\nDonor contribution before:",
        ethers.formatEther(donorBalanceBefore),
        "ETH"
    );

    console.log(
        "Vault balance before:",
        ethers.formatEther(vaultBalanceBefore),
        "ETH"
    );

    // Donate 5 ETH
    console.log("\nSending 5 ETH donation...");

    const donation = await vault.connect(donor).deposit({
        value: ethers.parseEther("5")
    });

    await donation.wait();

    console.log("Donation transaction:", donation.hash);

    // Check balances after donation
    const donorBalanceAfter =
        await vault.donorBalance(donor.address);

    const vaultBalanceAfter =
        await ethers.provider.getBalance(vaultAddress);

    console.log(
        "\nDonor contribution after:",
        ethers.formatEther(donorBalanceAfter),
        "ETH"
    );

    console.log(
        "Vault balance after:",
        ethers.formatEther(vaultBalanceAfter),
        "ETH"
    );

    console.log("\nDonation test completed!");

}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
