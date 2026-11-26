# GiveChain Gas Evaluation Sheet

## Summary

Three optimizations were applied to the Phase 2 contracts and measured against an exact copy of them under identical conditions.

- **Five core operations:** createCampaign −45.9%, approveMilestone −37.7%, releaseMilestone −25.5%, donate −4.9% to −8.4%, registerBeneficiary −3.9%.
- **One full campaign life cycle** (the 13 measured actions): **1,463,435 → 1,081,009 gas, −26.1%.**
- **Costs:** deploying `DonationVault` costs 15.8% more (paid once), and `cancelMilestone` loses a gas refund it used to get (see trade-offs).

## 1. Methodology

| Item | Setting |
|---|---|
| Baseline | `contracts/gas-baseline/Baseline*.sol`: exact copies of the Phase 2 contracts, changed only by a `Baseline` name prefix |
| Optimized | The real contracts in `contracts/` |
| Tool | `scripts/gas-benchmark.js`, run with `npm run gas` |
| Measurement | `receipt.gasUsed` of each transaction (includes the 21,000 base cost and calldata) |
| Network | Hardhat in-process network |
| Compiler | Solidity 0.8.28, optimizer on, 200 runs (same for both) |
| Equal conditions | Both systems run the same 13-step workflow with the same accounts and inputs. The chain is reverted to a snapshot between the two runs, so even contract addresses are identical. |
| Fairness check | Before any optimization, the script reported identical gas for every action (the only difference was 12 gas at deploy, caused by the different contract name) |
| Output | Printed table plus `docs/gas-results.md` and `docs/gas-results.json` (generated) |

Custom errors are **not** counted as an optimization here. The baseline already uses them; the first prototype measured that saving separately (78 gas per revert; see `legacy/`).

## 2. Results

Baseline vs final. Regenerate with `npm run gas`.

| Operation | Baseline gas | Optimized gas | Saved | Change |
|---|---:|---:|---:|---:|
| createCampaign | 197,858 | 106,973 | 90,885 | **−45.9%** |
| registerBeneficiary | 109,414 | 105,162 | 4,252 | −3.9% |
| approveBeneficiary | 43,044 | 40,783 | 2,261 | −5.3% |
| donate (donor's first gift) | 123,102 | 117,076 | 6,026 | −4.9% |
| donate (repeat gift) | 71,802 | 65,776 | 6,026 | −8.4% |
| submitMilestone | 237,472 | 140,203 | 97,269 | **−41.0%** |
| approveMilestone (reserves funds) | 216,583 | 134,871 | 81,712 | **−37.7%** |
| releaseMilestone (pays beneficiary) | 148,499 | 110,594 | 37,905 | **−25.5%** |
| confirmReceipt | 38,040 | 33,903 | 4,137 | −10.9% |
| rejectMilestone | 61,251 | 41,911 | 19,340 | −31.6% |
| cancelMilestone (frees funds) | 63,936 | 60,607 | 3,329 | −5.2% |
| completeCampaign | 41,923 | 37,668 | 4,255 | −10.1% |
| claimRefund | 110,511 | 85,482 | 25,029 | −22.6% |
| **Total, one campaign life cycle** | **1,463,435** | **1,081,009** | **382,426** | **−26.1%** |
| Deploy ProjectRegistry | 1,386,781 | 1,272,321 | 114,460 | −8.3% |
| Deploy DonationVault | 1,433,203 | 1,659,791 | −226,588 | **+15.8%** |
| Deploy MilestoneDisbursement | 1,386,242 | 1,321,908 | 64,334 | −4.6% |

## 3. Contribution of each optimization

The optimizations were applied one at a time and the benchmark was run after each step. Each column is cumulative.

| Operation | Baseline | + Opt 1 immutable | + Opt 2 packing | + Opt 3 CID hash |
|---|---:|---:|---:|---:|
| createCampaign | 197,858 | 195,598 | 151,754 | 106,973 |
| registerBeneficiary | 109,414 | 107,157 | 105,162 | 105,162 |
| approveBeneficiary | 43,044 | 40,778 | 40,783 | 40,783 |
| donate (first gift) | 123,102 | 116,754 | 117,076 | 117,076 |
| donate (repeat gift) | 71,802 | 65,454 | 65,776 | 65,776 |
| submitMilestone | 237,472 | 232,912 | 184,967 | 140,203 |
| approveMilestone | 216,583 | 205,875 | 134,871 | 134,871 |
| releaseMilestone | 148,499 | 135,679 | 110,594 | 110,594 |
| confirmReceipt | 38,040 | 35,895 | 33,903 | 33,903 |
| rejectMilestone | 61,251 | 59,000 | 41,911 | 41,911 |
| cancelMilestone | 63,936 | 57,437 | 60,607 | 60,607 |
| completeCampaign | 41,923 | 39,687 | 37,668 | 37,668 |
| claimRefund | 110,511 | 104,166 | 85,482 | 85,482 |
| Deploy ProjectRegistry | 1,386,781 | 1,396,186 | 1,401,474 | 1,272,321 |
| Deploy DonationVault | 1,433,203 | 1,437,124 | 1,659,791 | 1,659,791 |
| Deploy MilestoneDisbursement | 1,386,242 | 1,402,170 | 1,453,402 | 1,321,908 |

`npm run gas` regenerates the baseline-vs-final comparison. The intermediate columns were recorded while developing, by running the same script after each step.

## 4. The optimizations

### Optimization 1: `immutable` contract addresses

**What:** `access` (in `AccessControlBase`), `token` and `registry` (in `DonationVault`), and `registry` and `vault` (in `MilestoneDisbursement`) became `immutable`.

**Why it saves gas:** an `immutable` value is written into the contract's bytecode at deployment. Reading it is a cheap code read instead of a storage read (`SLOAD`), which costs 2,100 gas the first time in a transaction. Every protected function reads `access` at least twice (role check and pause check), and vault functions also read `registry` and `token`.

**Measured:** about 2,100–2,300 gas saved on simple actions, and up to 12,820 on `releaseMilestone`, which crosses three contracts.

**Trade-off:** deployment costs 0.3–1.1% more. The addresses can never change, which matches the design (contracts are not upgradeable) and is also a security benefit.

### Optimization 2: storage packing

**What:** struct fields were reordered and narrowed so several fit in one 32-byte storage slot.

| Struct | Before | After |
|---|---|---|
| `Campaign` | ngo, target, status, createdAt each in own slot (+ string) | ngo + status + `uint40` createdAt share 1 slot |
| `CampaignFunds` | 4 × `uint256` = 4 slots | 4 × `uint128` = 2 slots; `reserved` + `released` together (a payout changes both) |
| `Reservation` | 4 slots | 2 slots: beneficiary + status; `uint128` campaignId + amount |
| `Milestone` | 6 slots (+ string) | 3 slots (+ string): beneficiary + status + `uint40` submittedAt; reviewedBy + `uint96` campaignId; amount |

The vault also reads a reservation into memory once instead of re-reading storage for each field.

**Why it saves gas:** writing a new storage slot costs about 22,100 gas, and reading a cold one 2,100. Fewer slots means fewer of both. One detail: `reviewedBy` shares a slot with `campaignId`, so recording the auditor at approval overwrites an already-used slot (about 2,900 gas) instead of filling an empty one (about 22,100). That is a large part of `approveMilestone`'s 37.7% saving.

**Measured:** approveMilestone −34%, rejectMilestone −29%, submitMilestone −21% and claimRefund −18% relative to step 1. `registerBeneficiary` also got cheaper, because a campaign's owner and status are now read in one slot.

**Trade-offs (measured):**
- `DonationVault` deployment +15.8%: the narrowing needs safe-conversion checks (OpenZeppelin `SafeCast`) and bit masking.
- `donate` +322 gas versus step 1, for the `SafeCast` overflow check.
- `cancelMilestone` +3,170 gas versus step 1. Before, cancelling set `reserved` back to zero in its own slot, which earns an Ethereum gas refund. Now `reserved` shares a slot with `released`, which is usually non-zero, so the refund is lost. It is still 5.2% cheaper than the baseline overall.
- Value limits: `uint128` amounts (up to 3.4 × 10³⁸ units), `uint96` campaign ids, and `uint40` timestamps (valid until the year 36,812). All are far beyond realistic use, and overflowing amounts revert because of `SafeCast`.
- Readability: struct order now follows storage layout, not logic. This is documented with slot comments in each struct.

### Optimization 3: CID hash in storage, full CID in the event

**What:** `Campaign.metadataCID` and `Milestone.evidenceCID` (strings) were replaced by `metadataHash` / `evidenceHash` (`bytes32` = `keccak256` of the CID). The full CID is still published in `CampaignCreated` and `MilestoneSubmitted`.

**Why it saves gas:** an IPFS CID is about 59 characters. As a storage string that is 3 slots (length + 2 data slots), about 66,000 gas. A `bytes32` hash is one slot. Event data costs about 8 gas per byte, so publishing the CID in the event costs a few hundred gas.

**Measured:** createCampaign −44,781 and submitMilestone −44,764 relative to step 2. Deployment of ProjectRegistry and MilestoneDisbursement also became cheaper (−9.2% and −9.0%), because no string-handling code is needed.

**Trade-offs:**
- **Reading:** the CID can no longer be read with a simple `view` call. The frontend and backend read it from event logs, which the backend indexer (Phase 6) does anyway.
- **Integrity is unchanged:** the stored hash fixes the CID permanently. Anyone can hash the CID from the event and compare it with storage (tested in `test/Security.test.js`, S6).
- **Contracts cannot read the CID.** No contract needs it, so nothing is lost.

## 5. Not done, and why

| Idea | Why not |
|---|---|
| Remove the vault's own eligibility re-checks | Would save about 5,000–10,000 gas per payout, but removes the defence-in-depth protection (security over gas) |
| Pack `Beneficiary` (bytes32 + status) | A `bytes32` fills a whole slot, so there is nothing to pack with it |
| Combine the role and pause checks into one external call | Small saving (one warm call per transaction) for a less readable base contract |
| Emit-only campaigns (no storage at all) | The vault and milestone contract must read campaign status and owner on-chain |

## 6. Reproduce

```bash
npm install
npm run gas        # prints the table and writes docs/gas-results.md / .json
npm run test:gas   # alternative view: hardhat-gas-reporter per-method averages over the test suite
```
