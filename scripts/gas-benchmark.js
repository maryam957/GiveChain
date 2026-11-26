// Gas benchmark: baseline (Phase 2) contracts vs optimized contracts.
//
// Run:  npm run gas
//
// Both systems run the same scripted workflow, with the same accounts, the same inputs
// and the same starting chain state (the chain is reset to a snapshot between runs, so
// even contract addresses are identical). Gas is read from each transaction receipt
// (receipt.gasUsed, which includes the 21,000 base cost and calldata).
// Results are printed and written to docs/gas-results.md and docs/gas-results.json.

const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const USDC = (n) => ethers.parseUnits(String(n), 6);
const CAMPAIGN_CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const EVIDENCE_CID = "bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";
const commitment = (salt, id) =>
    ethers.solidityPackedKeccak256(["bytes32", "string"], [ethers.id(salt), id]);

const SYSTEMS = {
    baseline: {
        registry: "BaselineProjectRegistry",
        vault: "BaselineDonationVault",
        milestones: "BaselineMilestoneDisbursement",
    },
    optimized: {
        registry: "ProjectRegistry",
        vault: "DonationVault",
        milestones: "MilestoneDisbursement",
    },
};

async function gasOf(txPromise) {
    const receipt = await (await txPromise).wait();
    return receipt.gasUsed;
}

async function deployGas(name, args) {
    const contract = await (await ethers.getContractFactory(name)).deploy(...args);
    const receipt = await contract.deploymentTransaction().wait();
    return { contract, gas: receipt.gasUsed };
}

/** Runs the scripted workflow on one system and returns { operation: gasUsed }. */
async function runWorkflow(names) {
    const [admin, ngo, auditor, donorA, donorB, ali, sara] = await ethers.getSigners();
    const gas = {};

    const access = await (await ethers.getContractFactory("GiveChainAccess")).deploy(
        admin.address
    );
    const token = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const a = await access.getAddress();

    const reg = await deployGas(names.registry, [a]);
    const vlt = await deployGas(names.vault, [a, await reg.contract.getAddress(), await token.getAddress()]);
    const ms = await deployGas(names.milestones, [
        a,
        await reg.contract.getAddress(),
        await vlt.contract.getAddress(),
    ]);
    const registry = reg.contract;
    const vault = vlt.contract;
    const milestones = ms.contract;
    gas["Deploy ProjectRegistry"] = reg.gas;
    gas["Deploy DonationVault"] = vlt.gas;
    gas["Deploy MilestoneDisbursement"] = ms.gas;

    // Setup (not measured).
    await vault.setDisbursementContract(await milestones.getAddress());
    await access.grantRole(await access.NGO_ROLE(), ngo.address);
    await access.grantRole(await access.AUDITOR_ROLE(), auditor.address);
    for (const d of [donorA, donorB]) {
        await token.connect(d).faucet(USDC(10000));
        await token.connect(d).approve(await vault.getAddress(), ethers.MaxUint256);
    }

    // Campaigns and beneficiaries.
    gas["createCampaign"] = await gasOf(
        registry.connect(ngo).createCampaign(USDC(5000), CAMPAIGN_CID)
    );
    gas["registerBeneficiary"] = await gasOf(
        registry.connect(ngo).registerBeneficiary(1, ali.address, commitment("a", "ID-ALI"))
    );
    await registry.connect(ngo).registerBeneficiary(1, sara.address, commitment("s", "ID-SARA"));
    gas["approveBeneficiary"] = await gasOf(
        registry.connect(auditor).approveBeneficiary(1, ali.address)
    );
    await registry.connect(auditor).approveBeneficiary(1, sara.address);

    // Donations.
    gas["donate (donor's first gift)"] = await gasOf(vault.connect(donorA).donate(1, USDC(1000)));
    gas["donate (repeat gift)"] = await gasOf(vault.connect(donorA).donate(1, USDC(500)));
    await vault.connect(donorB).donate(1, USDC(500));

    // Milestone 1: submit -> approve -> release -> confirm.
    gas["submitMilestone"] = await gasOf(
        milestones.connect(ngo).submitMilestone(1, ali.address, USDC(400), EVIDENCE_CID)
    );
    gas["approveMilestone (reserves funds)"] = await gasOf(
        milestones.connect(auditor).approveMilestone(1)
    );
    gas["releaseMilestone (pays beneficiary)"] = await gasOf(
        milestones.connect(ngo).releaseMilestone(1)
    );
    gas["confirmReceipt"] = await gasOf(milestones.connect(ali).confirmReceipt(1));

    // Milestone 2: submit -> reject.  Milestone 3: submit -> approve -> cancel.
    await milestones.connect(ngo).submitMilestone(1, sara.address, USDC(100), EVIDENCE_CID);
    gas["rejectMilestone"] = await gasOf(milestones.connect(auditor).rejectMilestone(2));
    await milestones.connect(ngo).submitMilestone(1, sara.address, USDC(200), EVIDENCE_CID);
    await milestones.connect(auditor).approveMilestone(3);
    gas["cancelMilestone (frees funds)"] = await gasOf(
        milestones.connect(auditor).cancelMilestone(3)
    );

    // Close the campaign and refund.
    gas["completeCampaign"] = await gasOf(registry.connect(ngo).completeCampaign(1));
    gas["claimRefund"] = await gasOf(vault.connect(donorA).claimRefund(1));

    return gas;
}

function pct(before, after) {
    return ((Number(after - before) / Number(before)) * 100).toFixed(1) + "%";
}

async function main() {
    const snapshot = await network.provider.send("evm_snapshot");
    const baseline = await runWorkflow(SYSTEMS.baseline);
    await network.provider.send("evm_revert", [snapshot]);
    const optimized = await runWorkflow(SYSTEMS.optimized);

    const rows = Object.keys(baseline).map((op) => ({
        operation: op,
        baseline: baseline[op],
        optimized: optimized[op],
        saved: baseline[op] - optimized[op],
        change: pct(baseline[op], optimized[op]),
    }));

    console.table(
        rows.map((r) => ({
            Operation: r.operation,
            Baseline: r.baseline.toString(),
            Optimized: r.optimized.toString(),
            Saved: r.saved.toString(),
            Change: r.change,
        }))
    );

    const docsDir = path.join(__dirname, "..", "docs");
    const { config } = require("hardhat");
    const settings = config.solidity.compilers[0];
    const header = [
        "# GiveChain Gas Results (generated)",
        "",
        "Generated by `npm run gas` (scripts/gas-benchmark.js). Do not edit by hand.",
        "",
        `Conditions: Hardhat in-process network, Solidity ${settings.version}, optimizer ` +
            `${settings.settings.optimizer.enabled ? "on" : "off"} (${settings.settings.optimizer.runs} runs). ` +
            "Same accounts, inputs and starting chain state for both systems. " +
            "Values are `receipt.gasUsed`.",
        "",
        "| Operation | Baseline gas | Optimized gas | Saved | Change |",
        "|---|---:|---:|---:|---:|",
    ];
    const lines = rows.map(
        (r) =>
            `| ${r.operation} | ${r.baseline.toLocaleString("en-US")} | ${r.optimized.toLocaleString("en-US")} | ${r.saved.toLocaleString("en-US")} | ${r.change} |`
    );
    fs.writeFileSync(path.join(docsDir, "gas-results.md"), [...header, ...lines, ""].join("\n"));
    fs.writeFileSync(
        path.join(docsDir, "gas-results.json"),
        JSON.stringify(
            rows.map((r) => ({ ...r, baseline: Number(r.baseline), optimized: Number(r.optimized), saved: Number(r.saved) })),
            null,
            2
        ) + "\n"
    );
    console.log("Written docs/gas-results.md and docs/gas-results.json");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
