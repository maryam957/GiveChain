// Blockchain event indexer.
//
// Reads every event emitted by the GiveChain contracts, oldest first, and applies it
// to the in-memory Store. After catching up it keeps polling for new blocks.
//
// Trust: the indexer only copies what the chain says. If the backend is wrong or
// offline, the contracts are still the source of truth and anyone can check them
// directly. If the chain is restarted (block number goes backwards) or the contracts
// are redeployed, the index is thrown away and rebuilt.

const { ethers } = require("ethers");
const { CAMPAIGN_STATUS, BENEFICIARY_STATUS } = require("./store");

const MILESTONE_EVENT_STATUS = {
    MilestoneSubmitted: "Submitted",
    MilestoneApproved: "Approved",
    MilestoneRejected: "Rejected",
    MilestoneCancelled: "Cancelled",
    MilestoneReleased: "Released",
    ReceiptConfirmed: "Confirmed",
};

const INDEXED_CONTRACTS = ["GiveChainAccess", "ProjectRegistry", "DonationVault", "MilestoneDisbursement"];
const BLOCK_RANGE = 2000;

class Indexer {
    /**
     * @param {object} options
     * @param {object} options.provider   ethers v6 provider.
     * @param {object} options.deployment Parsed deployments/<network>.json.
     * @param {import("./store").Store} options.store
     * @param {Function} [options.log]
     */
    constructor({ provider, deployment, store, log = () => {} }) {
        this.provider = provider;
        this.store = store;
        this.log = log;
        this.blockTimes = new Map();
        this.timer = null;
        this.syncing = null;
        this.setDeployment(deployment);
    }

    /** Points the indexer at a (new) deployment and clears the index. */
    setDeployment(deployment) {
        this.deployment = deployment;
        this.byAddress = new Map();
        for (const name of INDEXED_CONTRACTS) {
            const { address, abi } = deployment.contracts[name];
            this.byAddress.set(address.toLowerCase(), { name, iface: new ethers.Interface(abi) });
        }
        this.roleNames = {
            [ethers.ZeroHash]: "admins", // OpenZeppelin DEFAULT_ADMIN_ROLE
            [ethers.id("NGO_ROLE")]: "ngos",
            [ethers.id("AUDITOR_ROLE")]: "auditors",
            [ethers.id("PAUSER_ROLE")]: "pausers",
        };
        this.store.reset();
        this.blockTimes.clear();
    }

    /** Catches up to the latest block once. Safe to call repeatedly. */
    async sync() {
        if (this.syncing) return this.syncing;
        this.syncing = this._sync().finally(() => {
            this.syncing = null;
        });
        return this.syncing;
    }

    /** Catches up, then keeps polling for new blocks. */
    async start(pollIntervalMs = 1500) {
        await this.sync();
        this.timer = setInterval(() => {
            this.sync().catch((err) => this.log(`Indexer error: ${err.message}`));
        }, pollIntervalMs);
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    async _sync() {
        const latest = await this.provider.getBlockNumber();
        const last = this.store.lastIndexedBlock;

        if (last !== null && latest < last) {
            this.log(`Chain went back from block ${last} to ${latest} (restarted?). Rebuilding index.`);
            this.setDeployment(this.deployment);
        }

        let from = this.store.lastIndexedBlock === null
            ? Number(this.deployment.startBlock || 0)
            : this.store.lastIndexedBlock + 1;
        const addresses = [...this.byAddress.keys()];

        while (from <= latest) {
            const to = Math.min(from + BLOCK_RANGE - 1, latest);
            const logs = await this.provider.getLogs({ address: addresses, fromBlock: from, toBlock: to });
            logs.sort((a, b) => a.blockNumber - b.blockNumber || (a.index ?? a.logIndex) - (b.index ?? b.logIndex));
            for (const log of logs) await this._apply(log);
            this.store.lastIndexedBlock = to;
            from = to + 1;
        }
        if (this.store.lastIndexedBlock === null) this.store.lastIndexedBlock = latest;
    }

    async _timestamp(blockNumber) {
        if (!this.blockTimes.has(blockNumber)) {
            const block = await this.provider.getBlock(blockNumber);
            this.blockTimes.set(blockNumber, block ? Number(block.timestamp) : null);
        }
        return this.blockTimes.get(blockNumber);
    }

    async _apply(log) {
        const contract = this.byAddress.get(log.address.toLowerCase());
        if (!contract) return;
        let parsed;
        try {
            parsed = contract.iface.parseLog({ topics: log.topics, data: log.data });
        } catch {
            return; // not an event from our ABI
        }
        if (!parsed) return;

        const meta = {
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.index ?? log.logIndex,
            timestamp: await this._timestamp(log.blockNumber),
        };
        const a = parsed.args;
        const s = this.store;
        const activity = { event: parsed.name, contract: contract.name, ...meta };

        switch (parsed.name) {
            // ---------------- GiveChainAccess ----------------
            case "RoleGranted":
            case "RoleRevoked": {
                const group = this.roleNames[a.role];
                if (group) {
                    const account = ethers.getAddress(a.account);
                    if (parsed.name === "RoleGranted") s.roles[group].add(account);
                    else s.roles[group].delete(account);
                }
                Object.assign(activity, { role: group || a.role, account: a.account, actor: a.sender });
                break;
            }
            case "Paused":
            case "Unpaused":
                s.paused = parsed.name === "Paused";
                activity.actor = a.account;
                break;

            // ---------------- ProjectRegistry ----------------
            case "CampaignCreated": {
                const c = s.campaign(Number(a.campaignId));
                Object.assign(c, {
                    ngo: a.ngo,
                    targetAmount: a.targetAmount,
                    metadataCID: a.metadataCID,
                    status: "Active",
                    createdAt: meta.timestamp,
                    createdTx: meta.txHash,
                });
                Object.assign(activity, { campaignId: c.id, actor: a.ngo, amount: a.targetAmount, cid: a.metadataCID });
                break;
            }
            case "CampaignStatusChanged": {
                const c = s.campaign(Number(a.campaignId));
                c.status = CAMPAIGN_STATUS[Number(a.newStatus)];
                Object.assign(activity, { campaignId: c.id, status: c.status, actor: a.changedBy });
                break;
            }
            case "BeneficiaryRegistered": {
                const c = s.campaign(Number(a.campaignId));
                c.beneficiaries.set(a.wallet, {
                    wallet: a.wallet,
                    identityCommitment: a.identityCommitment,
                    status: "Registered",
                    registeredAt: meta.timestamp,
                    updatedAt: meta.timestamp,
                });
                Object.assign(activity, { campaignId: c.id, beneficiary: a.wallet });
                break;
            }
            case "BeneficiaryStatusChanged": {
                const c = s.campaign(Number(a.campaignId));
                const b = c.beneficiaries.get(a.wallet);
                const status = BENEFICIARY_STATUS[Number(a.newStatus)];
                if (b) {
                    b.status = status;
                    b.updatedAt = meta.timestamp;
                }
                Object.assign(activity, { campaignId: c.id, beneficiary: a.wallet, status, actor: a.changedBy });
                break;
            }

            // ---------------- DonationVault ----------------
            case "DonationReceived": {
                const c = s.campaign(Number(a.campaignId));
                c.donated += a.amount;
                c.donors.set(a.donor, (c.donors.get(a.donor) || 0n) + a.amount);
                s.donations.push({ campaignId: c.id, donor: a.donor, amount: a.amount, ...meta });
                Object.assign(activity, { campaignId: c.id, actor: a.donor, amount: a.amount });
                break;
            }
            case "FundsReserved": {
                const c = s.campaign(Number(a.campaignId));
                c.reserved += a.amount;
                Object.assign(activity, {
                    campaignId: c.id,
                    milestoneId: Number(a.milestoneId),
                    beneficiary: a.beneficiary,
                    amount: a.amount,
                });
                break;
            }
            case "ReservationCancelled": {
                const c = s.campaign(Number(a.campaignId));
                c.reserved -= a.amount;
                Object.assign(activity, { campaignId: c.id, milestoneId: Number(a.milestoneId), amount: a.amount });
                break;
            }
            case "FundsReleased": {
                const c = s.campaign(Number(a.campaignId));
                c.reserved -= a.amount;
                c.released += a.amount;
                s.payouts.push({
                    campaignId: c.id,
                    milestoneId: Number(a.milestoneId),
                    beneficiary: a.beneficiary,
                    amount: a.amount,
                    ...meta,
                });
                Object.assign(activity, {
                    campaignId: c.id,
                    milestoneId: Number(a.milestoneId),
                    beneficiary: a.beneficiary,
                    amount: a.amount,
                });
                break;
            }
            case "RefundClaimed": {
                const c = s.campaign(Number(a.campaignId));
                c.refunded += a.amount;
                s.refunds.push({ campaignId: c.id, donor: a.donor, amount: a.amount, ...meta });
                Object.assign(activity, { campaignId: c.id, actor: a.donor, amount: a.amount });
                break;
            }
            case "DisbursementContractSet":
                activity.account = a.disbursementContract;
                break;

            // ---------------- MilestoneDisbursement ----------------
            case "MilestoneSubmitted": {
                const m = s.milestone(Number(a.milestoneId));
                Object.assign(m, {
                    campaignId: Number(a.campaignId),
                    beneficiary: a.beneficiary,
                    amount: a.amount,
                    evidenceCID: a.evidenceCID,
                    submittedAt: meta.timestamp,
                });
                s.campaign(m.campaignId).milestoneIds.push(m.id);
                this._milestoneStatus(m, parsed.name, null, meta);
                Object.assign(activity, {
                    campaignId: m.campaignId,
                    milestoneId: m.id,
                    beneficiary: a.beneficiary,
                    amount: a.amount,
                    cid: a.evidenceCID,
                    actor: s.campaigns.get(m.campaignId)?.ngo ?? null,
                });
                break;
            }
            case "MilestoneApproved":
            case "MilestoneRejected":
            case "MilestoneCancelled": {
                const m = s.milestone(Number(a.milestoneId));
                if (parsed.name !== "MilestoneCancelled") m.reviewedBy = a.auditor;
                this._milestoneStatus(m, parsed.name, a.auditor, meta);
                Object.assign(activity, { campaignId: m.campaignId, milestoneId: m.id, actor: a.auditor });
                break;
            }
            case "MilestoneReleased": {
                const m = s.milestone(Number(a.milestoneId));
                const ngo = s.campaigns.get(m.campaignId)?.ngo ?? null;
                this._milestoneStatus(m, parsed.name, ngo, meta);
                Object.assign(activity, {
                    campaignId: m.campaignId,
                    milestoneId: m.id,
                    beneficiary: a.beneficiary,
                    amount: a.amount,
                    actor: ngo,
                });
                break;
            }
            case "ReceiptConfirmed": {
                const m = s.milestone(Number(a.milestoneId));
                this._milestoneStatus(m, parsed.name, a.beneficiary, meta);
                Object.assign(activity, { campaignId: m.campaignId, milestoneId: m.id, actor: a.beneficiary });
                break;
            }
            default:
                break;
        }
        s.activity.push(activity);
    }

    _milestoneStatus(milestone, eventName, actor, meta) {
        milestone.status = MILESTONE_EVENT_STATUS[eventName];
        milestone.history.push({ status: milestone.status, actor, ...meta });
    }
}

module.exports = { Indexer };
