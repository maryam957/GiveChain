# GiveChain Frontend

React (Vite) + ethers.js website for GiveChain. People log in with an email and password, and every action that involves money is signed by their own MetaMask wallet. The site never holds private keys.

## Run it

From the project root, with the chain, contracts and backend running (see [docs/DEMO.md](../docs/DEMO.md)):

```bash
npm run frontend:install   # once
npm run frontend           # http://localhost:5173
```

The dev server forwards `/api` to the backend (port 4000) and `/rpc` to the local chain (port 8545), so the session cookie stays same-origin.

## Structure

**Public pages**

| Page | What it shows |
|---|---|
| `/` | What GiveChain is, live totals, active campaigns |
| `/campaigns` | All campaigns with status filter and search |
| `/campaigns/:id` | Details from IPFS (verified against the CID), funding, payments with full timelines and evidence, people helped (wallet + status only), **Donate**, **Apply for help** (beneficiaries), **Claim refund** (closed campaigns) |
| `/transparency` | System totals, an independent check of the vault's real token balance, and the full on-chain activity feed |
| `/how-it-works` | Every role explained step by step, and what is stored where |
| `/login`, `/signup` | Sign-up starts by choosing Donor, Beneficiary, NGO or Verifier; NGOs and verifiers add their organisation's details |

**Portal (`/app`, after login).** A sidebar shows only that account type's pages.

| Account | Pages |
|---|---|
| All | **Overview** (setup checklist and to-do list), **Profile and wallet** (link MetaMask, balances, details, password, application status) |
| Admin | **Applications** (approve = grant the role on-chain, or reject with a reason), **People and roles** (every account with on-chain roles; remove roles), **System** (emergency pause, contract addresses) |
| NGO | **My campaigns** (create), and per campaign: **Applicants** (select → registered on-chain, or decline), **People** (registered beneficiaries, add someone directly), **Payments** (request with an evidence upload, release approved ones), **Close** |
| Verifier | **Review queue**: people to approve (with their application details), payments to review (open the evidence, then approve or reject), approved but unpaid payments (cancel), all approved people (revoke) |
| Donor | **My donations**: balance and faucet, campaigns supported, refunds, history |
| Beneficiary | **My assistance**: applications and eligibility, payments received (confirm receipt), payments in progress |

NGO and verifier tools appear only after the admin has granted the role **on the blockchain**. Until then the portal shows where the application stands.

## Wallet safety

- `WalletGate` (`src/components/Wallet.jsx`) sits in front of every action and explains exactly what is missing: MetaMask not installed, wallet not linked, MetaMask not connected, **wrong MetaMask account** (not the wallet linked to this login), or wrong network.
- The transaction runner (`src/context/TxContext.jsx`) also refuses to send if MetaMask is on a different wallet than the logged-in account's.
- Linking a wallet means signing a one-time message; the server verifies the signature.

## How transactions are shown

1. **Confirm in MetaMask:** waiting for the user's signature.
2. **Pending:** sent, with the transaction hash.
3. **Confirmed:** only after the receipt arrives with status success, with the block number.
4. **Rejected / Failed:** the user declined, or the contract refused. Custom contract errors are decoded into plain English (`src/lib/errors.js`).

After confirmation the page waits for the backend to index that block, then refreshes.

## Privacy: beneficiary IDs

The NGO's private hashing key comes from its wallet signing a fixed message (`src/lib/identity.js`). Signatures are deterministic, so the same ID always gives the same fingerprint, and the contract can reject the same person registered twice, even under a different wallet or with different spacing. The key is never stored or sent anywhere, and the ID number itself never goes on-chain.

## Build

```bash
npm run frontend:build   # outputs frontend/dist
```
