# GiveChain Security Package

Threat model, mitigations and test evidence for the GiveChain smart contracts.

The contracts in scope are `GiveChainAccess`, `AccessControlBase`, `ProjectRegistry`, `DonationVault`, `MilestoneDisbursement` and `MockUSDC`. Design context, diagrams and trust boundaries are in [ARCHITECTURE.md](ARCHITECTURE.md).

**Evidence:** `npm test` runs **220 tests, all passing**. The attack and misuse scenarios are in [test/Security.test.js](../test/Security.test.js) (32 tests). Each scenario id below (S1–S8, M1–M5) is the name of a `describe` block in that file.

## 1. Assets

| Asset | Why it matters |
|---|---|
| MockUSDC held by `DonationVault` | Donor money; the main target |
| Per-campaign accounting (donated, reserved, released, refunded) | If wrong, one campaign can spend another's money or refunds can over-pay |
| Roles in `GiveChainAccess` | Whoever holds them controls approvals and the pause switch |
| Beneficiary approval status | Decides who can be paid |
| Milestone status | Decides what can be paid, and only once |
| Vault → MilestoneDisbursement link | The only path money can leave the vault as a payout |
| Beneficiary privacy | Personal data must never reach the public chain |

## 2. Actors

| Actor | Trust level | Can | Must not be able to |
|---|---|---|---|
| Admin | Trusted to manage roles | Grant/revoke roles, cancel any campaign | Move money, approve anything, redirect payouts |
| Pauser | Trusted for emergencies | Pause/unpause the whole system | Anything else |
| NGO | **Not trusted with money** | Run its own campaigns, register beneficiaries, submit and release milestones | Approve its own requests, pay itself, touch other NGOs' campaigns or money |
| Auditor | Trusted to judge evidence | Approve/revoke beneficiaries, approve/reject/cancel milestones | Approve for a campaign it owns, approve a payment to itself, release money |
| Donor | Untrusted | Donate, claim a fair refund from a closed campaign | Refund twice, refund from a running campaign, take others' money |
| Beneficiary | Untrusted | Receive payouts, confirm receipt | Confirm someone else's payout |
| Outsider / attacker contract | Hostile | Read everything | Change anything |

## 3. Trust boundaries

1. **Users → contracts.** Every state-changing function checks the caller's role and the campaign's ownership. The frontend is never trusted.
2. **MilestoneDisbursement → DonationVault.** The vault accepts payout calls only from one address, set once and never changeable, and it **re-checks** eligibility, campaign status, available funds and duplicate payouts itself.
3. **DonationVault → token.** Tokens are moved with OpenZeppelin `SafeERC20`, after all state changes and under a reentrancy guard.
4. **Chain → off-chain.** Only CIDs and hashed identity commitments go on-chain. IPFS proves a file was not changed after submission; it does not prove the file is true. That judgement belongs to the auditor.

## 4. Controls applied

| Control | Where | Why it is needed |
|---|---|---|
| Role-based access control (single source) | `GiveChainAccess` + `AccessControlBase.onlyRole` | Roles are granted once and checked identically in every contract |
| Separation of duties | `GiveChainAccess._grantRole`, `MilestoneDisbursement.approveMilestone`, `ProjectRegistry.approveBeneficiary` | Nobody can both request and approve a payment, or approve themselves |
| Ownership checks | `ProjectRegistry`, `MilestoneDisbursement` | An NGO acts only on its own campaigns |
| State machines | Campaign, beneficiary, milestone and reservation status enums | Every action is allowed only from the right state, which blocks duplicates and replays |
| Input validation | Zero amounts, zero addresses, empty CIDs, empty identity commitments | Rejects meaningless or malformed requests |
| Per-campaign accounting | `DonationVault.CampaignFunds` | A campaign can only reserve its own available money |
| Independent re-validation | `DonationVault.reserveFunds` / `releaseFunds` | A bug in the workflow contract cannot misdirect money |
| One-time vault link, contract only | `DonationVault.setDisbursementContract` | A stolen admin key cannot redirect payouts |
| Checks-effects-interactions | `donate`, `claimRefund`, `releaseFunds`, `approveMilestone`, `releaseMilestone` | State is final before any external call |
| Reentrancy guard | `nonReentrant` on every function that moves tokens or calls the vault | Second, independent layer against re-entry |
| SafeERC20 | `DonationVault` | Handles tokens that return `false` instead of reverting |
| Global emergency pause | `GiveChainAccess.pause` + `AccessControlBase.whenNotPaused` | One switch stops every state change in every contract; reads keep working |
| Custom errors with arguments | All contracts | Exact, testable failure reasons for the frontend and tests |
| Privacy by design | `ProjectRegistry` stores `keccak256(salt, ID)` only | Detects duplicate people without publishing who they are |

## 5. Threats, mitigations and evidence

### Required scenarios from the project specification

| Id | Threat | Mitigation | Evidence (`test/Security.test.js`) |
|---|---|---|---|
| S1 | Unauthorized user releases funds | `onlyRole(NGO)` + campaign ownership on `releaseMilestone`; `onlyDisbursement` on vault functions | Strangers, other NGOs, auditors, the admin and beneficiaries are all rejected; the vault balance is unchanged |
| S2 | Reentrancy attack on a refund | `nonReentrant` + refund recorded before transfer | An attacker contract re-enters `claimRefund` through a token hook: blocked with `ReentrancyGuardReentrantCall`, and it is paid only its own 100. **Control test:** the same attacker steals 100 extra from a deliberately vulnerable vault |
| S3 | Duplicate beneficiary registration | Status check per wallet + `identityUsed` per campaign | Same wallet rejected; same person under a new wallet rejected |
| S4 | Repeated distribution of one allocation | Milestone status machine + vault reservation status | Release called four times pays once; a paid milestone cannot be re-approved; the vault alone also refuses a second payout |
| S5 | Unauthorized milestone approval | `onlyRole(AUDITOR)`; approver cannot be campaign NGO or beneficiary | NGO, admin, donor, beneficiary and stranger rejected; an ex-NGO auditor cannot approve their own campaign |
| S6 | Missing or swapped evidence | Empty CID rejected; no function edits evidence after submission | Submission without evidence fails; the stored CID is fixed |
| S7 | Release without sufficient funds | Approval reserves funds; vault checks the campaign's available balance | Over-sized approval fails; two approvals cannot together exceed the balance |
| S8 | Actions while paused | `whenNotPaused` on all 14 state-changing functions | All 14 functions revert with `SystemPaused`; reads still work; unpausing resumes; only pausers can pause |

### GiveChain-specific misuse scenarios

| Id | Threat | Mitigation | Evidence |
|---|---|---|---|
| M1 | NGO pays itself | NGO cannot register its own wallet; every beneficiary needs auditor approval; money goes only to the beneficiary | Own-wallet registration fails; an unapproved sockpuppet cannot be paid; the NGO's balance stays 0 |
| M2 | One campaign drains another's donations | Per-campaign accounting | A campaign with 0 donated cannot reserve 1 unit while the vault holds 1,000 for another campaign |
| M3 | Admin key stolen | Admin holds no money powers; vault link is permanent | Admin cannot release, approve or relink; cancelling only lets donors take back their own money |
| M4 | Refund abuse | Refunds only when closed, once per donor, pro-rata of unspent money | Refund while running, a second claim and a non-donor claim all fail; paid-out money is not refunded |
| M5 | One person holds conflicting roles | `GiveChainAccess` refuses NGO + Auditor on one wallet | Both grant orders are rejected |

### Further evidence in the unit tests

The per-contract test files also cover boundary cases, for example: exactly the faucet limit vs one unit more; reserving exactly the available balance vs one unit more; refunds that round down to zero; and an accounting invariant test checking that the vault's token balance equals the sum of every campaign's held balance after a long mixed sequence of actions.

## 6. How to reproduce

```bash
npm install
npx hardhat test test/Security.test.js   # security scenarios only
npm test                                  # everything (220 tests)
```

## 7. Known limitations

- **Human judgement.** The auditor decides whether evidence is genuine. The chain proves what was approved and paid, not that aid was really delivered.
- **Trusted admin.** The admin can grant roles. A stolen admin key could appoint a fake auditor and NGO, who together could pay a fake beneficiary. Production would use a multisig wallet and several auditors. Every role change is public through `RoleGranted` events.
- **Collusion.** An NGO and an auditor working together can still approve a fake beneficiary. GiveChain makes such approvals permanent and public, but cannot prevent them.
- **Paused refunds.** The pause also blocks refunds, so donors wait during an emergency. This was chosen for simplicity and safety.
- **Closing a campaign voids approved but unpaid milestones.** Their money becomes refundable instead. The frontend will warn the NGO.
- **Rounding.** Pro-rata refunds round down, leaving at most a few units (millionths of a cent) in the vault.
- **Token assumptions.** Only standard ERC-20 tokens are supported; fee-on-transfer or rebasing tokens would break the accounting.
- **No upgrades.** Contracts cannot be upgraded; fixing a bug means redeploying.
- **Static analysis** (for example Slither) has not been run yet. All evidence above comes from automated tests.

## 8. Reused code (attribution)

Audited OpenZeppelin Contracts v5 are used for `AccessControl`, `Pausable`, `ReentrancyGuard`, `ERC20` and `SafeERC20`. Everything else in `contracts/` is original project code. The test-only contracts in `contracts/mocks/` (`HookToken`, `RefundReentrancyAttacker`, `VulnerableRefundVault`, `MockDisbursementCaller`, `AccessControlBaseHarness`) are never deployed in the demo.
