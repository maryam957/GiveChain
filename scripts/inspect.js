// Prints everything the blockchain knows about one wallet, read directly from the
// contracts (no backend, no website involved). Use it to check that what the website
// shows is really on-chain.
//
//   npm run inspect -- 0xYourWalletAddress
//   npm run inspect                       (no address: system overview)
//
// Optional: RPC_URL (default http://127.0.0.1:8545), GIVECHAIN_NETWORK (default localhost).

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const network = process.env.GIVECHAIN_NETWORK || "localhost";
const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
const deploymentFile = path.join(__dirname, "..", "deployments", `${network}.json`);

const CAMPAIGN = ["None", "Active", "Completed", "Cancelled"];
const BENEFICIARY = ["None", "Registered", "Approved", "Revoked"];
const MILESTONE = ["None", "Submitted", "Approved", "Rejected", "Released", "Cancelled", "Confirmed"];
const usdc = (v) => `${Number(ethers.formatUnits(v, 6)).toLocaleString("en-US")} mUSDC`;

async function main() {
    if (!fs.existsSync(deploymentFile)) throw new Error(`No ${deploymentFile}. Deploy first: npm run deploy:local`);
    const d = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const at = (name) => new ethers.Contract(d.contracts[name].address, d.contracts[name].abi, provider);
    const access = at("GiveChainAccess");
    const token = at("MockUSDC");
    const registry = at("ProjectRegistry");
    const vault = at("DonationVault");
    const milestones = at("MilestoneDisbursement");

    const block = await provider.getBlockNumber();
    console.log(`Chain ${d.chainId} at ${rpcUrl}, block ${block}. Reading directly from the contracts.\n`);

    const campaignCount = Number(await registry.campaignCount());
    const milestoneCount = Number(await milestones.milestoneCount());

    const arg = process.argv[2];
    if (!arg) {
        console.log(`System paused: ${await access.paused()}`);
        console.log(`Vault holds:   ${usdc(await token.balanceOf(d.contracts.DonationVault.address))}`);
        console.log(`Campaigns:     ${campaignCount}`);
        for (let id = 1; id <= campaignCount; id++) {
            const c = await registry.getCampaign(id);
            const f = await vault.getCampaignFunds(id);
            console.log(
                `  #${id} ${CAMPAIGN[Number(c.status)].padEnd(9)} owner ${c.ngo}  donated ${usdc(f.donated)}, paid ${usdc(f.released)}, available ${usdc(await vault.availableBalance(id))}`
            );
        }
        console.log(`Payment requests: ${milestoneCount}`);
        console.log("\nTip: npm run inspect -- 0xWALLET   shows one wallet in detail.");
        return;
    }

    if (!ethers.isAddress(arg)) throw new Error(`"${arg}" is not a wallet address.`);
    const wallet = ethers.getAddress(arg);
    console.log(`Wallet ${wallet}`);
    console.log(`  ETH (for fees):     ${ethers.formatEther(await provider.getBalance(wallet))} ETH`);
    console.log(`  mUSDC balance:      ${usdc(await token.balanceOf(wallet))}`);
    const roles = [];
    if (await access.hasRole(ethers.ZeroHash, wallet)) roles.push("Admin");
    if (await access.hasRole(ethers.id("PAUSER_ROLE"), wallet)) roles.push("Pauser");
    if (await access.hasRole(ethers.id("NGO_ROLE"), wallet)) roles.push("NGO");
    if (await access.hasRole(ethers.id("AUDITOR_ROLE"), wallet)) roles.push("Verifier (AUDITOR_ROLE)");
    console.log(`  On-chain roles:     ${roles.length ? roles.join(", ") : "none"}`);

    let found = false;
    for (let id = 1; id <= campaignCount; id++) {
        const c = await registry.getCampaign(id);
        const status = Number(await registry.beneficiaryStatus(id, wallet));
        const given = await vault.contributions(id, wallet);
        const owns = c.ngo === wallet;
        if (!owns && status === 0 && given === 0n) continue;
        found = true;
        console.log(`\n  Campaign #${id} (${CAMPAIGN[Number(c.status)]})`);
        if (owns) console.log("    This wallet runs this campaign (NGO).");
        if (status) console.log(`    Beneficiary status: ${BENEFICIARY[status]}`);
        if (given > 0n) {
            console.log(`    Donated: ${usdc(given)}; refund claimed: ${await vault.refundClaimed(id, wallet)}; refundable now: ${usdc(await vault.refundableAmount(id, wallet))}`);
        }
    }

    for (let id = 1; id <= milestoneCount; id++) {
        const m = await milestones.getMilestone(id);
        if (m.beneficiary !== wallet && m.reviewedBy !== wallet) continue;
        found = true;
        const role = m.beneficiary === wallet ? "to this wallet" : "reviewed by this wallet";
        console.log(`\n  Payment #${id} ${role}: ${usdc(m.amount)}, campaign #${m.campaignId}, status ${MILESTONE[Number(m.status)]}`);
    }
    if (!found) console.log("\n  No campaigns, donations or payments for this wallet.");
}

main().catch((error) => {
    console.error(error.shortMessage || error.message);
    process.exitCode = 1;
});
