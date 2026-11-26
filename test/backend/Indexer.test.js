// Backend indexer + API tests, run against the real contracts on Hardhat's in-process
// chain. They check that the off-chain index always agrees with the on-chain state.
// Needs the backend's packages: npm install --prefix backend

const { expect } = require("chai");
const { ethers, artifacts } = require("hardhat");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
    USDC,
    identityCommitment,
    SAMPLE_CID,
    EVIDENCE_CID,
    deploySystemFixture,
} = require("../helpers/fixtures");

let backend;
try {
    backend = {
        Store: require("../../backend/src/indexer/store").Store,
        Indexer: require("../../backend/src/indexer/indexer").Indexer,
        createApp: require("../../backend/src/api/app").createApp,
        IpfsService: require("../../backend/src/ipfs/ipfsService").IpfsService,
    };
} catch (err) {
    backend = null;
}

describe("Backend indexer and API", function () {
    before(function () {
        if (!backend) {
            console.log("    (skipped: run `npm install --prefix backend` to enable backend tests)");
            this.skip();
        }
    });

    async function deploymentFor(ctx) {
        const contracts = {};
        for (const [name, contract] of Object.entries({
            GiveChainAccess: ctx.access,
            MockUSDC: ctx.token,
            ProjectRegistry: ctx.registry,
            DonationVault: ctx.vault,
            MilestoneDisbursement: ctx.milestones,
        })) {
            contracts[name] = {
                address: await contract.getAddress(),
                abi: (await artifacts.readArtifact(name)).abi,
            };
        }
        return { network: "hardhat", chainId: 31337, startBlock: 0, contracts };
    }

    // deploySystemFixture plus: milestone 1 released and confirmed, milestone 2 rejected,
    // a second campaign that is cancelled and refunded.
    async function scenario() {
        const ctx = await deploySystemFixture();
        const { registry, vault, milestones, ngo, ngo2, auditor, donor2, beneficiary, beneficiary2 } = ctx;
        await vault.connect(donor2).donate(1, USDC(500));
        await milestones.connect(ngo).submitMilestone(1, beneficiary.address, USDC(300), EVIDENCE_CID);
        await milestones.connect(auditor).approveMilestone(1);
        await milestones.connect(ngo).releaseMilestone(1);
        await milestones.connect(beneficiary).confirmReceipt(1);
        await milestones.connect(ngo).submitMilestone(1, beneficiary2.address, USDC(50), EVIDENCE_CID);
        await milestones.connect(auditor).rejectMilestone(2);

        await registry.connect(ngo2).createCampaign(USDC(100), SAMPLE_CID);
        await vault.connect(donor2).donate(2, USDC(80));
        await registry.connect(ngo2).cancelCampaign(2);
        await vault.connect(donor2).claimRefund(2);

        const store = new backend.Store();
        const indexer = new backend.Indexer({
            provider: ethers.provider,
            deployment: await deploymentFor(ctx),
            store,
        });
        await indexer.sync();
        return { ...ctx, store, indexer };
    }

    describe("Indexer", function () {
        it("matches the vault's on-chain accounting for every campaign", async function () {
            const { store, vault } = await scenario();
            for (const id of [1, 2]) {
                const onChain = await vault.getCampaignFunds(id);
                const indexed = store.campaigns.get(id);
                expect(indexed.donated).to.equal(onChain.donated);
                expect(indexed.reserved).to.equal(onChain.reserved);
                expect(indexed.released).to.equal(onChain.released);
                expect(indexed.refunded).to.equal(onChain.refunded);
            }
        });

        it("matches campaign status, owner and the full metadata CID from the event", async function () {
            const { store, registry, ngo } = await scenario();
            const c1 = store.campaigns.get(1);
            expect(c1.status).to.equal("Active");
            expect(c1.ngo).to.equal(ngo.address);
            expect(c1.metadataCID).to.equal(SAMPLE_CID);
            // The CID from the event hashes to the value stored on-chain.
            expect(ethers.id(c1.metadataCID)).to.equal((await registry.getCampaign(1)).metadataHash);
            expect(store.campaigns.get(2).status).to.equal("Cancelled");
        });

        it("tracks milestone status and its full history", async function () {
            const { store, milestones } = await scenario();
            const m1 = store.milestones.get(1);
            expect(m1.status).to.equal("Confirmed");
            expect(m1.history.map((h) => h.status)).to.deep.equal([
                "Submitted",
                "Approved",
                "Released",
                "Confirmed",
            ]);
            expect(m1.evidenceCID).to.equal(EVIDENCE_CID);
            expect(store.milestones.get(2).status).to.equal("Rejected");
            const onChainStatus = Number((await milestones.getMilestone(2)).status);
            expect(onChainStatus).to.equal(3); // Rejected
        });

        it("tracks beneficiaries, roles, donations, payouts and refunds", async function () {
            const { store, ngo, ngo2, auditor, beneficiary, donor2 } = await scenario();
            expect(store.campaigns.get(1).beneficiaries.get(beneficiary.address).status).to.equal("Approved");
            expect(store.roles.ngos.has(ngo.address) && store.roles.ngos.has(ngo2.address)).to.equal(true);
            expect(store.roles.auditors.has(auditor.address)).to.equal(true);
            expect(store.donations).to.have.length(3);
            expect(store.payouts).to.have.length(1);
            expect(store.payouts[0].beneficiary).to.equal(beneficiary.address);
            expect(store.refunds).to.have.length(1);
            expect(store.refunds[0].donor).to.equal(donor2.address);
            expect(store.refunds[0].amount).to.equal(USDC(80));
        });

        it("computes transparency totals", async function () {
            const { store } = await scenario();
            const stats = store.stats();
            expect(stats.totalDonated).to.equal(USDC(1580));
            expect(stats.totalReleased).to.equal(USDC(300));
            expect(stats.totalRefunded).to.equal(USDC(80));
            expect(stats.totalHeld).to.equal(USDC(1200));
            expect(stats.beneficiariesAssisted).to.equal(1);
            expect(stats.campaigns).to.deep.equal({ total: 2, Active: 1, Completed: 0, Cancelled: 1 });
        });

        it("picks up new blocks incrementally", async function () {
            const { store, indexer, vault, donor } = await scenario();
            const before = store.donations.length;
            await vault.connect(donor).donate(1, USDC(7));
            await indexer.sync();
            expect(store.donations).to.have.length(before + 1);
            expect(store.campaigns.get(1).donated).to.equal(USDC(1507));
        });

        it("rebuilds exactly the same index from scratch", async function () {
            const ctx = await scenario();
            const fresh = new backend.Store();
            const again = new backend.Indexer({
                provider: ethers.provider,
                deployment: await deploymentFor(ctx),
                store: fresh,
            });
            await again.sync();
            expect(fresh.stats()).to.deep.equal(ctx.store.stats());
            expect(fresh.activity.length).to.equal(ctx.store.activity.length);
        });

        it("records the pause switch", async function () {
            const { store, indexer, access } = await scenario();
            await access.pause();
            await indexer.sync();
            expect(store.paused).to.equal(true);
        });
    });

    describe("REST API", function () {
        let server;
        let base;
        let ctx;

        before(async function () {
            ctx = await scenario();
            const ipfsDir = fs.mkdtempSync(path.join(os.tmpdir(), "givechain-api-"));
            const ipfs = new backend.IpfsService({ localDir: ipfsDir, gateway: "" });
            const deployment = await deploymentFor(ctx);
            const app = backend.createApp({ store: ctx.store, ipfs, getDeployment: () => deployment });
            await new Promise((resolve) => {
                server = app.listen(0, resolve);
            });
            base = `http://127.0.0.1:${server.address().port}/api`;
        });

        after(function () {
            if (server) server.close();
        });

        const get = async (url) => {
            const res = await fetch(base + url);
            return { status: res.status, body: await res.json() };
        };

        it("serves the contract config for the frontend", async function () {
            const { status, body } = await get("/config");
            expect(status).to.equal(200);
            expect(body.chainId).to.equal(31337);
            expect(body.contracts.DonationVault.address).to.equal(await ctx.vault.getAddress());
            expect(body.contracts.DonationVault.abi).to.be.an("array");
        });

        it("lists campaigns with amounts as exact strings", async function () {
            const { body } = await get("/campaigns");
            expect(body).to.have.length(2);
            expect(body[0].donated).to.equal(USDC(1500).toString());
            expect(body[0].available).to.equal(USDC(1200).toString());
        });

        it("returns one campaign with milestones, donations and payouts", async function () {
            const { body } = await get("/campaigns/1");
            expect(body.milestones).to.have.length(2);
            expect(body.donations).to.have.length(2);
            expect(body.payouts).to.have.length(1);
            expect(body.beneficiaries).to.have.length(2);
        });

        it("returns a donor's history", async function () {
            const { body } = await get(`/donors/${ctx.donor2.address}`);
            expect(body.totalDonated).to.equal(USDC(580).toString());
            expect(body.totalRefunded).to.equal(USDC(80).toString());
            expect(body.campaigns.find((c) => c.id === 2).refundClaimed).to.equal(true);
        });

        it("returns a beneficiary's registrations and payouts", async function () {
            const { body } = await get(`/beneficiaries/${ctx.beneficiary.address}`);
            expect(body.totalReceived).to.equal(USDC(300).toString());
            expect(body.registrations[0].status).to.equal("Approved");
        });

        it("returns transparency stats and the activity feed", async function () {
            const stats = await get("/stats");
            expect(stats.body.totalReleased).to.equal(USDC(300).toString());
            const feed = await get("/activity?campaignId=1&limit=5");
            expect(feed.body).to.have.length(5);
            expect(feed.body[0].blockNumber).to.be.at.least(feed.body[4].blockNumber);
        });

        it("rejects bad input with clear errors", async function () {
            expect((await get("/donors/not-an-address")).status).to.equal(400);
            expect((await get("/campaigns/0")).status).to.equal(400);
            expect((await get("/campaigns/99")).status).to.equal(404);
            expect((await get("/nope")).status).to.equal(404);
        });

        it("stores uploaded evidence on IPFS and serves it back verified", async function () {
            const form = new FormData();
            form.append("file", new Blob(["receipt #42"], { type: "text/plain" }), "receipt.txt");
            const upload = await fetch(`${base}/ipfs`, { method: "POST", body: form });
            const { cid } = await upload.json();
            expect(upload.status).to.equal(200);

            const res = await fetch(`${base}/ipfs/${cid}`);
            expect(await res.text()).to.equal("receipt #42");
            expect(res.headers.get("x-content-verified")).to.equal("true");
        });

        it("validates campaign details before storing them", async function () {
            const post = (body) =>
                fetch(`${base}/ipfs/json`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });
            expect((await post({ summary: "no title" })).status).to.equal(400);
            expect((await post({ title: "x".repeat(121) })).status).to.equal(400);
            const ok = await post({ title: "New campaign", summary: "Short", ignored: "dropped" });
            const { cid } = await ok.json();
            const stored = await (await fetch(`${base}/ipfs/${cid}`)).json();
            expect(stored).to.deep.equal({ title: "New campaign", summary: "Short" });
        });

        it("rejects disallowed upload types", async function () {
            const form = new FormData();
            form.append("file", new Blob(["<script>"], { type: "text/html" }), "x.html");
            const res = await fetch(`${base}/ipfs`, { method: "POST", body: form });
            expect(res.status).to.equal(415);
        });
    });
});
