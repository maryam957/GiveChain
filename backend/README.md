# GiveChain Backend

The off-chain part of GiveChain. It does three things:

1. **IPFS storage:** stores evidence files and campaign details and returns their content address (CID). Files are always kept in a local content-addressed store, so the demo works offline. If `PINATA_JWT` is set, they are also pinned to the public IPFS network.
2. **Event indexer:** reads every event the GiveChain contracts emit and builds a searchable index of campaigns, beneficiaries, milestones, donations, payouts and refunds.
3. **REST API:** serves that index and the IPFS files to the frontend.

4. **User accounts:** email + password logins, profiles, wallet linking, NGO and verifier applications, and beneficiary applications to campaigns.

The backend **cannot change the blockchain** and holds no keys. Every money action is a transaction the user signs in MetaMask.

## Accounts and trust

| What | How |
|---|---|
| Passwords | Stored only as scrypt hashes with a random salt; never logged or returned |
| Sessions | Random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production); only its SHA-256 hash is stored; 7-day expiry; changing the password ends all other sessions |
| Login abuse | 10 failed attempts per email or IP per 15 minutes, then HTTP 429; the same error message for an unknown email and a wrong password |
| Wallet linking | The server issues a one-time message (10-minute expiry); the user signs it in MetaMask; the server checks the signature with `ethers.verifyMessage`. One wallet can belong to only one account |
| Roles | **Never decided by the database.** An NGO or verifier application counts as approved only when the user's linked wallet holds the role on-chain (read from the event index). Admin endpoints require the admin account **and** the on-chain admin role |
| Beneficiary applications | Personal details (name, ID number, phone, reason) are visible only to that campaign's NGO and to verifiers, and are never written on-chain. An application shows as "registered" only once the wallet is registered on-chain |
| Public names | `/api/profiles` returns names only for NGO, verifier and admin wallets; donor and beneficiary names are never public |
| Uploads | IPFS uploads require a logged-in account |
| Storage | `backend/data/accounts.json` (not committed), written atomically. For production, replace it with a real database (e.g. PostgreSQL) and encrypt personal data at rest |

**Demo accounts:** on a local chain (31337), the backend creates the accounts listed in `backend/demo-users.json` the first time it sees the deployment. See [docs/DEMO.md](../docs/DEMO.md).

## Run it

From the project root:

```bash
npm run backend:install   # once
npm run node              # terminal 1: local blockchain
npm run deploy:local      # terminal 2
npm run seed:local        # terminal 2 (optional demo data)
npm run backend           # terminal 3: http://localhost:4000
```

The backend can start before the contracts are deployed; it waits for `deployments/localhost.json`. If you restart the chain or redeploy, it rebuilds its index automatically.

## Trust and failure handling

| Concern | How it is handled |
|---|---|
| Index is wrong or lost | The index is held in memory and built only from on-chain events. It is rebuilt from the deployment block on every start, and whenever the chain restarts or the contracts are redeployed. The contracts stay the source of truth; the frontend reads balances and roles on-chain before any action. |
| Chain unreachable | The API keeps serving the last index; `/api/health` shows `chainError`. Indexing resumes automatically. |
| File changed after upload | Every file is re-hashed when read and compared with its CID. A mismatch is never served (HTTP 502). Gateway downloads are checked the same way. |
| IPFS truthfulness | A matching CID proves the file is unchanged since submission. It does not prove the content is true; that is the auditor's job. |
| Malicious uploads | Only PDF, PNG, JPEG, plain text and JSON, up to 5 MB. Files are served with `X-Content-Type-Options: nosniff`. CIDs are parsed before use, so paths like `../` are rejected. |
| Personal data | Campaign details are limited to fixed fields (title, summary, description, category, location, organisation). Beneficiary identity never passes through the backend. |

Known limitations: there is no email verification or password reset by email, and uploads are not rate-limited per user. Personal data in `accounts.json` is not encrypted at rest. These are acceptable for a local prototype, but not for a public deployment.

**Why in-memory instead of SQLite:** the index is a disposable copy of on-chain data, and a demo chain has only a few hundred events, so rebuilding takes well under a second. Skipping a database removes a native dependency and makes "the index can always be rebuilt from the chain" literally true on every start.

## API

All amounts are strings in token units (MockUSDC has 6 decimals: `"1500000000"` = 1,500 mUSDC). Addresses are checksummed.

| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | Indexed block, IPFS mode, chain errors |
| GET | `/api/config` | Network, chain id, contract addresses and ABIs, upload limits |
| GET | `/api/stats` | Transparency totals: donated, reserved, released, refunded, held, campaign counts, donors, beneficiaries approved and assisted |
| GET | `/api/campaigns?status=&ngo=` | Campaign list with amounts and IPFS details (`metadata`, `metadataVerified`) |
| GET | `/api/campaigns/:id` | One campaign with beneficiaries, donors, milestones, donations, payouts and refunds |
| GET | `/api/milestones?campaignId=&status=&beneficiary=` | Milestones with full status history |
| GET | `/api/milestones/:id` | One milestone |
| GET | `/api/donors/:address` | A donor's donations, refunds and campaigns |
| GET | `/api/beneficiaries/:address` | A beneficiary's registrations, milestones and payouts |
| GET | `/api/roles/:address` | Roles from the index (the frontend confirms on-chain) |
| GET | `/api/activity?campaignId=&address=&limit=` | Event feed, newest first, with transaction hashes |
| POST | `/api/ipfs` | Upload one file (multipart field `file`) and get `{ cid, size, contentType, pinned }`. Login required |
| POST | `/api/ipfs/json` | Store campaign details (JSON with a required `title`) and get `{ cid }`. Login required |
| POST | `/api/auth/signup` | Create an account (`donor`, `beneficiary`, `ngo`, `verifier`; NGOs and verifiers include `organisation`) |
| POST | `/api/auth/login`, `/api/auth/logout` | Start or end a session |
| GET | `/api/auth/me` | The logged-in user, with on-chain roles and application status |
| PATCH | `/api/auth/profile` · POST `/api/auth/password` | Update name and phone; change the password |
| POST | `/api/auth/wallet/challenge` → `/api/auth/wallet/link` | Get a message to sign, then link the wallet with the signature |
| POST | `/api/auth/role-application` | Re-apply after a rejection |
| GET | `/api/profiles` | Public names for organisation wallets |
| GET | `/api/admin/role-applications?status=` · POST `.../:id/reject` | Admin: review NGO and verifier applications |
| GET | `/api/admin/users` | Admin: every account with its on-chain roles |
| POST / GET | `/api/campaigns/:id/applications` | Beneficiary applies; the campaign's NGO and verifiers list applications |
| GET | `/api/my/applications` | A beneficiary's own applications |
| POST | `/api/beneficiary-applications/:id/decline` | The campaign's NGO declines an application |
| GET | `/api/ipfs/:cid` | The file, with headers `X-Content-Verified` and `X-Content-Source` |

## Configuration

Optional, in the project root `.env`:

| Variable | Default |
|---|---|
| `BACKEND_PORT` | `4000` |
| `RPC_URL` | `http://127.0.0.1:8545` |
| `GIVECHAIN_NETWORK` | `localhost` (reads `deployments/<network>.json`) |
| `PINATA_JWT` | empty = local IPFS store only |
| `IPFS_GATEWAY` | `https://gateway.pinata.cloud` |
| `CORS_ORIGIN` | `http://localhost:5173` (the frontend) |

## Tests

```bash
npm run backend:test   # IPFS service and accounts (34 tests)
npm test               # includes test/backend/Indexer.test.js: indexer vs. real contracts, and the API (18 tests)
```

The Pinata upload path is implemented but has **not been tested with a real Pinata account**. Local mode is fully tested.
