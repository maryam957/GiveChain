// Deploys the full GiveChain system and writes deployments/<network>.json
// (addresses, ABIs, roles, start block) for the backend and frontend.
//
// Local:   npm run node            (terminal 1, keep running)
//          npm run deploy:local    (terminal 2)
//
// Order follows docs/ARCHITECTURE.md section 9.
//
// Roles on a local chain (Hardhat or Ganache) use the node's own test accounts (see docs/DEMO.md).
// On other networks, set NGO_ADDRESSES and AUDITOR_ADDRESSES in .env
// (comma-separated); the deployer becomes admin and pauser.

const fs = require("fs");
const path = require("path");
const { ethers, network, artifacts } = require("hardhat");

const LOCAL_NETWORKS = ["hardhat", "localhost", "ganache"];

/** Hardhat test account index for each demo role (local chains only). */
const LOCAL_ROLE_ACCOUNTS = {
    admin: 0,
    ngos: [1, 2],
    auditors: [3],
};

function parseAddressList(value) {
    return (value || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => ethers.getAddress(s));
}

async function deployContract(name, args = []) {
    const contract = await (await ethers.getContractFactory(name)).deploy(...args);
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log(`  ${name.padEnd(22)} ${address}`);
    return contract;
}

async function main() {
    const signers = await ethers.getSigners();
    const deployer = signers[0];
    const isLocal = LOCAL_NETWORKS.includes(network.name);
    const { chainId } = await ethers.provider.getNetwork();
    const startBlock = await ethers.provider.getBlockNumber();

    console.log(`Deploying GiveChain to "${network.name}" (chain ${chainId})`);
    console.log(`  Deployer / admin      ${deployer.address}\n`);

    // 1-5. Contracts.
    const access = await deployContract("GiveChainAccess", [deployer.address]);
    const token = await deployContract("MockUSDC");
    const registry = await deployContract("ProjectRegistry", [await access.getAddress()]);
    const vault = await deployContract("DonationVault", [
        await access.getAddress(),
        await registry.getAddress(),
        await token.getAddress(),
    ]);
    const milestones = await deployContract("MilestoneDisbursement", [
        await access.getAddress(),
        await registry.getAddress(),
        await vault.getAddress(),
    ]);

    // 6. Link the vault to MilestoneDisbursement (one time only).
    await (await vault.setDisbursementContract(await milestones.getAddress())).wait();
    console.log("\n  Vault linked to MilestoneDisbursement (permanent)");

    // 7. Roles.
    const ngoAddresses = isLocal
        ? LOCAL_ROLE_ACCOUNTS.ngos.map((i) => signers[i].address)
        : parseAddressList(process.env.NGO_ADDRESSES);
    const auditorAddresses = isLocal
        ? LOCAL_ROLE_ACCOUNTS.auditors.map((i) => signers[i].address)
        : parseAddressList(process.env.AUDITOR_ADDRESSES);

    const NGO_ROLE = await access.NGO_ROLE();
    const AUDITOR_ROLE = await access.AUDITOR_ROLE();
    for (const address of ngoAddresses) {
        await (await access.grantRole(NGO_ROLE, address)).wait();
        console.log(`  NGO role      -> ${address}`);
    }
    for (const address of auditorAddresses) {
        await (await access.grantRole(AUDITOR_ROLE, address)).wait();
        console.log(`  Auditor role  -> ${address}`);
    }

    // Write addresses + ABIs for the backend and frontend.
    const contracts = { GiveChainAccess: access, MockUSDC: token, ProjectRegistry: registry, DonationVault: vault, MilestoneDisbursement: milestones };
    const output = {
        network: network.name,
        chainId: Number(chainId),
        deployedAt: new Date().toISOString(),
        startBlock,
        deployer: deployer.address,
        roles: {
            admin: deployer.address,
            pausers: [deployer.address],
            ngos: ngoAddresses,
            auditors: auditorAddresses,
        },
        contracts: {},
    };
    for (const [name, contract] of Object.entries(contracts)) {
        output.contracts[name] = {
            address: await contract.getAddress(),
            abi: (await artifacts.readArtifact(name)).abi,
        };
    }

    const dir = path.join(__dirname, "..", "deployments");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${network.name}.json`);
    fs.writeFileSync(file, JSON.stringify(output, null, 2) + "\n");
    console.log(`\nWritten ${path.relative(process.cwd(), file)}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
