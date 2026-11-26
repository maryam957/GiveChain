// Evidence and campaign-detail storage.
//
// Every file is always kept in a local, content-addressed store (one file per CID),
// so the demo works offline. If a Pinata JWT is configured, files are also pinned to
// the public IPFS network through Pinata.
//
// Integrity: a CID is a hash of the file. When a file is read back, its bytes are
// hashed again and compared with the CID ("verified"). This proves the file was not
// changed; it does NOT prove the file's content is true.

const fs = require("fs");
const path = require("path");
const { cidForBytes, parseCid, isVerifiableCid } = require("./cid");

const ALLOWED_TYPES = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "text/plain": ".txt",
    "application/json": ".json",
};

const TYPE_BY_EXTENSION = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".txt": "text/plain",
    ".json": "application/json",
};

class IpfsError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

class IpfsService {
    /**
     * @param {object} options
     * @param {string} options.localDir        Folder for the local content-addressed store.
     * @param {string} [options.pinataJwt]     Pinata API JWT; empty = local only.
     * @param {string} [options.gateway]       Public gateway used to fetch CIDs not stored locally.
     * @param {number} [options.maxUploadBytes]
     * @param {Function} [options.fetchImpl]   Injected for tests.
     */
    constructor({ localDir, pinataJwt = "", gateway = "", maxUploadBytes = 5 * 1024 * 1024, fetchImpl }) {
        this.localDir = localDir;
        this.pinataJwt = pinataJwt;
        this.gateway = gateway.replace(/\/$/, "");
        this.maxUploadBytes = maxUploadBytes;
        this.fetch = fetchImpl || globalThis.fetch;
        fs.mkdirSync(localDir, { recursive: true });
    }

    get mode() {
        return this.pinataJwt ? "pinata+local" : "local";
    }

    static get allowedTypes() {
        return Object.keys(ALLOWED_TYPES);
    }

    /**
     * Stores a file and returns its CID.
     * @returns {Promise<{cid: string, size: number, contentType: string, pinned: boolean}>}
     */
    async add(bytes, { filename = "file", contentType } = {}) {
        if (!bytes || bytes.length === 0) throw new IpfsError(400, "File is empty");
        if (bytes.length > this.maxUploadBytes) {
            throw new IpfsError(413, `File is larger than ${this.maxUploadBytes} bytes`);
        }
        const type = contentType || TYPE_BY_EXTENSION[path.extname(filename).toLowerCase()];
        if (!ALLOWED_TYPES[type]) {
            throw new IpfsError(415, `File type not allowed. Allowed: ${IpfsService.allowedTypes.join(", ")}`);
        }

        const cid = await cidForBytes(bytes);
        this._writeLocal(cid, bytes, { contentType: type, filename, size: bytes.length });

        let pinned = false;
        if (this.pinataJwt) {
            const pinnedCid = await this._pinToPinata(bytes, filename, type);
            pinned = true;
            if (pinnedCid !== cid) {
                // Pinata may build a different (but equally valid) CID for the same bytes.
                // Keep a local copy under that CID too, and return the CID that is pinned.
                this._writeLocal(pinnedCid, bytes, {
                    contentType: type,
                    filename,
                    size: bytes.length,
                    aliasOf: cid,
                });
                return { cid: pinnedCid, size: bytes.length, contentType: type, pinned };
            }
        }
        return { cid, size: bytes.length, contentType: type, pinned };
    }

    /** Stores a JSON object (campaign details) and returns its CID. */
    async addJson(object) {
        const bytes = Buffer.from(JSON.stringify(object, null, 2) + "\n", "utf8");
        return this.add(bytes, { filename: "metadata.json", contentType: "application/json" });
    }

    /**
     * Reads a file by CID: from the local store first, then from the public gateway.
     * @returns {Promise<{bytes: Buffer, contentType: string, source: string, verified: boolean|null}>}
     *   verified: true = bytes re-hashed and match the CID; false = mismatch (never served);
     *   null = this CID type cannot be re-checked here.
     */
    async get(cidInput) {
        const cid = await parseCid(cidInput);
        if (!cid) throw new IpfsError(400, "Not a valid CID");

        let bytes;
        let meta = {};
        let source;
        const file = this._path(cid);
        if (fs.existsSync(file)) {
            bytes = fs.readFileSync(file);
            meta = this._readMeta(cid);
            source = "local";
        } else if (this.gateway && this.fetch) {
            const res = await this.fetch(`${this.gateway}/ipfs/${cid}`);
            if (!res.ok) throw new IpfsError(404, `Not found locally or on the gateway (${res.status})`);
            bytes = Buffer.from(await res.arrayBuffer());
            meta = { contentType: res.headers.get("content-type") || "application/octet-stream" };
            source = "gateway";
        } else {
            throw new IpfsError(404, "Not found");
        }

        let verified = null;
        if (await isVerifiableCid(cid)) {
            verified = (await cidForBytes(bytes)) === cid;
            if (!verified) throw new IpfsError(502, "Content does not match its CID; refusing to serve it");
        }
        return { bytes, contentType: meta.contentType || "application/octet-stream", source, verified };
    }

    /** Reads a JSON file by CID. */
    async getJson(cid) {
        const { bytes, verified, source } = await this.get(cid);
        return { data: JSON.parse(bytes.toString("utf8")), verified, source };
    }

    /** True if the CID is stored locally. */
    async has(cidInput) {
        const cid = await parseCid(cidInput);
        return Boolean(cid) && fs.existsSync(this._path(cid));
    }

    /** Adds every file in a folder tree to the local store (used for demo seed data). */
    async importDirectory(dir) {
        const added = [];
        if (!fs.existsSync(dir)) return added;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                added.push(...(await this.importDirectory(full)));
            } else if (TYPE_BY_EXTENSION[path.extname(entry.name).toLowerCase()] && entry.name !== "README.md") {
                const bytes = fs.readFileSync(full);
                const cid = await cidForBytes(bytes);
                this._writeLocal(cid, bytes, {
                    contentType: TYPE_BY_EXTENSION[path.extname(entry.name).toLowerCase()],
                    filename: entry.name,
                    size: bytes.length,
                });
                added.push({ cid, file: full });
            }
        }
        return added;
    }

    // --- internal -----------------------------------------------------------

    _path(cid) {
        // `cid` is always a parsed, normalized CID (letters and digits only),
        // so it cannot contain path separators.
        return path.join(this.localDir, cid);
    }

    _writeLocal(cid, bytes, meta) {
        fs.writeFileSync(this._path(cid), bytes);
        fs.writeFileSync(this._path(cid) + ".meta.json", JSON.stringify(meta));
    }

    _readMeta(cid) {
        try {
            return JSON.parse(fs.readFileSync(this._path(cid) + ".meta.json", "utf8"));
        } catch {
            return {};
        }
    }

    async _pinToPinata(bytes, filename, contentType) {
        const form = new FormData();
        form.append("file", new Blob([bytes], { type: contentType }), filename);
        form.append("network", "public");
        const res = await this.fetch("https://uploads.pinata.cloud/v3/files", {
            method: "POST",
            headers: { Authorization: `Bearer ${this.pinataJwt}` },
            body: form,
        });
        if (!res.ok) throw new IpfsError(502, `Pinata upload failed (${res.status})`);
        const body = await res.json();
        const cid = await parseCid(body?.data?.cid);
        if (!cid) throw new IpfsError(502, "Pinata returned no valid CID");
        return cid;
    }
}

module.exports = { IpfsService, IpfsError, ALLOWED_TYPES };
