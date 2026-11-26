require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, GANACHE_URL } = process.env;

// Sepolia is only added when both values are present in .env,
// so the project works locally without any secrets.
const networks = {
  // Hardhat's own local node: `npm run node`
  localhost: { url: "http://127.0.0.1:8545" },
  // Ganache (desktop app default: port 7545, chain id 1337). Uses Ganache's unlocked
  // accounts, so no keys are needed here. Set GANACHE_URL for a different port.
  ganache: { url: GANACHE_URL || "http://127.0.0.1:7545" },
};
if (SEPOLIA_RPC_URL && DEPLOYER_PRIVATE_KEY) {
  networks.sepolia = {
    url: SEPOLIA_RPC_URL,
    accounts: [DEPLOYER_PRIVATE_KEY],
  };
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks,
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    noColors: true,
    outputFile: process.env.GAS_REPORT_FILE || undefined,
  },
};
