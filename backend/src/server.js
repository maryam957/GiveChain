// GiveChain backend entry point.
//
//   npm run backend          (from the project root)
//
// 1. Loads deployments/<network>.json (waits for it if the contracts are not deployed yet).
// 2. Imports the demo files in seed-data/ into the local IPFS store.
// 3. Indexes all contract events from the deployment block, then keeps polling.
// 4. Serves the REST API on http://localhost:4000.
// If the deployment file changes (redeploy), the index is rebuilt automatically.

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const config = require("./config");
const { Store } = require("./indexer/store");
const { Indexer } = require("./indexer/indexer");
const { IpfsService } = require("./ipfs/ipfsService");
const { createApp } = require("./api/app");

const log = (message) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);

function readDeployment() {
    try {
        const stat = fs.statSync(config.deploymentFile);
        return { data: JSON.parse(fs.readFileSync(config.deploymentFile, "utf8")), mtimeMs: stat.mtimeMs };
    } catch {
        return null;
    }
}

async function main() {
    const store = new Store();
    const ipfs = new IpfsService(config.ipfs);
    const provider = new ethers.JsonRpcProvider(config.rpcUrl, undefined, { staticNetwork: true });

    const imported = await ipfs.importDirectory(config.seedDataDir);
    log(`IPFS mode: ${ipfs.mode}. Imported ${imported.length} demo files into the local store.`);

    let deployment = null;
    let deploymentMtime = 0;
    let indexer = null;
    let lastError = null;

    async function tick() {
        const current = readDeployment();
        if (!current) {
            if (deployment) log("Deployment file disappeared; waiting for a new deployment.");
            deployment = null;
            return;
        }
        if (!deployment || current.mtimeMs !== deploymentMtime) {
            deployment = current.data;
            deploymentMtime = current.mtimeMs;
            if (indexer) indexer.setDeployment(deployment);
            else indexer = new Indexer({ provider, deployment, store, log });
            log(`Loaded deployment for "${deployment.network}" (chain ${deployment.chainId}). Indexing from block ${deployment.startBlock}.`);
        }
        try {
            await indexer.sync();
            lastError = null;
        } catch (err) {
            if (lastError !== err.message) log(`Cannot reach the blockchain at ${config.rpcUrl}: ${err.shortMessage || err.message}`);
            lastError = err.message;
        }
    }

    await tick();
    setInterval(() => tick().catch((err) => log(`Error: ${err.message}`)), config.pollIntervalMs);

    const app = createApp({
        store,
        ipfs,
        getDeployment: () => deployment,
        getStatus: () => ({
            rpcUrl: config.rpcUrl,
            deploymentFile: path.relative(config.ROOT, config.deploymentFile),
            chainError: lastError,
        }),
        corsOrigin: config.corsOrigin,
    });
    app.listen(config.port, () => {
        log(`GiveChain backend listening on http://localhost:${config.port}`);
        if (!deployment) log("No deployment yet. Run: npm run node, then npm run deploy:local");
    });
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
