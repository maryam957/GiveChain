// Computes a real IPFS CID (CIDv1, raw codec, sha2-256) for a file's bytes.
//
// This is the CID IPFS gives a small file added with raw leaves
// (`ipfs add --cid-version=1 --raw-leaves`). The backend uses the same function for
// its local IPFS fallback store, so demo data works offline and the CIDs are genuine
// content addresses: change one byte of the file and the CID changes.

async function cidForBytes(bytes) {
    const { CID } = await import("multiformats/cid");
    const raw = await import("multiformats/codecs/raw");
    const { sha256 } = await import("multiformats/hashes/sha2");
    const digest = await sha256.digest(bytes);
    return CID.create(1, raw.code, digest).toString();
}

module.exports = { cidForBytes };
