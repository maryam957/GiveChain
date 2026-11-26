// Accounts, sessions, wallet linking and application tests.
// The on-chain state is simulated with a Store whose roles and campaigns the tests set.
const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ethers } = require("ethers");
const { Store } = require("../src/indexer/store");
const { MemoryDb } = require("../src/accounts/jsonDb");
const { AccountsService } = require("../src/accounts/accountsService");
const { IpfsService } = require("../src/ipfs/ipfsService");
const { createApp } = require("../src/api/app");

const NGO_ORG = {
    organisationName: "Test Relief",
    registrationNumber: "REG-1",
    description: "A test NGO that helps people.",
};

let server;
let base;
let store;
let accounts;

/** A tiny HTTP client that keeps its own session cookie, like a browser. */
function client() {
    let cookie = null;
    return async function call(method, url, body) {
        const res = await fetch(base + url, {
            method,
            headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const setCookie = res.headers.get("set-cookie");
        if (setCookie) cookie = setCookie.split(";")[0];
        let json = null;
        try {
            json = await res.json();
        } catch {
            // empty body
        }
        return { status: res.status, body: json, setCookie };
    };
}

async function signupAndLink(call, { accountType, wallet, email, organisation }) {
    const signup = await call("POST", "/auth/signup", {
        email,
        password: "Password123",
        name: "Test Person",
        accountType,
        organisation,
    });
    assert.equal(signup.status, 201, JSON.stringify(signup.body));
    const { body } = await call("POST", "/auth/wallet/challenge");
    const signature = await wallet.signMessage(body.message);
    const linked = await call("POST", "/auth/wallet/link", { address: wallet.address, signature });
    assert.equal(linked.status, 200, JSON.stringify(linked.body));
    return linked.body;
}

function addCampaign(id, ngo, status = "Active") {
    const c = store.campaign(id);
    Object.assign(c, { ngo, status, metadataCID: null });
    return c;
}

beforeEach(async () => {
    store = new Store();
    accounts = new AccountsService({ db: new MemoryDb(), store });
    const ipfs = new IpfsService({ localDir: fs.mkdtempSync(path.join(os.tmpdir(), "gc-acc-")), gateway: "" });
    const app = createApp({ store, ipfs, getDeployment: () => null, accounts });
    await new Promise((resolve) => {
        server = app.listen(0, resolve);
    });
    base = `http://127.0.0.1:${server.address().port}/api`;
});

afterEach(() => server.close());

describe("Sign-up and login", () => {
    test("creates an account, logs in with an HttpOnly cookie, and returns no password data", async () => {
        const call = client();
        const res = await call("POST", "/auth/signup", {
            email: "Donor@Example.com",
            password: "Password123",
            name: "Dana",
            accountType: "donor",
        });
        assert.equal(res.status, 201);
        assert.match(res.setCookie, /HttpOnly/);
        assert.match(res.setCookie, /SameSite=Lax/);
        assert.equal(res.body.email, "donor@example.com");
        assert.equal(res.body.passwordHash, undefined);
        const me = await call("GET", "/auth/me");
        assert.equal(me.body.name, "Dana");
    });

    test("stores only a scrypt hash of the password", async () => {
        await client()("POST", "/auth/signup", { email: "a@b.co", password: "Password123", name: "Ann", accountType: "donor" });
        const stored = accounts.findUserByEmail("a@b.co");
        assert.match(stored.passwordHash, /^scrypt\$/);
        assert.ok(!stored.passwordHash.includes("Password123"));
    });

    test("rejects weak passwords, bad emails, duplicates and admin self-sign-up", async () => {
        const call = client();
        const base = { email: "x@y.co", name: "Xavier", accountType: "donor" };
        assert.equal((await call("POST", "/auth/signup", { ...base, password: "short1" })).status, 400);
        assert.equal((await call("POST", "/auth/signup", { ...base, password: "lettersonly" })).status, 400);
        assert.equal((await call("POST", "/auth/signup", { ...base, email: "nope", password: "Password123" })).status, 400);
        assert.equal((await call("POST", "/auth/signup", { ...base, accountType: "admin", password: "Password123" })).status, 400);
        assert.equal((await call("POST", "/auth/signup", { ...base, password: "Password123" })).status, 201);
        assert.equal((await client()("POST", "/auth/signup", { ...base, password: "Password123" })).status, 409);
    });

    test("logs in, rejects a wrong password with a generic message, and logs out", async () => {
        await client()("POST", "/auth/signup", { email: "l@x.co", password: "Password123", name: "Lee", accountType: "donor" });
        const call = client();
        const wrong = await call("POST", "/auth/login", { email: "l@x.co", password: "Wrong12345" });
        assert.equal(wrong.status, 401);
        assert.equal(wrong.body.error, "Wrong email or password.");
        const unknown = await call("POST", "/auth/login", { email: "nobody@x.co", password: "Wrong12345" });
        assert.equal(unknown.body.error, "Wrong email or password.");

        assert.equal((await call("POST", "/auth/login", { email: "L@X.co", password: "Password123" })).status, 200);
        assert.equal((await call("GET", "/auth/me")).body.name, "Lee");
        await call("POST", "/auth/logout");
        assert.equal((await call("GET", "/auth/me")).body, null);
    });

    test("blocks repeated wrong passwords (rate limit)", async () => {
        await client()("POST", "/auth/signup", { email: "r@x.co", password: "Password123", name: "Rae", accountType: "donor" });
        const call = client();
        for (let i = 0; i < 10; i++) await call("POST", "/auth/login", { email: "r@x.co", password: "Wrong12345" });
        const blocked = await call("POST", "/auth/login", { email: "r@x.co", password: "Password123" });
        assert.equal(blocked.status, 429);
    });

    test("changing the password requires the current one and ends other sessions", async () => {
        const call = client();
        await call("POST", "/auth/signup", { email: "p@x.co", password: "Password123", name: "Pat", accountType: "donor" });
        const other = client();
        await other("POST", "/auth/login", { email: "p@x.co", password: "Password123" });
        assert.equal((await call("POST", "/auth/password", { currentPassword: "nope", newPassword: "NewPass456" })).status, 400);
        assert.equal((await call("POST", "/auth/password", { currentPassword: "Password123", newPassword: "NewPass456" })).status, 200);
        assert.equal((await other("GET", "/auth/me")).body, null);
        assert.equal((await client()("POST", "/auth/login", { email: "p@x.co", password: "NewPass456" })).status, 200);
    });
});

describe("Wallet linking", () => {
    test("links a wallet only with a valid signature from that wallet", async () => {
        const call = client();
        await call("POST", "/auth/signup", { email: "w@x.co", password: "Password123", name: "Wes", accountType: "donor" });
        const wallet = ethers.Wallet.createRandom();
        const impostor = ethers.Wallet.createRandom();
        const { body } = await call("POST", "/auth/wallet/challenge");
        assert.match(body.message, /does not send a transaction/);

        const forged = await call("POST", "/auth/wallet/link", {
            address: wallet.address,
            signature: await impostor.signMessage(body.message),
        });
        assert.equal(forged.status, 400);

        const ok = await call("POST", "/auth/wallet/link", {
            address: wallet.address,
            signature: await wallet.signMessage(body.message),
        });
        assert.equal(ok.body.wallet, wallet.address);
    });

    test("cannot reuse a challenge, and one wallet cannot belong to two accounts", async () => {
        const wallet = ethers.Wallet.createRandom();
        const first = client();
        await signupAndLink(first, { accountType: "donor", wallet, email: "one@x.co" });
        const replay = await first("POST", "/auth/wallet/link", { address: wallet.address, signature: "0x00" });
        assert.equal(replay.status, 400);

        const second = client();
        await second("POST", "/auth/signup", { email: "two@x.co", password: "Password123", name: "Two", accountType: "donor" });
        const { body } = await second("POST", "/auth/wallet/challenge");
        const res = await second("POST", "/auth/wallet/link", { address: wallet.address, signature: await wallet.signMessage(body.message) });
        assert.equal(res.status, 409);
    });
});

describe("NGO and verifier applications", () => {
    test("an NGO sign-up creates a pending application that becomes approved only when the role is on-chain", async () => {
        const call = client();
        const wallet = ethers.Wallet.createRandom();
        const user = await signupAndLink(call, { accountType: "ngo", wallet, email: "ngo@x.co", organisation: NGO_ORG });
        assert.equal(user.roleApplication.status, "pending");
        assert.equal(user.chainRoles.ngo, false);

        store.roles.ngos.add(wallet.address); // the admin granted the role on-chain
        const me = await call("GET", "/auth/me");
        assert.equal(me.body.roleApplication.status, "approved");
        assert.equal(me.body.chainRoles.ngo, true);
    });

    test("NGO sign-up requires organisation details", async () => {
        const res = await client()("POST", "/auth/signup", {
            email: "n@x.co",
            password: "Password123",
            name: "Nia",
            accountType: "ngo",
            organisation: { organisationName: "X" },
        });
        assert.equal(res.status, 400);
    });

    test("only the admin with the on-chain admin role can list and reject applications", async () => {
        const applicant = client();
        await signupAndLink(applicant, { accountType: "verifier", wallet: ethers.Wallet.createRandom(), email: "v@x.co", organisation: NGO_ORG });

        const adminWallet = ethers.Wallet.createRandom();
        accounts.importDemoUsers([{ email: "admin@x.co", name: "Admin", accountType: "admin", password: "Password123", wallet: adminWallet.address }]);
        const admin = client();
        await admin("POST", "/auth/login", { email: "admin@x.co", password: "Password123" });

        assert.equal((await admin("GET", "/admin/role-applications")).status, 403); // no on-chain admin role yet
        store.roles.admins.add(adminWallet.address);
        const list = await admin("GET", "/admin/role-applications?status=pending");
        assert.equal(list.body.length, 1);
        assert.equal(list.body[0].applicant.email, "v@x.co");

        assert.equal((await applicant("GET", "/admin/role-applications")).status, 403);
        const rejected = await admin("POST", `/admin/role-applications/${list.body[0].id}/reject`, { note: "Missing documents" });
        assert.equal(rejected.body.status, "rejected");
        const me = await applicant("GET", "/auth/me");
        assert.equal(me.body.roleApplication.status, "rejected");
        assert.equal(me.body.roleApplication.reviewNote, "Missing documents");
    });

    test("public profiles show organisation names but never donors or beneficiaries", async () => {
        await signupAndLink(client(), { accountType: "ngo", wallet: ethers.Wallet.createRandom(), email: "o@x.co", organisation: NGO_ORG });
        await signupAndLink(client(), { accountType: "beneficiary", wallet: ethers.Wallet.createRandom(), email: "b@x.co" });
        const { body } = await client()("GET", "/profiles");
        assert.equal(body.length, 1);
        assert.equal(body[0].organisation, "Test Relief");
    });
});

describe("Beneficiary applications", () => {
    async function setup() {
        const ngoWallet = ethers.Wallet.createRandom();
        const ngo = client();
        await signupAndLink(ngo, { accountType: "ngo", wallet: ngoWallet, email: "ngo@x.co", organisation: NGO_ORG });
        store.roles.ngos.add(ngoWallet.address);
        const campaign = addCampaign(1, ngoWallet.address);

        const benWallet = ethers.Wallet.createRandom();
        const ben = client();
        await signupAndLink(ben, { accountType: "beneficiary", wallet: benWallet, email: "ben@x.co" });
        return { ngo, ben, benWallet, campaign };
    }
    const APPLY = { fullName: "Ben Fisher", idNumber: "ID-12345", reason: "Need winter food for my family.", householdSize: 4 };

    test("a beneficiary applies, the campaign NGO sees it, and on-chain registration marks it registered", async () => {
        const { ngo, ben, benWallet, campaign } = await setup();
        const applied = await ben("POST", "/campaigns/1/applications", APPLY);
        assert.equal(applied.status, 201);
        assert.equal(applied.body.status, "pending");

        const list = await ngo("GET", "/campaigns/1/applications");
        assert.equal(list.body[0].fullName, "Ben Fisher");
        assert.equal(list.body[0].wallet, benWallet.address);

        campaign.beneficiaries.set(benWallet.address, { wallet: benWallet.address, status: "Registered" });
        const mine = await ben("GET", "/my/applications");
        assert.equal(mine.body[0].status, "registered");
        assert.equal(mine.body[0].chainStatus, "Registered");
    });

    test("keeps applicant details private from other users", async () => {
        const { ben } = await setup();
        await ben("POST", "/campaigns/1/applications", APPLY);
        const stranger = client();
        await stranger("POST", "/auth/signup", { email: "s@x.co", password: "Password123", name: "Sam", accountType: "donor" });
        assert.equal((await stranger("GET", "/campaigns/1/applications")).status, 403);
        assert.equal((await client()("GET", "/campaigns/1/applications")).status, 401);
    });

    test("lets a verifier see applications, but not decline them", async () => {
        const { ben } = await setup();
        const app = await ben("POST", "/campaigns/1/applications", APPLY);
        const verifierWallet = ethers.Wallet.createRandom();
        const verifier = client();
        await signupAndLink(verifier, { accountType: "verifier", wallet: verifierWallet, email: "ver@x.co", organisation: NGO_ORG });
        store.roles.auditors.add(verifierWallet.address);
        assert.equal((await verifier("GET", "/campaigns/1/applications")).body.length, 1);
        assert.equal((await verifier("POST", `/beneficiary-applications/${app.body.id}/decline`, {})).status, 403);
    });

    test("the NGO can decline; duplicates and closed campaigns are refused", async () => {
        const { ngo, ben, campaign } = await setup();
        const app = await ben("POST", "/campaigns/1/applications", APPLY);
        assert.equal((await ben("POST", "/campaigns/1/applications", APPLY)).status, 409);
        const declined = await ngo("POST", `/beneficiary-applications/${app.body.id}/decline`, { note: "Outside the area" });
        assert.equal(declined.body.status, "declined");
        campaign.status = "Completed";
        assert.equal((await ben("POST", "/campaigns/1/applications", APPLY)).status, 400);
    });

    test("only beneficiary accounts with a linked wallet can apply", async () => {
        await setup();
        const donor = client();
        await donor("POST", "/auth/signup", { email: "d@x.co", password: "Password123", name: "Dee", accountType: "donor" });
        assert.equal((await donor("POST", "/campaigns/1/applications", APPLY)).status, 403);
        const noWallet = client();
        await noWallet("POST", "/auth/signup", { email: "nw@x.co", password: "Password123", name: "Nell", accountType: "beneficiary" });
        assert.equal((await noWallet("POST", "/campaigns/1/applications", APPLY)).status, 400);
    });
});

describe("Uploads", () => {
    test("IPFS uploads require a login when accounts are enabled", async () => {
        const anon = await client()("POST", "/ipfs/json", { title: "x" });
        assert.equal(anon.status, 401);
        const call = client();
        await call("POST", "/auth/signup", { email: "u@x.co", password: "Password123", name: "Uma", accountType: "donor" });
        assert.equal((await call("POST", "/ipfs/json", { title: "Campaign" })).status, 200);
    });
});
