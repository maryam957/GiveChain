# Rubric Evidence Checklist

Each row of the course rubric (Blockchain Empowerment Project, section 6), with where the evidence is. ✅ = done and verified; ⚠️ = needs team action.

| # | Criterion (marks) | Evidence | Status |
|---|---|---|---|
| 1 | **Use case and blockchain justification** (10) | [REPORT §1–3](REPORT.md): problem, why blockchain, what stays off-chain, six workflows | ✅ |
| 2 | **Architectural complexity and workflows** (15) | [ARCHITECTURE.md](ARCHITECTURE.md): 4 on-chain roles + donor/beneficiary, three state machines (campaign, beneficiary, milestone), reservation accounting, trust boundaries. Demo steps 2–8 in [DEMO.md](DEMO.md) | ✅ |
| 3 | **Multiple contracts and inheritance** (10) | 5 contracts + abstract base + 3 interfaces ([REPORT §4](REPORT.md)). `ProjectRegistry`, `DonationVault` and `MilestoneDisbursement` inherit `AccessControlBase`; interfaces for every cross-contract call; inheritance diagram in [ARCHITECTURE §2](ARCHITECTURE.md) | ✅ |
| 4 | **On-chain/off-chain integration** (10) | Backend IPFS store + event indexer + API ([backend/README.md](../backend/README.md)); data map in [ARCHITECTURE §6](ARCHITECTURE.md); tamper test in `backend/test/ipfs.test.js`; index-equals-chain tests in `test/backend/Indexer.test.js`; live "Independent check" on the Transparency page | ✅ |
| 5 | **Gas measurement and optimization** (10) | [GiveChain-Gas-Sheet.md](GiveChain-Gas-Sheet.md): 13 operations (≥3 required), 3 optimizations (≥2 required), baseline vs optimized under identical conditions, per-step contributions, trade-offs including measured regressions; `npm run gas` | ✅ |
| 6 | **Smart-contract security** (15) | [GiveChain-Security-Package.md](GiveChain-Security-Package.md): threat model, 14 controls, threat → mitigation → test tables; `test/Security.test.js` (32 tests): S1–S8 + 5 project-specific misuse scenarios (≥2 required), reentrancy with a control test | ✅ |
| 7 | **Frontend and system integration** (10) | [frontend/README.md](../frontend/README.md): MetaMask, role-dependent dashboards, transaction states (pending / confirmed / rejected / failed), decoded errors, IPFS evidence upload and verified display. Browser-tested on a live local chain | ⚠️ Test MetaMask in your own browser once before the demo |
| 8 | **Testing, deployment and demo** (5) | 272 automated tests, all passing (normal, boundary and failure cases); `scripts/deploy.js` + `scripts/seed.js`; fresh-clone run verified; 9-step demo script in [DEMO.md §5](DEMO.md) | ⚠️ Rehearse the demo |
| 9 | **Report and technical evidence** (5) | [REPORT.md](REPORT.md) draft; diagrams in ARCHITECTURE.md (Mermaid, rendered by GitHub) | ⚠️ Finish section 12 (AI-use statement), export to the required format, and turn the Mermaid diagrams into images if the report is submitted as PDF/Word |
| 10 | **Work distribution and individual defense** (10) | [CONTRIBUTIONS.md](CONTRIBUTIONS.md) draft, evidenced by git commits | ⚠️ Team must complete and agree the matrix; every member must be able to explain their part |

## Required deliverables (course section 4)

| Deliverable | Where | Status |
|---|---|---|
| Source repository: frontend, contracts, off-chain code, tests, deployment scripts, README | This repository | ✅ |
| Architecture package: component diagram, contract interaction/inheritance diagram, trust boundaries, data map | [ARCHITECTURE.md](ARCHITECTURE.md) §1, §2, §6, §7 | ✅ |
| Gas-evaluation sheet | [GiveChain-Gas-Sheet.md](GiveChain-Gas-Sheet.md), [gas-results.md](gas-results.md) | ✅ |
| Security package: threat model, mitigation mapping, test evidence, known limitations | [GiveChain-Security-Package.md](GiveChain-Security-Package.md) | ✅ |
| Technical report | [REPORT.md](REPORT.md) | ⚠️ Draft; see row 9 |
| Live demonstration with a security failure test and questions for each member | [DEMO.md §5](DEMO.md) (step 6 shows a live failure; step 9 runs the reentrancy attack) | ⚠️ Rehearse |

## Before submitting

- [ ] Merge the work into `main`, or agree with the team which branch is submitted.
- [ ] Complete REPORT §12 (AI use) according to your course and institution policy.
- [ ] Complete and agree CONTRIBUTIONS.md.
- [ ] Connect MetaMask once and run the demo script end to end.
- [ ] Each member reads the parts of the code credited to them and can explain them.
- [ ] Never commit `.env` or private keys (already blocked by `.gitignore`).
