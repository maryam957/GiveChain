# Contribution Matrix (draft)

> **Team: complete this file together.** It is pre-filled only with facts the git history proves. Replace every `TODO`, add any team members not listed, and make sure every member agrees with it. The rubric awards 10 marks individually, based on documented contributions and on each member explaining their own work in the viva.

## Evidence from the repository

| Commit | Author | Date | Content |
|---|---|---|---|
| `e065c02` | maryam957 | 2026-11-16 | Hardhat environment and accounts |
| `6dcd192` | maryam957 | 2026-11-23 | First prototype contracts (ETH vault, registry, milestones) and tests |
| `14ab144` | maryam957 | 2026-11-23 | First gas benchmarks, security and deployment docs (prototype now in `legacy/`) |
| `286e5f0` | waleedahmadzai | 2026-11-24 | Phase 0: clean-up and tooling |
| `4472063` | waleedahmadzai | 2026-11-24 | Phase 1: architecture design and interfaces |
| `a4b9141` … `e7135c0` | waleedahmadzai | 2026-11-24 | Phase 2: rebuilt contracts (access, registry, vault, milestones) and tests |
| `d8e4021` | waleedahmadzai | 2026-11-24 | Phase 3: security scenarios and security package |
| `5effe98` | waleedahmadzai | 2026-11-24 | Phase 4: gas optimizations and benchmark |
| `224a3a7` | waleedahmadzai | 2026-11-24 | Phase 5: deploy and seed scripts |
| `730b58c` | waleedahmadzai | 2026-11-24 | Phase 6: backend (IPFS, indexer, API) |
| `4db09d6` | waleedahmadzai | 2026-11-24 | Phase 7: frontend |

Commits from Phase 0 onward were produced with an AI coding assistant (see REPORT §12) and carry a `Co-Authored-By` line saying so.

## Matrix

| Member | Owned work / packages | Evidence (commits / tests / demo) | Effort and justification |
|---|---|---|---|
| Maryam (`maryam957`) | First prototype: project setup, initial contracts with an inherited access-control base, first test suite (47 tests), first security and gas documents. TODO: add design, report or demo work | `e065c02`, `6dcd192`, `14ab144`; `legacy/` | TODO |
| Waleed (`waleedahmadzai`) | Design review and redesign (Phases 0–7): architecture, contracts rebuild, security scenarios, gas benchmark, deployment, backend, frontend. TODO: adjust to what you personally did vs. AI-generated | `286e5f0` → `4db09d6`; 254 tests | TODO |
| TODO: other members | TODO | TODO | TODO |

## Balance: needs attention

The course says: *"Do not assign all security or integration work to one person without a reasoned explanation. Shared tasks should identify each member's distinct contribution."* Right now the history shows almost all of the final system committed by one member. Before submission, the team should agree a fair, **true** division. For example, split the remaining work and the viva ownership:

| Remaining task | Suggested owner |
|---|---|
| Review and present the security package and the reentrancy demo (builds on the first prototype's security work) | TODO |
| Review and present the gas sheet | TODO |
| Test the full demo with MetaMask; drive demo steps per role (DEMO.md §5) | TODO (one role per member) |
| Finish REPORT.md (section 12, figures, export) | TODO |
| Review and present backend / IPFS | TODO |
| Review and present frontend | TODO |

Record only work that was actually done. Each member should be able to walk through their part's code and tests without help, because that is what the individual marks assess.
