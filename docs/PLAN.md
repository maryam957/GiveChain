# GiveChain — Completion Plan

We work one phase at a time. A phase is finished only when its "Done when" line is true.

## Rules to agree on first (proposed defaults)

These are business rules the spec leaves open. Change any of them before Phase 1 ends.

| # | Question | Proposed rule |
|---|---|---|
| R1 | Which money? | **MockUSDC** (test ERC-20, 6 decimals, free "faucet" mint for the demo). No ETH donations. |
| R2 | Who are the roles? | Admin, NGO, **Auditor** (kept from the current code), Pauser. Donors and beneficiaries need no role. |
| R3 | Who approves? | Only an Auditor approves beneficiaries and milestones. An NGO can never approve its own. |
| R4 | Campaign states | `Active → Completed` (NGO closes it) or `Active → Cancelled` (NGO or Admin). Donations only while Active. |
| R5 | When are refunds allowed? | When a campaign is **Completed or Cancelled**. Each donor claims once: their share of the money not yet paid out (pro-rata). *Refined in Phase 1: Completed was added so leftover money can't get stuck.* |
| R6 | Milestone states | `Submitted → Approved → Released → Confirmed`, or `Submitted → Rejected`, or `Approved → Cancelled`. Approve **reserves** the campaign's money; Release (by the campaign's NGO) pays the beneficiary; Confirm is done by the beneficiary. *Phase 1 added Cancel (auditor), which frees the money if a beneficiary is revoked after approval.* |
| R7 | Emergency stop | One system-wide pause switch in `GiveChainAccess`, which also holds all roles, so every role is granted once. |
| R11 | Separation of duties | One wallet can never hold both the NGO and Auditor roles (enforced in `GiveChainAccess`, Phase 2a). MilestoneDisbursement also checks that the approver is not the campaign's NGO. |
| R12 | Vault link | The vault accepts payout calls only from the MilestoneDisbursement address, set once after deployment and never changeable. |
| R8 | Evidence files | Stored on IPFS; only the CID goes on-chain. A milestone without a CID is rejected. |
| R9 | Beneficiary privacy | On-chain: wallet + salted hash of the ID only. Auditor can revoke a beneficiary. |
| R10 | Network | Hardhat local chain for the demo. Sepolia testnet is optional at the end. |

## Phase 0 — Clean-up and setup

- Start a git repository (commits are the evidence for the contribution matrix).
- Delete the Hardhat sample files (`Lock.sol`, `test/Lock.js`, `ignition/`).
- Fix `package.json` scripts (`test`, `compile`, `node`, `deploy`), add `.env.example`.
- Add the gas reporter plugin setting and folders: `contracts/interfaces`, `contracts/mocks`, `backend/`, `frontend/`.

**Done when:** `npm test` runs the GiveChain tests and nothing from the sample project is left.

## Phase 1 — Design on paper (no contract logic yet)

- `docs/ARCHITECTURE.md`: roles and permission table, campaign / beneficiary / milestone state diagrams, contract interaction diagram, trust boundaries, on-chain vs off-chain data map.
- Write the interfaces as real code: `IProjectRegistry.sol`, `IDonationVault.sol`.

**Done when:** you and your partner agree with the rules table above and the interfaces compile.

## Phase 2 — Fix the contracts (small steps, tests with each step)

| Step | Contract | What changes | Fixes problem |
|---|---|---|---|
| 2a | `MockUSDC` + `GiveChainAccess` + `AccessControlBase` | Test token; roles and the system-wide pause in one place | 4, 7 |
| 2b | `ProjectRegistry` | Campaign target, metadata CID, status changes (R4), beneficiary revoke, implements `IProjectRegistry` | 5 |
| 2c | `DonationVault` | **Separate balance per campaign**, per-campaign donor records, refunds by rule R5, safe ERC-20 transfers, checks beneficiary + balance + "already paid?" itself before paying | 1, 2, 3 |
| 2d | `MilestoneDisbursement` | Separate approve / release / confirm-receipt steps (R6), talks to the others only through interfaces | 5 |

Custom errors and NatSpec comments are used in every contract.

Phase 2 contracts are written for **clarity first**. They become the documented gas baseline in Phase 4, where the optimizations (immutable addresses, struct packing, `bytes32` CIDs, ...) are applied and measured against them.

Progress: **2a done** (GiveChainAccess, AccessControlBase, MockUSDC; 37 tests). **2b done** (ProjectRegistry; 52 tests).

**Done when:** all unit tests for each contract pass, including the full happy path: create campaign → register and approve beneficiary → donate → submit → approve → release → confirm.

## Phase 3 — Security

- Tests for the 8 attack scenarios in the spec: unauthorized release, reentrancy (using a malicious token), duplicate beneficiary, double payout of one milestone, unauthorized approval, missing evidence, not enough funds, action while paused.
- Rewrite `docs/GiveChain-Security-Package.md`: assets, actors, trust boundaries, threat → mitigation → test table, known limitations.

**Done when:** every threat in the document points to a passing test.

## Phase 4 — Gas report

- Keep a "before" copy of the contracts as the baseline.
- Apply and measure on the **real** contracts: (1) tighter struct packing, (2) CID stored as `bytes32` instead of a string, (3) `immutable` contract addresses, (4) custom errors everywhere.
- Measure at least: donate, create campaign, register beneficiary, approve milestone, release funds.
- Rewrite `docs/GiveChain-Gas-Sheet.md` with before / after / % change and trade-offs.

**Done when:** one command reproduces the before/after table.

## Phase 5 — Deployment

- `scripts/deploy.js`: deploys everything, sets roles, saves addresses + ABIs to a file the backend and frontend read.
- `scripts/seed.js`: creates a demo campaign, beneficiaries and donations so the demo starts with data.

**Done when:** `npx hardhat node` + one deploy command gives a ready-to-use local system.

## Phase 6 — Backend (Node.js)

- IPFS upload/download endpoint (Pinata key from `.env`, with a local fallback so the demo works offline).
- Event listener that indexes campaigns, donations, milestones and releases into a small database (SQLite).
- REST API for the frontend: campaigns, a campaign's history, a donor's history, transparency totals.

**Done when:** uploading a file returns a CID, and a donation made on-chain shows up in the API within seconds.

## Phase 7 — Frontend (React + Vite + ethers.js + MetaMask)

Built in this order, each usable before the next starts:

1. Wallet connect, role detection, transaction status (pending / confirmed / failed).
2. Landing page and campaign page with **Donate** (approve + deposit).
3. NGO dashboard: create campaign, register beneficiary, submit milestone with evidence upload.
4. Auditor dashboard: approve beneficiaries, approve / reject milestones.
5. Beneficiary dashboard: status, received assistance, confirm receipt.
6. Donor dashboard and public transparency dashboard.

**Done when:** the whole story can be clicked through in the browser with four MetaMask accounts.

## Phase 8 — Integration and hand-in

- Full end-to-end run on a fresh machine using only the README.
- README (setup, run, deploy, demo script), architecture diagrams, technical report draft, contribution matrix.
- Demo rehearsal, including one live "attack fails" moment.

**Done when:** every row of the course rubric points to a file, a test or a demo step.

## How the old problems map to phases

| Problem | Fixed in |
|---|---|
| 1. One shared money pool | 2c |
| 2. Refunds close for everyone | 2c |
| 3. Vault trusts blindly | 2c |
| 4. ETH instead of MockUSDC | 2a, 2c |
| 5. Missing features and interfaces | 1, 2b, 2d |
| 6. Weak gas results | 4 |
| 7. Three pause buttons | 2a |
| 8. Leftover files, stale docs | 0, 3, 8 |
| No frontend / backend / IPFS | 6, 7 |
