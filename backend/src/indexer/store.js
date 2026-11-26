// In-memory index of everything GiveChain's contracts have emitted.
//
// The store holds no data of its own: it is built only from on-chain events, so it
// can be thrown away and rebuilt from the chain at any time. The backend rebuilds it
// on every start. Amounts are BigInt token units (MockUSDC has 6 decimals).

const CAMPAIGN_STATUS = ["None", "Active", "Completed", "Cancelled"];
const BENEFICIARY_STATUS = ["None", "Registered", "Approved", "Revoked"];

class Store {
    constructor() {
        this.reset();
    }

    reset() {
        /** @type {Map<number, object>} campaignId -> campaign */
        this.campaigns = new Map();
        /** @type {Map<number, object>} milestoneId -> milestone */
        this.milestones = new Map();
        this.donations = [];
        this.refunds = [];
        this.payouts = [];
        /** Every indexed event, oldest first. */
        this.activity = [];
        this.roles = { admins: new Set(), ngos: new Set(), auditors: new Set(), pausers: new Set() };
        this.paused = false;
        this.lastIndexedBlock = null;
    }

    campaign(id) {
        let c = this.campaigns.get(id);
        if (!c) {
            c = {
                id,
                ngo: null,
                targetAmount: 0n,
                metadataCID: null,
                status: "None",
                createdAt: null,
                createdTx: null,
                donated: 0n,
                reserved: 0n,
                released: 0n,
                refunded: 0n,
                donors: new Map(), // address -> amount given
                beneficiaries: new Map(), // address -> record
                milestoneIds: [],
            };
            this.campaigns.set(id, c);
        }
        return c;
    }

    milestone(id) {
        let m = this.milestones.get(id);
        if (!m) {
            m = {
                id,
                campaignId: null,
                beneficiary: null,
                amount: 0n,
                evidenceCID: null,
                status: "None",
                reviewedBy: null,
                history: [],
            };
            this.milestones.set(id, m);
        }
        return m;
    }

    /** System-wide transparency totals. */
    stats() {
        const totals = { donated: 0n, reserved: 0n, released: 0n, refunded: 0n };
        const byStatus = { Active: 0, Completed: 0, Cancelled: 0 };
        for (const c of this.campaigns.values()) {
            totals.donated += c.donated;
            totals.reserved += c.reserved;
            totals.released += c.released;
            totals.refunded += c.refunded;
            if (byStatus[c.status] !== undefined) byStatus[c.status]++;
        }
        const beneficiariesAssisted = new Set(this.payouts.map((p) => p.beneficiary));
        const approvedBeneficiaries = new Set();
        for (const c of this.campaigns.values()) {
            for (const b of c.beneficiaries.values()) {
                if (b.status === "Approved") approvedBeneficiaries.add(b.wallet);
            }
        }
        return {
            totalDonated: totals.donated,
            totalReserved: totals.reserved,
            totalReleased: totals.released,
            totalRefunded: totals.refunded,
            totalHeld: totals.donated - totals.released - totals.refunded,
            campaigns: { total: this.campaigns.size, ...byStatus },
            donors: new Set(this.donations.map((d) => d.donor)).size,
            donations: this.donations.length,
            beneficiariesApproved: approvedBeneficiaries.size,
            beneficiariesAssisted: beneficiariesAssisted.size,
            payouts: this.payouts.length,
            milestones: this.milestones.size,
            paused: this.paused,
            lastIndexedBlock: this.lastIndexedBlock,
        };
    }
}

module.exports = { Store, CAMPAIGN_STATUS, BENEFICIARY_STATUS };
