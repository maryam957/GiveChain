// Fills a freshly deployed local chain with demo data, so every dashboard has
// something to show. Run after deploy:
//
//   npm run node           (terminal 1)
//   npm run deploy:local   (terminal 2)
//   npm run seed:local     (terminal 2)
//
// Uses the Hardhat test accounts listed in docs/DEMO.md. All content is fictional.
// Writes deployments/<network>.seed.json (CID -> file map for the backend's local
// IPFS store, plus a summary of what was created).

const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");
const { cidForBytes } = require("./lib/cid");

const USDC = (n) => ethers.parseUnits(String(n), 6);
const ROOT = path.join(__dirname, "..");
const SEED_DIR = path.join(ROOT, "seed-data");

const commitment = (n) =>
    ethers.solidityPackedKeccak256(
        ["bytes32", "string"],
        [ethers.id(`demo-salt-${n}`), `DEMO-ID-00${n}`]
    );

async function loadFile(relativePath, files) {
    const bytes = fs.readFileSync(path.join(SEED_DIR, relativePath));
    const cid = await cidForBytes(bytes);
    files[cid] = `seed-data/${relativePath}`;
    return cid;
}

async function send(label, txPromise) {
    const receipt = await (await txPromise).wait();
    console.log(`  ✓ ${label}`);
    return receipt;
}

async function main() {
    const deploymentFile = path.join(ROOT, "deployments", `${network.name}.json`);
    if (!fs.existsSync(deploymentFile)) {
        throw new Error(`No ${path.relative(ROOT, deploymentFile)}. Run the deploy script first.`);
    }
    const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
    const at = (name) =>
        ethers.getContractAt(name, deployment.contracts[name].address);

    const token = await at("MockUSDC");
    const registry = await at("ProjectRegistry");
    const vault = await at("DonationVault");
    const milestones = await at("MilestoneDisbursement");

    if ((await registry.campaignCount()) > 0n) {
        throw new Error("This deployment already has campaigns. Redeploy before seeding again.");
    }

    const s = await ethers.getSigners();
    const [, ngo, ngo2, auditor, donorA, donorB, ben1, ben2, ben3, ben4] = s;

    // Content addresses for the demo files.
    const files = {};
    const cids = {
        winter: await loadFile("campaigns/winter-food.json", files),
        books: await loadFile("campaigns/school-books.json", files),
        water: await loadFile("campaigns/clean-water.json", files),
        receipt1: await loadFile("evidence/receipt-001.txt", files),
        receipt2: await loadFile("evidence/receipt-002.txt", files),
        quote3: await loadFile("evidence/quote-003.txt", files),
    };

    console.log(`Seeding "${network.name}"\n`);

    console.log("Donors get test tokens");
    const vaultAddress = await vault.getAddress();
    for (const donor of [donorA, donorB]) {
        await send(`${donor.address} faucet 5,000 mUSDC`, token.connect(donor).faucet(USDC(5000)));
        await send(`${donor.address} approves the vault`, token.connect(donor).approve(vaultAddress, ethers.MaxUint256));
    }

    console.log("\nCampaign 1: Winter Food Packages (NGO 1)");
    await send("created, target 5,000", registry.connect(ngo).createCampaign(USDC(5000), cids.winter));
    await send("beneficiary 1 registered", registry.connect(ngo).registerBeneficiary(1, ben1.address, commitment(1)));
    await send("beneficiary 2 registered", registry.connect(ngo).registerBeneficiary(1, ben2.address, commitment(2)));
    await send("beneficiary 3 registered", registry.connect(ngo).registerBeneficiary(1, ben3.address, commitment(3)));
    for (const ben of [ben1, ben2, ben3]) {
        await send(`auditor approves ${ben.address}`, registry.connect(auditor).approveBeneficiary(1, ben.address));
    }
    await send("donor A gives 1,500", vault.connect(donorA).donate(1, USDC(1500)));
    await send("donor B gives 1,000", vault.connect(donorB).donate(1, USDC(1000)));

    await send("milestone 1 submitted (300 to beneficiary 1)", milestones.connect(ngo).submitMilestone(1, ben1.address, USDC(300), cids.receipt1));
    await send("milestone 1 approved", milestones.connect(auditor).approveMilestone(1));
    await send("milestone 1 released", milestones.connect(ngo).releaseMilestone(1));
    await send("milestone 1 receipt confirmed", milestones.connect(ben1).confirmReceipt(1));

    await send("milestone 2 submitted (200 to beneficiary 2)", milestones.connect(ngo).submitMilestone(1, ben2.address, USDC(200), cids.receipt2));
    await send("milestone 2 approved (waiting for NGO to release)", milestones.connect(auditor).approveMilestone(2));

    await send("milestone 3 submitted (250 to beneficiary 3, waiting for auditor)", milestones.connect(ngo).submitMilestone(1, ben3.address, USDC(250), cids.quote3));

    console.log("\nCampaign 2: School Books Drive (NGO 2)");
    await send("created, target 2,000", registry.connect(ngo2).createCampaign(USDC(2000), cids.books));
    await send("beneficiary 4 registered (waiting for auditor)", registry.connect(ngo2).registerBeneficiary(2, ben4.address, commitment(4)));
    await send("donor B gives 500", vault.connect(donorB).donate(2, USDC(500)));

    console.log("\nCampaign 3: Clean Water Pilot (NGO 1)");
    await send("created, target 1,000", registry.connect(ngo).createCampaign(USDC(1000), cids.water));
    await send("donor A gives 300", vault.connect(donorA).donate(3, USDC(300)));
    await send("cancelled (donor A can now claim a refund)", registry.connect(ngo).cancelCampaign(3));

    const summary = {
        network: network.name,
        seededAt: new Date().toISOString(),
        files,
        campaigns: {
            1: { title: "Winter Food Packages", metadataCID: cids.winter },
            2: { title: "School Books Drive", metadataCID: cids.books },
            3: { title: "Clean Water Pilot", metadataCID: cids.water },
        },
    };
    const out = path.join(ROOT, "deployments", `${network.name}.seed.json`);
    fs.writeFileSync(out, JSON.stringify(summary, null, 2) + "\n");

    console.log("\nState after seeding:");
    for (const id of [1, 2, 3]) {
        const status = ["None", "Active", "Completed", "Cancelled"][Number(await registry.campaignStatus(id))];
        const held = ethers.formatUnits(await vault.heldBalance(id), 6);
        const available = ethers.formatUnits(await vault.availableBalance(id), 6);
        console.log(`  Campaign ${id}: ${status}, holds ${held}, available ${available}`);
    }
    console.log(`  Beneficiary 1 balance: ${ethers.formatUnits(await token.balanceOf(ben1.address), 6)} mUSDC`);
    console.log(`  Donor A refundable from campaign 3: ${ethers.formatUnits(await vault.refundableAmount(3, donorA.address), 6)} mUSDC`);
    console.log(`\nWritten ${path.relative(ROOT, out)}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
