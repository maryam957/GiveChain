// REST API for the GiveChain frontend.
//
// Read endpoints serve the event index (a convenience copy of on-chain data).
// Write endpoints only store files on IPFS; nothing here can change the blockchain.
// Every money-related action is a wallet transaction the user signs in MetaMask.

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { ethers } = require("ethers");
const { IpfsError, ALLOWED_TYPES } = require("../ipfs/ipfsService");

/** Converts BigInt, Map and Set into plain JSON values (amounts become strings). */
function toPlain(value) {
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Map) return [...value.values()].map(toPlain);
    if (value instanceof Set) return [...value].map(toPlain);
    if (Array.isArray(value)) return value.map(toPlain);
    if (value && typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = toPlain(v);
        return out;
    }
    return value;
}

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function parseAddress(value) {
    if (!ethers.isAddress(value)) throw new HttpError(400, "Not a valid wallet address");
    return ethers.getAddress(value);
}

function parseId(value) {
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Not a valid id");
    return id;
}

const sameAddress = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();

/** Fields allowed in campaign details uploaded as JSON, with maximum lengths. */
const METADATA_FIELDS = {
    title: 120,
    summary: 300,
    description: 5000,
    category: 60,
    location: 120,
    organisation: 120,
};

/**
 * @param {object} deps
 * @param {import("../indexer/store").Store} deps.store
 * @param {import("../ipfs/ipfsService").IpfsService} deps.ipfs
 * @param {() => object|null} deps.getDeployment  Current deployment file contents.
 * @param {() => object} [deps.getStatus]         Extra health information.
 * @param {string} [deps.corsOrigin]
 */
function createApp({ store, ipfs, getDeployment, getStatus = () => ({}), corsOrigin = "*" }) {
    const app = express();
    app.use(cors({ origin: corsOrigin }));
    app.use(express.json({ limit: "100kb" }));

    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: ipfs.maxUploadBytes, files: 1 },
    });

    // Campaign details are fetched from IPFS once and cached.
    const metadataCache = new Map();
    async function metadataFor(cid) {
        if (!cid) return { metadata: null, metadataError: "No metadata CID" };
        if (!metadataCache.has(cid)) {
            try {
                const { data, verified } = await ipfs.getJson(cid);
                metadataCache.set(cid, { metadata: data, metadataVerified: verified });
            } catch (err) {
                return { metadata: null, metadataError: err.message };
            }
        }
        return metadataCache.get(cid);
    }

    function campaignSummary(c) {
        return {
            id: c.id,
            ngo: c.ngo,
            status: c.status,
            targetAmount: c.targetAmount,
            metadataCID: c.metadataCID,
            createdAt: c.createdAt,
            createdTx: c.createdTx,
            donated: c.donated,
            reserved: c.reserved,
            released: c.released,
            refunded: c.refunded,
            held: c.donated - c.released - c.refunded,
            available: (() => {
                const held = c.donated - c.released - c.refunded;
                return held > c.reserved ? held - c.reserved : 0n;
            })(),
            donorCount: c.donors.size,
            beneficiaryCount: c.beneficiaries.size,
            approvedBeneficiaryCount: [...c.beneficiaries.values()].filter((b) => b.status === "Approved").length,
            milestoneCount: c.milestoneIds.length,
        };
    }

    function getCampaign(id) {
        const c = store.campaigns.get(id);
        if (!c || c.status === "None") throw new HttpError(404, "Campaign not found");
        return c;
    }

    const route = (handler) => async (req, res, next) => {
        try {
            const result = await handler(req, res);
            if (result !== undefined) res.json(toPlain(result));
        } catch (err) {
            next(err);
        }
    };

    // ------------------------------------------------------------------ system

    app.get("/api/health", route(() => ({
        ok: true,
        indexedBlock: store.lastIndexedBlock,
        ipfsMode: ipfs.mode,
        deploymentLoaded: Boolean(getDeployment()),
        ...getStatus(),
    })));

    app.get("/api/config", route(() => {
        const d = getDeployment();
        if (!d) throw new HttpError(503, "No deployment found. Run npm run deploy:local.");
        return {
            network: d.network,
            chainId: d.chainId,
            tokenDecimals: 6,
            tokenSymbol: "mUSDC",
            contracts: d.contracts,
            ipfsMode: ipfs.mode,
            allowedUploadTypes: Object.keys(ALLOWED_TYPES),
            maxUploadBytes: ipfs.maxUploadBytes,
        };
    }));

    app.get("/api/stats", route(() => store.stats()));

    app.get("/api/roles/:address", route((req) => {
        const address = parseAddress(req.params.address);
        const has = (set) => [...set].some((a) => sameAddress(a, address));
        return {
            address,
            admin: has(store.roles.admins),
            pauser: has(store.roles.pausers),
            ngo: has(store.roles.ngos),
            auditor: has(store.roles.auditors),
            note: "From the event index. The frontend should confirm with hasRole() on-chain before acting.",
        };
    }));

    app.get("/api/activity", route((req) => {
        const limit = Math.min(Number(req.query.limit) || 50, 500);
        let items = store.activity;
        if (req.query.campaignId) {
            const id = parseId(req.query.campaignId);
            items = items.filter((a) => a.campaignId === id);
        }
        if (req.query.address) {
            const address = parseAddress(req.query.address);
            items = items.filter(
                (a) => sameAddress(a.actor, address) || sameAddress(a.beneficiary, address) || sameAddress(a.account, address)
            );
        }
        return items.slice(-limit).reverse();
    }));

    // --------------------------------------------------------------- campaigns

    app.get("/api/campaigns", route(async (req) => {
        let list = [...store.campaigns.values()].filter((c) => c.status !== "None");
        if (req.query.status) list = list.filter((c) => c.status === req.query.status);
        if (req.query.ngo) {
            const ngo = parseAddress(req.query.ngo);
            list = list.filter((c) => sameAddress(c.ngo, ngo));
        }
        return Promise.all(list.map(async (c) => ({ ...campaignSummary(c), ...(await metadataFor(c.metadataCID)) })));
    }));

    app.get("/api/campaigns/:id", route(async (req) => {
        const c = getCampaign(parseId(req.params.id));
        return {
            ...campaignSummary(c),
            ...(await metadataFor(c.metadataCID)),
            beneficiaries: [...c.beneficiaries.values()],
            donors: [...c.donors.entries()].map(([donor, amount]) => ({ donor, amount })),
            milestones: c.milestoneIds.map((id) => store.milestones.get(id)),
            donations: store.donations.filter((d) => d.campaignId === c.id),
            payouts: store.payouts.filter((p) => p.campaignId === c.id),
            refunds: store.refunds.filter((r) => r.campaignId === c.id),
        };
    }));

    // -------------------------------------------------------------- milestones

    app.get("/api/milestones", route((req) => {
        let list = [...store.milestones.values()];
        if (req.query.campaignId) {
            const id = parseId(req.query.campaignId);
            list = list.filter((m) => m.campaignId === id);
        }
        if (req.query.status) list = list.filter((m) => m.status === req.query.status);
        if (req.query.beneficiary) {
            const b = parseAddress(req.query.beneficiary);
            list = list.filter((m) => sameAddress(m.beneficiary, b));
        }
        return list;
    }));

    app.get("/api/milestones/:id", route((req) => {
        const m = store.milestones.get(parseId(req.params.id));
        if (!m) throw new HttpError(404, "Milestone not found");
        return m;
    }));

    // ------------------------------------------------------------------ people

    app.get("/api/donors/:address", route((req) => {
        const address = parseAddress(req.params.address);
        const donations = store.donations.filter((d) => sameAddress(d.donor, address));
        const refunds = store.refunds.filter((r) => sameAddress(r.donor, address));
        const campaignIds = [...new Set(donations.map((d) => d.campaignId))];
        return {
            address,
            totalDonated: donations.reduce((sum, d) => sum + d.amount, 0n),
            totalRefunded: refunds.reduce((sum, r) => sum + r.amount, 0n),
            donations,
            refunds,
            campaigns: campaignIds.map((id) => {
                const c = store.campaigns.get(id);
                return {
                    ...campaignSummary(c),
                    myContribution: c.donors.get(
                        [...c.donors.keys()].find((k) => sameAddress(k, address))
                    ) || 0n,
                    refundClaimed: refunds.some((r) => r.campaignId === id),
                };
            }),
        };
    }));

    app.get("/api/beneficiaries/:address", route((req) => {
        const address = parseAddress(req.params.address);
        const registrations = [];
        for (const c of store.campaigns.values()) {
            for (const b of c.beneficiaries.values()) {
                if (sameAddress(b.wallet, address)) {
                    registrations.push({ campaignId: c.id, campaignStatus: c.status, ...b });
                }
            }
        }
        const milestones = [...store.milestones.values()].filter((m) => sameAddress(m.beneficiary, address));
        const payouts = store.payouts.filter((p) => sameAddress(p.beneficiary, address));
        return {
            address,
            registrations,
            milestones,
            payouts,
            totalReceived: payouts.reduce((sum, p) => sum + p.amount, 0n),
        };
    }));

    // -------------------------------------------------------------------- IPFS

    app.post("/api/ipfs", upload.single("file"), route(async (req) => {
        if (!req.file) throw new HttpError(400, 'Send the file as multipart form field "file"');
        return ipfs.add(req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype,
        });
    }));

    app.post("/api/ipfs/json", route(async (req) => {
        const body = req.body || {};
        if (typeof body.title !== "string" || !body.title.trim()) {
            throw new HttpError(400, "A title is required");
        }
        const metadata = {};
        for (const [field, max] of Object.entries(METADATA_FIELDS)) {
            if (body[field] === undefined) continue;
            if (typeof body[field] !== "string") throw new HttpError(400, `${field} must be text`);
            if (body[field].length > max) throw new HttpError(400, `${field} is longer than ${max} characters`);
            metadata[field] = body[field].trim();
        }
        return ipfs.addJson(metadata);
    }));

    app.get("/api/ipfs/:cid", async (req, res, next) => {
        try {
            const file = await ipfs.get(req.params.cid);
            res.set("Content-Type", file.contentType);
            res.set("X-Content-Source", file.source);
            res.set("X-Content-Verified", String(file.verified));
            res.set("X-Content-Type-Options", "nosniff");
            res.set("Cache-Control", "public, max-age=31536000, immutable");
            res.send(file.bytes);
        } catch (err) {
            next(err);
        }
    });

    // ------------------------------------------------------------------ errors

    app.use("/api", (req, res) => res.status(404).json({ error: "Unknown endpoint" }));

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        let status = err.status || 500;
        let message = err.message || "Internal error";
        if (err instanceof multer.MulterError) {
            status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        } else if (err.type === "entity.too.large") {
            status = 413;
        }
        if (status >= 500 && !(err instanceof IpfsError)) message = "Internal error";
        res.status(status).json({ error: message });
    });

    return app;
}

module.exports = { createApp, toPlain };
