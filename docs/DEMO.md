# GiveChain Local Demo

How to run GiveChain on your own computer (blockchain, backend and website) with demo accounts and data, plus a suggested live demo script.

## 1. Start everything

Use four terminals in the project folder.

**Terminal 1** (keep it running): the local blockchain

```bash
npm run node
```

**Terminal 2:** deploy the contracts and add demo data

```bash
npm run deploy:local
npm run seed:local
```

**Terminal 3** (keep it running): the backend

```bash
npm run backend
```

On a local chain, the backend creates the demo accounts below the first time it starts (it stores them in `backend/data/accounts.json`).

**Terminal 4** (keep it running): the website

```bash
npm run frontend
```

Open **http://localhost:5173**.

Stopping terminal 1 wipes the blockchain. After a restart, run terminal 2's commands again; the backend follows automatically. Accounts and passwords are kept.

## 2. Logins and wallets

Every person has their own account: **email + password** to log in, plus a **MetaMask wallet** that signs their transactions. Each demo account is already linked to one of Hardhat's built-in test wallets.

**Password for every demo account:** see the `password` field in [`backend/demo-users.json`](../backend/demo-users.json). These are local test logins only; never reuse them anywhere real.

| Email | Who | Hardhat account # | State after seeding |
|---|---|---|---|
| `admin@givechain.test` | GiveChain Admin | 0 | Admin and pauser on-chain |
| `ngo1@givechain.test` | Sara Malik, Demo Relief Foundation | 1 | Approved NGO; runs *Winter Food Packages* and *Clean Water Pilot* |
| `ngo2@givechain.test` | Omar Khan, Demo Learning Trust | 2 | Approved NGO; runs *School Books Drive* |
| `verifier@givechain.test` | Ayesha Raza, Demo Audit Partners | 3 | Approved verifier |
| `donor.a@givechain.test` | Donor A | 4 | Donated to campaigns 1 and 3 |
| `donor.b@givechain.test` | Donor B | 5 | Donated to campaigns 1 and 2 |
| `beneficiary1@givechain.test` … `beneficiary4@givechain.test` | Beneficiaries 1–4 | 6–9 | Registered in campaigns 1 and 2 |
| `ngo3@givechain.test` | Bilal Ahmed, Demo Health Network | 10 | **Applied to be an NGO, waiting for the admin** |
| `beneficiary5@givechain.test` | Beneficiary Five | 11 | **Applied for help in campaign 1, waiting for NGO 1** |

You can also click **Sign up** to create a brand-new account of any type.

### Set up MetaMask (once)

1. Install MetaMask in Chrome or Firefox.
2. Add the network (MetaMask → Networks → Add network manually):

   | Field | Value |
   |---|---|
   | Network name | GiveChain Local |
   | RPC URL | `http://127.0.0.1:8545` |
   | Chain ID | `31337` |
   | Currency symbol | `ETH` |

3. Import the test wallets you want to use: **Account icon → Add account or hardware wallet → Import account**, and paste the private key that `npm run node` prints for that account number. The table above shows which account belongs to which login. Name each one (for example "GiveChain NGO 1") so switching is easy.
4. When you log in on the website, switch MetaMask to that person's wallet. If the wrong wallet is selected, the website says so and blocks the action.

These test keys are public knowledge. Never send real money to them.

**After restarting the chain:** MetaMask may show "nonce too high". Fix: MetaMask → Settings → Advanced → **Clear activity tab data**.

### A brand-new user with a new wallet

1. In MetaMask, **Add account → Create account**. This makes a fresh, real address with 0 ETH.
2. Give it test ETH for fees: switch to an imported test account (for example account #0) and **Send** 1 ETH to the new address.
3. On the website, **Sign up**, then **Profile and wallet → Connect and link MetaMask**, and sign the message. Signing proves you own the wallet and costs nothing.
4. NGOs and verifiers then wait for the admin to approve them. Donors and beneficiaries can start straight away.

### Check anything directly on the blockchain

```bash
npm run inspect                 # system overview: every campaign and its money
npm run inspect -- 0xWALLET     # one wallet: ETH, mUSDC, on-chain roles, campaigns, payments
```

This reads the contracts directly, with no backend or website involved.

## 3. What the seed creates

All content is fictional (see `seed-data/`). Evidence and campaign details are real files with real IPFS CIDs.

| Campaign | NGO | State after seeding | Ready for these demo steps |
|---|---|---|---|
| 1. Winter Food Packages (target 5,000) | NGO 1 | Active. 2,500 donated (A 1,500, B 1,000). Beneficiaries 1–3 approved. Payment 1: 300 paid to beneficiary 1, confirmed. Payment 2: 200 approved, **waiting for NGO release**. Payment 3: 250 submitted, **waiting for a verifier**. Beneficiary Five **has applied**. | NGO 1 selects Beneficiary Five; verifier approves them and payment 3; NGO 1 releases payment 2; beneficiary 2 confirms |
| 2. School Books Drive (target 2,000) | NGO 2 | Active. 500 donated (B). Beneficiary 4 **registered, waiting for a verifier**. | Verifier approves beneficiary 4; NGO 2 requests a payment |
| 3. Clean Water Pilot (target 1,000) | NGO 1 | **Cancelled**. 300 donated (A). | Donor A claims a 300 refund |

Plus: **Demo Health Network** (ngo3) is waiting for the admin's approval.

## 4. Suggested live demo script (about 10 minutes)

Each step is one person's login, so each team member can drive one role.

| # | Log in as | Do this | What it proves |
|---|---|---|---|
| 1 | (nobody) | Home page → **Transparency**: point at "Independent check ✓ matches" | Anyone can verify the totals against the chain |
| 2 | admin | **Applications** → approve *Demo Health Network* | A new NGO joins; the role is granted on the blockchain |
| 3 | ngo1 | **My campaigns → Winter Food Packages → Applicants** → select Beneficiary Five | NGO picks who to help; the ID becomes a private fingerprint |
| 4 | verifier | **Review queue** → approve Beneficiary Five, then **Payments to review** → open evidence → approve payment 3 | Independent checks, recorded on-chain |
| 5 | donor.b | Open *Winter Food Packages* → donate 100 | Confirm in MetaMask → Pending → Confirmed |
| 6 | ngo1 | **Payments** → **Release payment** | Money goes from the vault straight to the beneficiary, never to the NGO |
| 7 | beneficiary2 | **My assistance** → **Yes, I received it** | The beneficiary closes the loop |
| 8 | ngo1 | **People → Add a person directly** with Beneficiary Five's ID (`DEMO-ID-0005`) and another wallet | **Security failure, shown live:** "This person is already registered in this campaign (same ID)" |
| 9 | donor.a | Open *Clean Water Pilot* → **Claim 300** | Refunds from a cancelled campaign |
| 10 | admin | **System → Pause everything**, then unpause | Red banner on every page; every transaction blocked |
| 11 | (terminal) | `npx hardhat test test/Security.test.js` | The reentrancy attack that steals from a vulnerable vault but fails against GiveChain |
| 12 | (terminal) | `npm run inspect -- <beneficiary wallet>` | The same facts, read straight from the contracts |

## 5. Deploying elsewhere (optional)

For a public testnet such as Sepolia, fill in `.env` (see `.env.example`): `SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY` (a throwaway test wallet only), and `NGO_ADDRESSES` / `AUDITOR_ADDRESSES` (comma-separated). Then:

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

The seed script and demo accounts are for local chains only.
