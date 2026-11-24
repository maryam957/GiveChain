# GiveChain

A blockchain-based NGO donation platform. Donations sit in a smart-contract vault, and money only leaves it when an independent auditor has approved the payment. Every donation, approval and payout can be checked on-chain.

> Work in progress. See [docs/PLAN.md](docs/PLAN.md) for the phases and what is done.

## Project layout

| Folder | Contents |
|---|---|
| `contracts/` | Solidity contracts |
| `contracts/interfaces/` | Contract interfaces (Phase 1) |
| `contracts/mocks/` | Test-only contracts (attackers, mock token) |
| `test/` | Hardhat tests |
| `scripts/` | Deployment and demo scripts |
| `backend/` | Node.js indexer and IPFS service (Phase 6) |
| `frontend/` | React app (Phase 7) |
| `docs/` | Plan, architecture, security package, gas sheet |
| `legacy/` | First ETH-based prototype, kept for reference (not compiled) |

## Quick start

Requires Node.js 18 or newer.

```bash
npm install
npm run compile
npm test
```

| Command | What it does |
|---|---|
| `npm test` | Runs all contract tests on a temporary local chain |
| `npm run test:gas` | Runs the tests and prints a gas report |
| `npm run gas` | Baseline vs optimized gas benchmark; writes `docs/gas-results.md` |
| `npm run node` | Starts a local blockchain at `http://127.0.0.1:8545` |
| `npm run deploy:local` | Deploys the contracts to the local blockchain (run `npm run node` first, in another terminal). Available again from Phase 5. |

## Configuration

Copy `.env.example` to `.env` only if you need a testnet or the IPFS backend. Local development needs no `.env`. Never commit `.env` or a real private key.
