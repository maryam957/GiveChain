# GiveChain Backend

The off-chain part of GiveChain. It does three things:

1. **IPFS storage:** stores evidence files and campaign details and returns their content address (CID). Files are always kept in a local content-addressed store, so the demo works offline. If `PINATA_JWT` is set, they are also pinned to the public IPFS network.
2. **Event indexer:** reads every event the GiveChain contracts emit and builds a searchable index of campaigns, beneficiaries, milestones, donations, payouts and refunds.
3. **REST API:** serves that index and the IPFS files to the frontend.

The backend **cannot change the blockchain** and holds no keys. Every money action is a transaction the user signs in MetaMask.

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

Known limitation: upload endpoints have no login or rate limit. That is acceptable for a local prototype, but not for a public deployment.

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
| POST | `/api/ipfs` | Upload one file (multipart field `file`) and get `{ cid, size, contentType, pinned }` |
| POST | `/api/ipfs/json` | Store campaign details (JSON with a required `title`) and get `{ cid }` |
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
npm run backend:test   # IPFS service (16 tests)
npm test               # includes test/backend/Indexer.test.js: indexer vs. real contracts, and the API (18 tests)
```

The Pinata upload path is implemented but has **not been tested with a real Pinata account**. Local mode is fully tested.
