# GiveChain Frontend

React (Vite) + ethers.js website for GiveChain. Users connect MetaMask and sign every transaction themselves; the site only reads from the backend's index and the blockchain.

## Run it

From the project root, with the chain, contracts and backend running (see [docs/DEMO.md](../docs/DEMO.md)):

```bash
npm run frontend:install   # once
npm run frontend           # http://localhost:5173
```

The dev server forwards `/api` to the backend (port 4000) and `/rpc` to the local chain (port 8545).

## Pages

| Page | What it shows |
|---|---|
| `/` | How GiveChain works, live totals, all campaigns |
| `/campaigns/:id` | Campaign details from IPFS (verified against the CID), funding progress, donate, refund claim, payment requests with full timelines and evidence, registered people (wallet + status only), donations |
| `/dashboard` | One tab per role the connected wallet holds **on-chain** |
| `/transparency` | System totals, an independent check of the vault's real token balance, and the full on-chain activity feed |

### Dashboard tabs

| Tab | Shown when | Actions |
|---|---|---|
| NGO | wallet has `NGO_ROLE` | Create campaign (details uploaded to IPFS), register people (identity commitment computed in the browser), request payments with an evidence upload, release approved payments, complete or cancel a campaign (warns about unpaid approvals) |
| Auditor | wallet has `AUDITOR_ROLE` | Approve or revoke people, approve or reject payment requests after viewing the evidence, cancel approved payments |
| Admin | wallet has the admin or pauser role | Pause or unpause the whole system, grant or revoke roles |
| Beneficiary | always (first if the wallet is registered) | Eligibility per campaign, payments in progress, payments received, confirm receipt |
| Donor | always | Wallet balance and faucet, campaigns supported, refunds, transaction history |

## How transactions are shown

Every write goes through one transaction runner (`src/context/TxContext.jsx`), which shows each step in a notification:

1. **Confirm in wallet:** waiting for the user's signature.
2. **Pending:** sent, with the transaction hash.
3. **Confirmed:** only after the receipt arrives with status success, with the block number.
4. **Rejected / Failed:** the user declined, or the contract refused. Custom contract errors are decoded into plain English (`src/lib/errors.js`), for example "This wallet is already registered in this campaign."

After confirmation the page waits for the backend to index that block, then refreshes, so lists never show stale data.

## Wallets

- **MetaMask:** the normal way. The site asks MetaMask to switch to (or add) the GiveChain network.
- **Demo accounts (local chain only):** the wallet menu lists the local Hardhat node's built-in test accounts, so a demo can switch between Admin, NGO, Auditor, Donor and Beneficiary in one click. They are unlocked by the local node itself; the website stores no private keys. This option only appears on chain 31337.

The site remembers the connected wallet across reloads. For MetaMask it uses `eth_accounts`, which never opens a pop-up.

## Privacy

Beneficiary national ID numbers are typed into the NGO form but never leave the browser. Only `keccak256(salt, ID)` is sent on-chain, and the NGO is shown the random salt to keep with its own records.

## Build

```bash
npm --prefix frontend run build   # outputs frontend/dist
```
