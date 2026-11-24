// IPFS CID helpers. Same algorithm as scripts/lib/cid.js (CIDv1, raw codec, sha2-256),
// so files added by the seed script and by this backend get identical CIDs.

let mf; // multiformats is ESM-only, so it is loaded once with dynamic import.
async function lib() {
    if (!mf) {
        const [{ CID }, raw, { sha256 }] = await Promise.all([
            import("multiformats/cid"),
            import("multiformats/codecs/raw"),
            import("multiformats/hashes/sha2"),
        ]);
        mf = { CID, raw, sha256 };
    }
    return mf;
}

/** CID for a file's bytes. */
async function cidForBytes(bytes) {
    const { CID, raw, sha256 } = await lib();
    return CID.create(1, raw.code, await sha256.digest(bytes)).toString();
}

/** Returns the normalized CID string, or null if `value` is not a valid CID. */
async function parseCid(value) {
    if (typeof value !== "string" || value.length > 128) return null;
    try {
        const { CID } = await lib();
        return CID.parse(value).toString();
    } catch {
        return null;
    }
}

/** True if the CID can be re-checked by hashing the bytes (raw codec + sha2-256). */
async function isVerifiableCid(cid) {
    const { CID, raw, sha256 } = await lib();
    const parsed = CID.parse(cid);
    return parsed.version === 1 && parsed.code === raw.code && parsed.multihash.code === sha256.code;
}

module.exports = { cidForBytes, parseCid, isVerifiableCid };
