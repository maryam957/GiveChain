# GiveChain

A blockchain-based NGO donation platform. Donations sit in a smart-contract vault, and money only leaves it when an independent auditor has approved the payment. Every donation, approval and payout can be checked on-chain.

> See [docs/PLAN.md](docs/PLAN.md) for the phases and what is done.

## Project layout

| Folder | Contents |
|---|---|
| `contracts/` | Solidity contracts |
| `contracts/interfaces/` | Contract interfaces |
| `contracts/mocks/` | Test-only contracts (attackers, mock token) |
| `contracts/gas-baseline/` | Unoptimized copies used only by the gas benchmark |
| `test/` | Hardhat tests (contracts, security scenarios, backend indexer) |
| `scripts/` | Deploy, seed and gas benchmark scripts |
| `seed-data/` | Fictional campaign details and evidence files for the demo |
| `deployments/` | Generated contract addresses and ABIs (local files are not committed) |
| `backend/` | Node.js IPFS service, event indexer and REST API ([backend/README.md](backend/README.md)) |
| `frontend/` | React website with MetaMask ([frontend/README.md](frontend/README.md)) |
| `docs/` | Plan, architecture, security package, gas sheet, demo guide |
| `legacy/` | First ETH-based prototype, kept for reference (not compiled) |

## Setup

Requires Node.js 18 or newer.

```bash
npm install
npm run backend:install
npm run frontend:install
npm test
```

## Run the full demo

Use four terminals in the project folder:

```bash
npm run node            # 1. local blockchain (keep running)
npm run deploy:local    # 2. deploy contracts...
npm run seed:local      #    ...and add demo data
npm run backend         # 3. backend API at http://localhost:4000 (keep running)
npm run frontend        # 4. website at http://localhost:5173 (keep running)
```

Then open http://localhost:5173. Demo accounts, MetaMask settings and a demo script are in [docs/DEMO.md](docs/DEMO.md).

## All commands

| Command | What it does |
|---|---|
| `npm test` | Contract, security and backend-indexer tests on a temporary chain |
| `npm run test:gas` | Same tests with a per-function gas report |
| `npm run gas` | Baseline vs optimized gas benchmark; writes `docs/gas-results.md` |
| `npm run node` | Local blockchain at `http://127.0.0.1:8545` |
| `npm run deploy:local` | Deploys the contracts and writes `deployments/localhost.json` |
| `npm run seed:local` | Demo campaigns, donations and payments |
| `npm run backend` | Backend (IPFS + indexer + API) at `http://localhost:4000` |
| `npm run backend:test` | Backend IPFS tests |
| `npm run frontend` | Website at `http://localhost:5173` |
| `npm run frontend:build` | Production build of the website |

## Configuration

Copy `.env.example` to `.env` only if you need a testnet or Pinata. Local development needs no `.env`. Never commit `.env` or a real private key.
