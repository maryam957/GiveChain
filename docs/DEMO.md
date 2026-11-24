# GiveChain Local Demo

How to run GiveChain locally (blockchain, backend and website) with demo data, and a suggested demo script.

## 1. Start everything

Use four terminals in the project folder.

**Terminal 1** (keep it running):

```bash
npm run node
```

**Terminal 2:**

```bash
npm run deploy:local
npm run seed:local
```

`deploy:local` writes `deployments/localhost.json` (addresses, ABIs, roles). The backend and frontend read this file. `seed:local` writes `deployments/localhost.seed.json`.

**Terminal 3** (keep it running):

```bash
npm run backend
```

The backend indexes the chain and serves the API at `http://localhost:4000` (try `http://localhost:4000/api/stats`). It follows chain restarts and redeploys by itself.

**Terminal 4** (keep it running):

```bash
npm run frontend
```

Open **http://localhost:5173**. Connect with MetaMask, or pick a demo account from the wallet menu (local chain only; no keys needed).

Stopping terminal 1 wipes the chain. After a restart, run both commands again.

## 2. Demo accounts

These are Hardhat's built-in **test** accounts. They are the same on every computer, and their keys are public, so never send real money to them. `npm run node` prints each account's private key; import the ones you need into MetaMask.

| Account # | Address | Role in the demo |
|---|---|---|
| 0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | Admin + Pauser |
| 1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | NGO 1 (Demo Relief Foundation) |
| 2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | NGO 2 (Demo Learning Trust) |
| 3 | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | Auditor |
| 4 | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` | Donor A |
| 5 | `0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc` | Donor B |
| 6 | `0x976EA74026E726554dB657fA54763abd0C3a0aa9` | Beneficiary 1 |
| 7 | `0x14dC79964da2C08b23698B3D3cc7Ca32193d9955` | Beneficiary 2 |
| 8 | `0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f` | Beneficiary 3 |
| 9 | `0xa0Ee7A142d267C1f36714E4a8F75612F20a79720` | Beneficiary 4 |

### MetaMask network settings

| Field | Value |
|---|---|
| Network name | GiveChain Local |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency symbol | `ETH` |

After restarting the local chain, MetaMask may show "nonce too high" errors. Fix: MetaMask → Settings → Advanced → **Clear activity tab data**, for each imported account.

## 3. What the seed creates

All content is fictional (see `seed-data/`). Evidence and campaign details are real files with real IPFS CIDs.

| Campaign | NGO | State after seeding | Ready for these demo steps |
|---|---|---|---|
| 1. Winter Food Packages (target 5,000) | NGO 1 | Active. 2,500 donated (A 1,500, B 1,000). Beneficiaries 1–3 approved. Milestone 1: 300 paid to beneficiary 1, receipt confirmed. Milestone 2: 200 approved, **waiting for NGO release**. Milestone 3: 250 submitted, **waiting for auditor**. | Auditor approves or rejects milestone 3; NGO 1 releases milestone 2; beneficiary 2 confirms receipt; anyone donates |
| 2. School Books Drive (target 2,000) | NGO 2 | Active. 500 donated (B). Beneficiary 4 **registered, waiting for auditor**. | Auditor approves beneficiary 4; NGO 2 submits a milestone |
| 3. Clean Water Pilot (target 1,000) | NGO 1 | **Cancelled**. 300 donated (A). | Donor A claims a 300 refund |

Expected balances after seeding: campaign 1 holds 2,200 (2,000 available, 200 reserved), campaign 2 holds 500, campaign 3 holds 300 (refundable). Beneficiary 1 holds 300 mUSDC.

## 4. Deploying elsewhere (optional)

For a public testnet such as Sepolia, fill in `.env` (see `.env.example`): `SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY` (a throwaway test wallet only), and `NGO_ADDRESSES` / `AUDITOR_ADDRESSES` (comma-separated). Then:

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

The seed script is for local chains only.

## 5. Suggested live demo script (about 8 minutes)

Each step uses a different demo account from the wallet menu, so each team member can drive one role.

| # | Account | Do this | What it proves |
|---|---|---|---|
| 1 | (none) | Home page, then **Transparency**: point at "Independent check ✓ matches" | Anyone can verify the totals against the chain |
| 2 | Donor B | Open *Winter Food Packages*, donate 100 | Wallet transaction with Confirm in wallet → Pending → Confirmed |
| 3 | Auditor | Dashboard → open the evidence of payment #3, then **Approve and reserve money** | Independent approval; evidence is an IPFS file verified against its CID |
| 4 | NGO 1 | Dashboard → **Release payment** #2 | Money goes from the vault straight to the beneficiary, never to the NGO |
| 5 | Beneficiary 2 | Dashboard → **Confirm I received it** | Beneficiary confirmation closes the loop |
| 6 | NGO 1 | Try to register Beneficiary 1's wallet again | **Security failure, shown live:** "This wallet is already registered in this campaign" |
| 7 | Donor A | Open *Clean Water Pilot* → **Claim 300** | Refunds from a cancelled campaign |
| 8 | Admin | Dashboard → **Pause everything** | Red banner on every page; all transactions blocked. Then unpause. |
| 9 | (terminal) | `npx hardhat test test/Security.test.js` | The reentrancy attack that steals from the vulnerable vault but fails against GiveChain |

With MetaMask instead of demo accounts: import the matching Hardhat keys (printed by `npm run node`) and switch accounts in MetaMask between steps.
