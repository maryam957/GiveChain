# Demo seed data

Fictional campaign details and evidence files used by `scripts/seed.js` to fill a local chain with demo data. No real people, organisations or places.

The seed script computes each file's real IPFS CID (CIDv1, raw, sha2-256) and records it on-chain. The backend's local IPFS store serves the same files, so the demo works offline.
