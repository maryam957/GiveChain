// Backend configuration. Values come from environment variables, which can be set
// in the project's root .env file (see .env.example). Every value has a local default,
// so the backend works with no .env at all.

const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
require("dotenv").config({ path: path.join(ROOT, ".env") });

const network = process.env.GIVECHAIN_NETWORK || "localhost";

module.exports = {
    ROOT,
    port: Number(process.env.BACKEND_PORT || 4000),
    rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
    deploymentFile:
        process.env.DEPLOYMENT_FILE || path.join(ROOT, "deployments", `${network}.json`),
    seedDataDir: path.join(ROOT, "seed-data"),
    network,
    // One accounts file per network, so demo logins on Hardhat and on Ganache
    // each point at that chain's own wallets.
    accountsDbFile:
        process.env.ACCOUNTS_DB_FILE ||
        path.join(ROOT, "backend", "data", network === "localhost" ? "accounts.json" : `accounts-${network}.json`),
    pollIntervalMs: Number(process.env.INDEXER_POLL_MS || 1500),
    ipfs: {
        localDir: process.env.IPFS_LOCAL_DIR || path.join(ROOT, "backend", "storage", "ipfs"),
        pinataJwt: process.env.PINATA_JWT || "",
        gateway: process.env.IPFS_GATEWAY || "https://gateway.pinata.cloud",
        maxUploadBytes: 5 * 1024 * 1024,
    },
    corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
};
