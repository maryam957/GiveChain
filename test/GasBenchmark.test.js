const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GiveChain Optimization Benchmarks", function () {
    it("benchmarks custom errors on equivalent revert paths", async function () {
        const Baseline = await ethers.getContractFactory("GasCustomRequire");
        const baseline = await Baseline.deploy();
        await baseline.waitForDeployment();

        const Custom = await ethers.getContractFactory("GasCustomErrors");
        const custom = await Custom.deploy();
        await custom.waitForDeployment();

        let baselineGas;
        try {
            await (await baseline.deposit({ value: 0 })).wait();
        } catch (error) {
            if (error.transactionHash) {
                const receipt = await ethers.provider.getTransactionReceipt(
                    error.transactionHash
                );
                baselineGas = receipt?.gasUsed;
            }
        }

        let customGas;
        try {
            await (await custom.deposit({ value: 0 })).wait();
        } catch (error) {
            if (error.transactionHash) {
                const receipt = await ethers.provider.getTransactionReceipt(
                    error.transactionHash
                );
                customGas = receipt?.gasUsed;
            }
        }

        console.log("\n--- IDENTICAL CUSTOM-ERROR REVERT BENCHMARK ---");
        console.log("Require baseline:", baselineGas?.toString());
        console.log("Custom error after:", customGas?.toString());
        if (baselineGas && customGas) {
            console.log(
                "Difference:",
                (baselineGas - customGas).toString()
            );
        }
    });

    it("benchmarks milestone storage caching under identical state", async function () {
        const [admin, beneficiary] = await ethers.getSigners();
        const amount = ethers.parseEther("1");

        async function deployPair(contractName) {
            const Vault = await ethers.getContractFactory("DonationVault");
            const vault = await Vault.deploy();
            await vault.waitForDeployment();

            await vault.deposit({ value: amount });

            const Milestone = await ethers.getContractFactory(contractName);
            const milestone = await Milestone.deploy(await vault.getAddress());
            await milestone.waitForDeployment();

            await vault.grantRole(
                await vault.MILESTONE_ROLE(),
                await milestone.getAddress()
            );
            await vault.grantRole(
                await vault.DISBURSEMENT_ROLE(),
                await milestone.getAddress()
            );

            await milestone.createMilestone(beneficiary.address, amount);
            return milestone;
        }

        const baseline = await deployPair("GasMilestoneStorageBaseline");
        const after = await deployPair("GasMilestoneStorageAfter");

        const beforeTx = await baseline.approveMilestone(1);
        const beforeReceipt = await beforeTx.wait();

        const afterTx = await after.approveMilestone(1);
        const afterReceipt = await afterTx.wait();

        console.log("\n--- IDENTICAL STORAGE-CACHING BENCHMARK ---");
        console.log("Before:", beforeReceipt.gasUsed.toString());
        console.log("After:", afterReceipt.gasUsed.toString());
        console.log(
            "Difference:",
            (beforeReceipt.gasUsed - afterReceipt.gasUsed).toString()
        );
    });
});
