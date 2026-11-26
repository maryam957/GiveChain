// IPFS service tests. Run with: npm test (inside backend/) or npm run backend:test (root).
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { IpfsService } = require("../src/ipfs/ipfsService");
const { cidForBytes } = require("../src/ipfs/cid");

const HELLO = Buffer.from("hello world\n");
// Well-known CID of "hello world\n" (ipfs add --cid-version=1 --raw-leaves).
const HELLO_CID = "bafkreifjjcie6lypi6ny7amxnfftagclbuxndqonfipmb64f2km2devei4";

function tempService(options = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "givechain-ipfs-"));
    return new IpfsService({ localDir: dir, gateway: "", ...options });
}

describe("CID calculation", () => {
    test("matches the real IPFS CID for a known file", async () => {
        assert.equal(await cidForBytes(HELLO), HELLO_CID);
    });

    test("changes when one byte changes", async () => {
        assert.notEqual(await cidForBytes(Buffer.from("hello world!\n")), HELLO_CID);
    });
});

describe("IpfsService (local mode)", () => {
    let ipfs;
    beforeEach(() => {
        ipfs = tempService();
    });

    test("runs in local mode without a Pinata key", () => {
        assert.equal(ipfs.mode, "local");
    });

    test("stores a file and returns its real CID", async () => {
        const result = await ipfs.add(HELLO, { filename: "hello.txt", contentType: "text/plain" });
        assert.deepEqual(result, { cid: HELLO_CID, size: 12, contentType: "text/plain", pinned: false });
        assert.equal(await ipfs.has(HELLO_CID), true);
    });

    test("reads a file back and verifies it against its CID", async () => {
        await ipfs.add(HELLO, { filename: "hello.txt" });
        const file = await ipfs.get(HELLO_CID);
        assert.equal(file.bytes.toString(), "hello world\n");
        assert.equal(file.contentType, "text/plain");
        assert.equal(file.source, "local");
        assert.equal(file.verified, true);
    });

    test("refuses to serve a file that was changed after it was stored", async () => {
        await ipfs.add(HELLO, { filename: "hello.txt" });
        fs.writeFileSync(path.join(ipfs.localDir, HELLO_CID), "hello w0rld\n");
        await assert.rejects(ipfs.get(HELLO_CID), { status: 502, message: /does not match its CID/ });
    });

    test("stores and reads JSON campaign details", async () => {
        const { cid } = await ipfs.addJson({ title: "Test campaign" });
        const { data, verified } = await ipfs.getJson(cid);
        assert.deepEqual(data, { title: "Test campaign" });
        assert.equal(verified, true);
    });

    test("gives identical content the same CID (deduplication)", async () => {
        const a = await ipfs.add(HELLO, { filename: "a.txt" });
        const b = await ipfs.add(HELLO, { filename: "b.txt" });
        assert.equal(a.cid, b.cid);
    });

    test("rejects empty files", async () => {
        await assert.rejects(ipfs.add(Buffer.alloc(0), { filename: "x.txt" }), { status: 400 });
    });

    test("rejects files over the size limit", async () => {
        const small = tempService({ maxUploadBytes: 10 });
        await assert.rejects(small.add(HELLO, { filename: "hello.txt" }), { status: 413 });
    });

    test("rejects file types that are not allowed", async () => {
        await assert.rejects(
            ipfs.add(Buffer.from("<script>"), { filename: "x.html", contentType: "text/html" }),
            { status: 415 }
        );
        await assert.rejects(ipfs.add(Buffer.from("MZ"), { filename: "x.exe" }), { status: 415 });
    });

    test("rejects invalid CIDs, including path tricks", async () => {
        for (const bad of ["not-a-cid", "../../etc/passwd", "..\\..\\secret", ""]) {
            await assert.rejects(ipfs.get(bad), { status: 400 });
        }
    });

    test("returns 404 for an unknown CID when no gateway is configured", async () => {
        const otherCid = await cidForBytes(Buffer.from("never stored"));
        await assert.rejects(ipfs.get(otherCid), { status: 404 });
    });

    test("imports the demo seed files with the same CIDs the seed script uses", async () => {
        const seedDir = path.join(__dirname, "..", "..", "seed-data");
        const added = await ipfs.importDirectory(seedDir);
        assert.equal(added.length, 6);
        for (const { cid, file } of added) {
            assert.equal(cid, await cidForBytes(fs.readFileSync(file)));
            assert.equal((await ipfs.get(cid)).verified, true);
        }
    });
});

describe("IpfsService (gateway fallback)", () => {
    test("fetches unknown CIDs from the gateway and verifies them", async () => {
        const fetchImpl = async () => ({
            ok: true,
            headers: new Map([["content-type", "text/plain"]]),
            arrayBuffer: async () => HELLO,
        });
        const ipfs = tempService({ gateway: "https://gateway.example", fetchImpl });
        const file = await ipfs.get(HELLO_CID);
        assert.equal(file.source, "gateway");
        assert.equal(file.verified, true);
    });

    test("rejects gateway content that does not match the CID", async () => {
        const fetchImpl = async () => ({
            ok: true,
            headers: new Map(),
            arrayBuffer: async () => Buffer.from("tampered by the gateway"),
        });
        const ipfs = tempService({ gateway: "https://gateway.example", fetchImpl });
        await assert.rejects(ipfs.get(HELLO_CID), { status: 502 });
    });
});
