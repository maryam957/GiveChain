# GiveChain: Technical Report (draft)

*Blockchain Empowerment Project, Fall 2026.* This draft collects the technical content. Team details, the final contribution matrix and the AI-assistance statement (section 12) must be completed and checked by the team before submission.

---

## 1. Problem

When people donate to an NGO, they normally hand over control of the money and must trust the NGO to spend it as promised. Donors rarely see independent, verifiable records of where each amount went. Misuse is hard to detect, and honest NGOs struggle to prove their honesty.

**GiveChain's principle:** *don't trust the NGO with the money; let a smart contract hold it.* Donations sit in a vault contract. Money can only leave it as a direct payment to a registered, auditor-approved person, after an auditor has reviewed evidence, or as a refund to the donors themselves. Every step is public.

## 2. Why blockchain, and what stays off-chain

| Need | Why a blockchain fits |
|---|---|
| Nobody, including the NGO, can quietly move donated money | The vault's rules are code that nobody can change after deployment |
| Donors can verify spending without trusting a website | Balances and every transfer are public; the site's totals can be checked against the chain (the Transparency page does this live) |
| Approvals cannot be denied or edited later | Every approval is a signed, timestamped transaction |
| Several parties who do not fully trust each other (donors, NGO, auditor) share one record | A shared ledger with no single owner |

What blockchain does **not** solve, and how GiveChain handles it:

- **Real-world truth.** The chain proves that an auditor approved a payment, not that food was really delivered. GiveChain makes the auditor's decision explicit and permanent, and the beneficiary confirms receipt.
- **Privacy.** Public chains are readable by everyone, forever. No personal data goes on-chain; a beneficiary is a wallet plus a salted hash of their ID (section 6).
- **Large files.** Evidence (receipts, photos) is stored on IPFS. The chain stores only a fingerprint (hash) of its content address.

## 3. Use case: roles and workflows

**Roles:** Admin, Pauser, NGO, Auditor (on-chain roles), plus Donor and Beneficiary (anyone with a wallet). One wallet can never be both NGO and Auditor.

**Main workflows** (each is a sequence of real transactions):

1. **Campaign:** the NGO creates a campaign (target + IPFS details) → Active → Completed or Cancelled.
2. **Beneficiary:** the NGO registers a wallet + identity commitment → the auditor approves (or revokes).
3. **Donation:** the donor approves the token → donates to one campaign; the money is tracked per campaign.
4. **Payment (milestone):** the NGO submits a request with evidence → the auditor approves (money reserved) or rejects → the NGO releases (vault pays the beneficiary directly) → the beneficiary confirms receipt. The auditor can cancel an approved but unpaid request.
5. **Refund:** when a campaign closes, each donor can claim their pro-rata share of the unspent money, once.
6. **Emergency:** the pauser stops every state change in all contracts with one switch.

State diagrams for campaigns, beneficiaries and milestones are in [ARCHITECTURE.md §4](ARCHITECTURE.md).

## 4. Architecture

Full diagrams (component, inheritance/interaction, state machines, trust boundaries) are in [ARCHITECTURE.md](ARCHITECTURE.md).

### Contracts

| Contract | Responsibility | Lines |
|---|---|---:|
| `GiveChainAccess` | All roles and the single emergency pause; blocks NGO + Auditor on one wallet | 71 |
| `AccessControlBase` (abstract) | Inherited by the three workflow contracts: `onlyRole`, `whenNotPaused` (both ask `GiveChainAccess`) and reentrancy guard | 55 |
| `ProjectRegistry` | Campaigns and beneficiaries; holds no money | 300 |
| `DonationVault` | Holds all tokens; per-campaign accounting; donations, reservations, payouts, refunds | 323 |
| `MilestoneDisbursement` | Payment workflow; holds no money | 261 |
| `MockUSDC` | Test dollar token (6 decimals, capped faucet) | 32 |
| `IGiveChainAccess`, `IProjectRegistry`, `IDonationVault` | Interfaces for all contract-to-contract calls | 100 |

**Inheritance (meaningful, not file-splitting):** the role and pause checks are identical in three contracts, so they live once in `AccessControlBase`, which all three inherit. `GiveChainAccess` inherits OpenZeppelin `AccessControl` and `Pausable`.

**Composition:** each contract owns one kind of data and exposes only what others need, through interfaces. `MilestoneDisbursement` calls `IProjectRegistry` (status, owner, eligibility) and `IDonationVault` (reserve, release, cancel). `DonationVault` calls `IProjectRegistry` to re-check eligibility itself.

**Key design decision: the vault does not trust its caller.** Even though only `MilestoneDisbursement` may call the vault's payout functions, the vault independently re-checks campaign status, beneficiary eligibility, available campaign balance and duplicate payouts. A bug in the workflow contract therefore cannot send money to the wrong person. This is tested with a mock caller that forwards requests without any checks.

**One-time link:** the vault's payout caller is set once after deployment and can never be changed, so even a stolen admin key cannot redirect payouts.

### Off-chain components

| Component | Technology | Role |
|---|---|---|
| Backend | Node.js, Express, ethers v6 | IPFS storage service, event indexer, REST API (14 endpoints) |
| IPFS | Local content-addressed store (CIDv1, raw, sha2-256); optional Pinata pinning | Campaign details and evidence files |
| Frontend | React 18, Vite, ethers v6, MetaMask | Role dashboards, transaction status, transparency page |

## 5. Evolution from the first prototype

The team's first prototype (kept in `legacy/`) had three contracts sharing an inherited base, 47 tests and a security document. A design review against the specification found problems that shaped the final design:

| First prototype | Problem | Final design |
|---|---|---|
| One shared ETH pool for all campaigns | Campaign A could spend campaign B's donations; no per-campaign balance | Separate accounting per campaign (`CampaignFunds`) |
| First payout closed refunds for **all** donors permanently | Unrelated donors lost their refund rights | Refunds per campaign, pro-rata, once a campaign closes |
| Vault paid whatever address the caller named | Vault blindly trusted the workflow contract | Vault re-checks eligibility, status, funds and duplicates |
| ETH donations | Specification asked for a mock ERC-20; volatile value | MockUSDC with `SafeERC20` |
| Roles and pause per contract | NGO role granted three times; three pause switches | One `GiveChainAccess` with one pause switch |
| Approve and pay in one step; no receipt confirmation | Missing workflow steps from the specification | Submit → approve → release → confirm, plus cancel |
| Gas results of 78 and 163 gas (about 0.1%), measured on toy contracts | Weak evidence | 26.1% saving across a full campaign, measured on the real contracts (section 7) |

## 6. On-chain vs off-chain data and trust

| Data | Where | Reason |
|---|---|---|
| Campaign owner, target, status | On-chain | Rules depend on it |
| Campaign title, description | IPFS; full CID in the `CampaignCreated` event, `keccak256(CID)` in storage | Too large for the chain; the stored hash fixes which file was published |
| Beneficiary wallet, status | On-chain | Payouts depend on it |
| Beneficiary identity | On-chain only as `keccak256(salt, ID)`, computed **in the browser** | Blocks the same person registering twice without revealing who they are; the random salt stops guessing |
| Names, ID numbers, documents | Never on-chain or in the backend; kept by the NGO | Personal data |
| Evidence files | IPFS; CID in the event, hash in storage | The CID proves the file is unchanged; the auditor judges whether it is true |
| Donations, reservations, payouts, refunds | On-chain balances and events | The transparency promise |
| Searchable history and totals | Backend in-memory index | Rebuilt from chain events on every start; disposable |

**Integrity and failure handling:** the backend re-hashes every IPFS file when serving it and refuses to serve a file whose content does not match its CID (tested). The index is only a copy of chain events: it rebuilds after a chain restart or redeploy, and the frontend reads roles, balances and refundable amounts directly from the contracts before acting. The Transparency page compares the vault's real token balance (read from the chain) with the indexed total.

## 7. Gas optimization

Method: an exact copy of the Phase 2 contracts (`contracts/gas-baseline/`) and the optimized contracts run the same 13-step workflow, with the same accounts, inputs and chain snapshot; gas is taken from transaction receipts. A fairness check before optimizing showed identical gas for both. Reproduce with `npm run gas`. Full sheet: [GiveChain-Gas-Sheet.md](GiveChain-Gas-Sheet.md).

| Operation | Baseline | Optimized | Change |
|---|---:|---:|---:|
| createCampaign | 197,858 | 106,973 | −45.9% |
| submitMilestone | 237,472 | 140,203 | −41.0% |
| approveMilestone | 216,583 | 134,871 | −37.7% |
| releaseMilestone | 148,499 | 110,594 | −25.5% |
| claimRefund | 110,511 | 85,482 | −22.6% |
| donate (first gift) | 123,102 | 117,076 | −4.9% |
| registerBeneficiary | 109,414 | 105,162 | −3.9% |
| **Full campaign life cycle (13 actions)** | **1,463,435** | **1,081,009** | **−26.1%** |

**Optimizations:** (1) `immutable` contract addresses; (2) storage packing of four structs, with `SafeCast` for narrowed values; (3) storing `keccak256(CID)` in storage and the full CID in events.

**Measured trade-offs:** DonationVault deployment is +15.8%; `cancelMilestone` lost an SSTORE refund under packing (still −5.2% overall); CIDs must be read from events rather than a view function. Rejected ideas, such as removing the vault's re-checks, are listed in the gas sheet with reasons.

## 8. Security

Full package: [GiveChain-Security-Package.md](GiveChain-Security-Package.md), covering assets, actors, trust boundaries, 14 controls and the threat → mitigation → test tables.

**Controls:** single-source role-based access control; separation of duties; ownership checks; explicit state machines; input validation; per-campaign accounting; independent re-validation in the vault; a one-time vault link; checks-effects-interactions; `nonReentrant`; `SafeERC20`; a global pause; custom errors.

**Required negative scenarios S1–S8** (all tested): unauthorized release, reentrancy on refunds, duplicate beneficiary, repeated distribution, unauthorized approval, missing evidence, insufficient funds, and actions while paused (all 14 state-changing functions).

**Project-specific misuse scenarios M1–M5:** the NGO paying itself, one campaign draining another, a stolen admin key, refund abuse, and conflicting roles.

**Reentrancy evidence with a control:** an attacker contract re-enters `claimRefund` through a token that calls the recipient back. Against GiveChain the re-entry is blocked (`ReentrancyGuardReentrantCall`) and the attacker receives only its own 100. Against a deliberately vulnerable vault (transfer before state update, no guard), the same attacker walks away with 200, stealing 100 from an honest donor. This shows the attack is real and that the mitigation works.

## 9. Testing and results

| Suite | Tests | What it covers |
|---|---:|---|
| `GiveChainAccess` | 16 | Roles, separation of duties, pause |
| `AccessControlBase` | 12 | Modifiers via a test harness |
| `MockUSDC` | 9 | Faucet limits, ERC-20 behaviour |
| `ProjectRegistry` | 52 | Campaign and beneficiary life cycles, duplicates, permissions |
| `DonationVault` | 54 | Per-campaign isolation, reservations, payouts, refunds and rounding, accounting invariant |
| `MilestoneDisbursement` | 44 | Full milestone life cycle, permissions, separation of duties |
| End-to-end | 1 | Deploy → campaign → donations → payments → refunds, books balance to zero |
| Security scenarios | 32 | S1–S8, M1–M5, reentrancy with control |
| Backend indexer + API | 18 | Index equals on-chain state, rebuild, REST endpoints, uploads |
| Backend IPFS (`npm run backend:test`) | 16 | CID correctness, tamper detection, limits, path tricks |
| Backend accounts (`npm run backend:test`) | 18 | Password hashing, sessions, rate limiting, wallet-link signatures, on-chain role checks, applicant privacy |
| **Total** | **272** | All passing |

Boundary cases include the exact faucet limit vs one unit more, reserving exactly the available balance vs one unit more, and refunds that round to zero.

**System test in a browser** on a live local chain: donate, auditor approvals, NGO campaign creation and payout, a deliberate duplicate-registration failure shown with its decoded reason, beneficiary confirmation, refund claim, pause banner, transparency check and phone layout. Not covered in that run: the MetaMask extension itself (demo accounts were used), evidence upload through the website form (covered by API tests), and the Pause and role buttons (pause was triggered from the command line).

**Reproducibility:** a fresh clone of the repository was installed and passed all tests, the frontend build and the gas benchmark using only the README commands.

## 10. Frontend and integration

The website shows each role only the actions its wallet holds on-chain. Every transaction goes through one runner that shows *Confirm in wallet → Pending (hash) → Confirmed (block)* or *Rejected / Failed* with the contract's custom error decoded into plain English; success is never shown before the receipt. After confirmation the page waits until the backend has indexed that block, so lists never show stale data. Off-chain features visible in the UI: IPFS campaign details and evidence with "verified against CID" badges, evidence upload, the indexed activity feed, and the independent balance check.

## 11. Limitations and future work

- The auditor is a human judgement; collusion between an NGO and an auditor is made public but not prevented. *Future:* several auditors with an M-of-N threshold.
- A single admin key can appoint roles. *Future:* a multisig admin and a timelock on role changes.
- Pausing also blocks refunds.
- Closing a campaign voids approved but unpaid payments (their money becomes refundable); the UI warns the NGO.
- Pro-rata refunds round down; at most a few millionths of a dollar remain in the vault.
- Only standard ERC-20 tokens (no fee-on-transfer or rebasing).
- Contracts are not upgradeable.
- Backend uploads have no login or rate limit; IPFS files persist only while pinned; Pinata mode is implemented but untested.
- Static analysis (for example Slither) was not run.
- Demo-account mode is for local demos only and is disabled on other networks.

## 12. Reused code, tools and AI assistance

- **OpenZeppelin Contracts v5** (MIT): `AccessControl`, `Pausable`, `ReentrancyGuard`, `ERC20`, `SafeERC20`, `SafeCast`.
- **Libraries and tools:** Hardhat and hardhat-toolbox (Mocha/Chai, gas reporter), ethers.js v6, Express, multer, multiformats, React, React Router, Vite.
- **AI assistance (to be completed by the team):** much of the code and documentation from Phase 0 onward was produced with an AI coding assistant (Claude Code), directed, reviewed and tested by the team member who committed it. Check your course and institution policy on AI use, and state here exactly how it was used. Every team member must be able to explain every part they are credited with, because the viva assesses this individually.
- **Original project work:** the problem framing, use case and business rules; the first prototype (`legacy/`); and the design decisions recorded in `docs/PLAN.md` and `docs/ARCHITECTURE.md`.

## 13. Team contributions

See [CONTRIBUTIONS.md](CONTRIBUTIONS.md).

## Appendix: running the project

See the [README](../README.md) (setup and the four-terminal demo) and [DEMO.md](DEMO.md) (demo accounts, MetaMask settings, a 9-step live demo script).
