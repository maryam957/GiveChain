# GiveChain Deployment and Testing Instructions

## Requirements

- Node.js and npm
- Dependencies installed with `npm install`
- Hardhat 2.29.2
- Solidity 0.8.28
- OpenZeppelin contracts

## Compile

```bash
npx hardhat compile
```

## Run Automated Tests

```bash
npx hardhat test
```

The test suite uses a temporary local blockchain; no separate node is required.

## Start a Local Blockchain

Keep this process running in one terminal:

```bash
npx hardhat node
```

Do not publish or document the development private keys printed by Hardhat.

## Deploy Contracts

In a second terminal:

```bash
npx hardhat run scripts/deploy.js --network localhost
```

The deployment script assigns the NGO and auditor roles and grants the milestone
and disbursement roles required by the vault.

## Run the Donation Script

```bash
npx hardhat run scripts/testDonation.js --network localhost
```

The script uses the deployed `DonationVault` address. Redeploy before running it
if the local node or deployment state has been recreated.

## Final Verification

```bash
npx hardhat compile
npx hardhat test
```
