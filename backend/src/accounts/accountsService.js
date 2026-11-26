// User accounts, sessions, wallet linking and applications.
//
// Trust model: the database stores profiles and applications, but it never decides
// who may move money. Roles (NGO, verifier, admin) and beneficiary eligibility are
// read from the blockchain (via the event index). An application counts as approved
// only when the applicant's linked wallet actually holds the role on-chain.

const crypto = require("crypto");
const { ethers } = require("ethers");
const { hashPassword, verifyPassword, passwordProblem } = require("./passwords");

const ACCOUNT_TYPES = ["donor", "beneficiary", "ngo", "verifier"];
const ROLE_FOR_TYPE = { ngo: "ngos", verifier: "auditors", admin: "admins" };
const SESSION_DAYS = 7;
const NONCE_MINUTES = 10;

class AccountError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const sameAddress = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();

function cleanText(value, field, { required = false, max = 200, min = 0 } = {}) {
    if (value === undefined || value === null || value === "") {
        if (required) throw new AccountError(400, `${field} is required.`);
        return "";
    }
    if (typeof value !== "string") throw new AccountError(400, `${field} must be text.`);
    const text = value.trim();
    if (required && !text) throw new AccountError(400, `${field} is required.`);
    if (text.length < min) throw new AccountError(400, `${field} must be at least ${min} characters.`);
    if (text.length > max) throw new AccountError(400, `${field} must be at most ${max} characters.`);
    return text;
}

function cleanEmail(value) {
    const email = cleanText(value, "Email", { required: true, max: 160 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccountError(400, "Enter a valid email address.");
    return email;
}

class AccountsService {
    /**
     * @param {object} deps
     * @param {import("./jsonDb").JsonDb} deps.db
     * @param {import("../indexer/store").Store} deps.store  On-chain event index.
     */
    constructor({ db, store }) {
        this.db = db;
        this.store = store;
    }

    get users() {
        return this.db.collection("users");
    }

    // ------------------------------------------------------------------ chain view

    /** On-chain roles held by a wallet, from the event index. */
    chainRoles(wallet) {
        const has = (set) => Boolean(wallet) && [...set].some((a) => sameAddress(a, wallet));
        const r = this.store.roles;
        return { admin: has(r.admins), pauser: has(r.pausers), ngo: has(r.ngos), verifier: has(r.auditors) };
    }

    userHasChainRole(user, type) {
        const roles = this.chainRoles(user?.wallet);
        return type === "ngo" ? roles.ngo : type === "verifier" ? roles.verifier : type === "admin" ? roles.admin : false;
    }

    // ------------------------------------------------------------------ users

    findUserByEmail(email) {
        return this.users.find((u) => u.email === String(email || "").toLowerCase());
    }

    findUserById(id) {
        return this.users.find((u) => u.id === id);
    }

    findUserByWallet(wallet) {
        return this.users.find((u) => sameAddress(u.wallet, wallet));
    }

    signup(body) {
        const email = cleanEmail(body.email);
        const name = cleanText(body.name, "Name", { required: true, min: 2, max: 80 });
        const problem = passwordProblem(body.password);
        if (problem) throw new AccountError(400, problem);
        const accountType = body.accountType;
        if (!ACCOUNT_TYPES.includes(accountType)) throw new AccountError(400, "Choose an account type.");
        if (this.findUserByEmail(email)) throw new AccountError(409, "An account with this email already exists.");

        const user = {
            id: newId(),
            email,
            name,
            accountType,
            passwordHash: hashPassword(body.password),
            phone: cleanText(body.phone, "Phone", { max: 30 }),
            wallet: null,
            createdAt: now(),
        };

        let application = null;
        if (accountType === "ngo" || accountType === "verifier") {
            application = this._newRoleApplication(user, body.organisation || {});
        }
        this.users.push(user);
        if (application) this.db.collection("roleApplications").push(application);
        this.db.save();
        return user;
    }

    _newRoleApplication(user, org) {
        return {
            id: newId(),
            userId: user.id,
            role: user.accountType,
            organisationName: cleanText(org.organisationName, "Organisation name", { required: true, min: 2, max: 120 }),
            registrationNumber: cleanText(org.registrationNumber, "Registration number", {
                required: user.accountType === "ngo",
                max: 60,
            }),
            country: cleanText(org.country, "Country", { max: 60 }),
            website: cleanText(org.website, "Website", { max: 200 }),
            description: cleanText(org.description, "Description", { required: true, min: 10, max: 1000 }),
            status: "pending", // pending | rejected (approved is read from the chain)
            reviewNote: "",
            reviewedBy: null,
            createdAt: now(),
            updatedAt: now(),
        };
    }

    login(email, password) {
        const user = this.findUserByEmail(email);
        // Same message for unknown email and wrong password, so emails cannot be probed.
        if (!user || !verifyPassword(String(password || ""), user.passwordHash)) {
            throw new AccountError(401, "Wrong email or password.");
        }
        return user;
    }

    updateProfile(user, body) {
        if (body.name !== undefined) user.name = cleanText(body.name, "Name", { required: true, min: 2, max: 80 });
        if (body.phone !== undefined) user.phone = cleanText(body.phone, "Phone", { max: 30 });
        this.db.save();
        return user;
    }

    changePassword(user, current, next) {
        if (!verifyPassword(String(current || ""), user.passwordHash)) {
            throw new AccountError(400, "Your current password is wrong.");
        }
        const problem = passwordProblem(next);
        if (problem) throw new AccountError(400, problem);
        user.passwordHash = hashPassword(next);
        // Log out every other session.
        this.db.data.sessions = this.db.collection("sessions").filter((s) => s.userId !== user.id);
        this.db.save();
    }

    // ------------------------------------------------------------------ sessions

    createSession(user) {
        const token = crypto.randomBytes(32).toString("hex");
        this.db.collection("sessions").push({
            tokenHash: sha256(token),
            userId: user.id,
            expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(),
        });
        this.db.save();
        return token;
    }

    userForSession(token) {
        if (!token) return null;
        const hash = sha256(token);
        const session = this.db.collection("sessions").find((s) => s.tokenHash === hash);
        if (!session) return null;
        if (new Date(session.expiresAt) < new Date()) {
            this.deleteSession(token);
            return null;
        }
        return this.findUserById(session.userId) || null;
    }

    deleteSession(token) {
        const hash = sha256(String(token || ""));
        this.db.data.sessions = this.db.collection("sessions").filter((s) => s.tokenHash !== hash);
        this.db.save();
    }

    // ------------------------------------------------------------------ wallet linking

    /** Returns the exact message the user must sign in MetaMask to prove they own a wallet. */
    walletChallenge(user) {
        const nonce = crypto.randomBytes(12).toString("hex");
        const message =
            "GiveChain: link this wallet to your account.\n\n" +
            `Account: ${user.email}\n` +
            `Nonce: ${nonce}\n` +
            `Issued: ${now()}\n\n` +
            "Signing this message does not send a transaction or cost anything.";
        const nonces = this.db.collection("walletNonces").filter((n) => n.userId !== user.id);
        nonces.push({ userId: user.id, message, expiresAt: new Date(Date.now() + NONCE_MINUTES * 60000).toISOString() });
        this.db.data.walletNonces = nonces;
        this.db.save();
        return message;
    }

    linkWallet(user, { address, signature }) {
        if (!ethers.isAddress(address)) throw new AccountError(400, "Not a valid wallet address.");
        const pending = this.db.collection("walletNonces").find((n) => n.userId === user.id);
        if (!pending || new Date(pending.expiresAt) < new Date()) {
            throw new AccountError(400, "The signing request expired. Please try again.");
        }
        let signer;
        try {
            signer = ethers.verifyMessage(pending.message, signature);
        } catch {
            throw new AccountError(400, "The signature is not valid.");
        }
        if (!sameAddress(signer, address)) {
            throw new AccountError(400, "The signature was made by a different wallet.");
        }
        const owner = this.findUserByWallet(signer);
        if (owner && owner.id !== user.id) {
            throw new AccountError(409, "This wallet is already linked to another GiveChain account.");
        }
        user.wallet = ethers.getAddress(signer);
        this.db.data.walletNonces = this.db.collection("walletNonces").filter((n) => n.userId !== user.id);
        this.db.save();
        return user;
    }

    // ------------------------------------------------------------------ role applications

    _effectiveRoleStatus(app) {
        const user = this.findUserById(app.userId);
        if (user && this.userHasChainRole(user, app.role)) return "approved";
        return app.status;
    }

    roleApplicationFor(user) {
        const app = this.db.collection("roleApplications").find((a) => a.userId === user.id);
        return app ? { ...app, status: this._effectiveRoleStatus(app) } : null;
    }

    listRoleApplications(status) {
        return this.db
            .collection("roleApplications")
            .map((app) => {
                const user = this.findUserById(app.userId);
                return {
                    ...app,
                    status: this._effectiveRoleStatus(app),
                    applicant: user ? { name: user.name, email: user.email, wallet: user.wallet } : null,
                };
            })
            .filter((app) => !status || app.status === status)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    rejectRoleApplication(id, admin, note) {
        const app = this.db.collection("roleApplications").find((a) => a.id === id);
        if (!app) throw new AccountError(404, "Application not found.");
        if (this._effectiveRoleStatus(app) === "approved") {
            throw new AccountError(409, "Already approved on-chain. Revoke the role instead.");
        }
        app.status = "rejected";
        app.reviewNote = cleanText(note, "Note", { max: 500 });
        app.reviewedBy = admin.id;
        app.updatedAt = now();
        this.db.save();
        return app;
    }

    /** Lets a rejected applicant send an updated application. */
    resubmitRoleApplication(user, org) {
        if (user.accountType !== "ngo" && user.accountType !== "verifier") {
            throw new AccountError(400, "Only NGO and verifier accounts apply for a role.");
        }
        const apps = this.db.collection("roleApplications");
        const existing = apps.find((a) => a.userId === user.id);
        if (existing && this._effectiveRoleStatus(existing) === "approved") {
            throw new AccountError(409, "You are already approved.");
        }
        const fresh = this._newRoleApplication(user, org || {});
        if (existing) Object.assign(existing, { ...fresh, id: existing.id, createdAt: existing.createdAt });
        else apps.push(fresh);
        this.db.save();
        return this.roleApplicationFor(user);
    }

    // ------------------------------------------------------------------ beneficiary applications

    _campaign(campaignId) {
        const campaign = this.store.campaigns.get(Number(campaignId));
        if (!campaign || campaign.status === "None") throw new AccountError(404, "Campaign not found.");
        return campaign;
    }

    _chainBeneficiary(campaign, wallet) {
        for (const b of campaign.beneficiaries.values()) if (sameAddress(b.wallet, wallet)) return b;
        return null;
    }

    _effectiveBeneficiaryApp(app) {
        const user = this.findUserById(app.userId);
        const campaign = this.store.campaigns.get(app.campaignId);
        const onChain = campaign && user?.wallet ? this._chainBeneficiary(campaign, user.wallet) : null;
        return {
            ...app,
            wallet: user?.wallet || null,
            applicantEmail: user?.email || null,
            status: onChain ? "registered" : app.status, // pending | declined | registered
            chainStatus: onChain ? onChain.status : null, // Registered | Approved | Revoked
        };
    }

    applyToCampaign(user, campaignId, body) {
        if (user.accountType !== "beneficiary") throw new AccountError(403, "Only beneficiary accounts can apply for help.");
        if (!user.wallet) throw new AccountError(400, "Link your wallet first, so payments can reach you.");
        const campaign = this._campaign(campaignId);
        if (campaign.status !== "Active") throw new AccountError(400, "This campaign is not accepting applications.");
        if (this._chainBeneficiary(campaign, user.wallet)) {
            throw new AccountError(409, "You are already registered in this campaign.");
        }
        const apps = this.db.collection("beneficiaryApplications");
        const open = apps.find((a) => a.userId === user.id && a.campaignId === campaign.id && a.status === "pending");
        if (open) throw new AccountError(409, "You already applied to this campaign.");

        const householdSize = body.householdSize === undefined || body.householdSize === "" ? null : Number(body.householdSize);
        if (householdSize !== null && (!Number.isInteger(householdSize) || householdSize < 1 || householdSize > 50)) {
            throw new AccountError(400, "Household size must be a whole number from 1 to 50.");
        }
        const app = {
            id: newId(),
            userId: user.id,
            campaignId: campaign.id,
            fullName: cleanText(body.fullName, "Full name", { required: true, min: 2, max: 100 }),
            idNumber: cleanText(body.idNumber, "ID number", { required: true, min: 4, max: 40 }),
            phone: cleanText(body.phone, "Phone", { max: 30 }),
            householdSize,
            reason: cleanText(body.reason, "Reason", { required: true, min: 10, max: 1000 }),
            status: "pending",
            reviewNote: "",
            createdAt: now(),
            updatedAt: now(),
        };
        apps.push(app);
        this.db.save();
        return this._effectiveBeneficiaryApp(app);
    }

    myBeneficiaryApplications(user) {
        return this.db
            .collection("beneficiaryApplications")
            .filter((a) => a.userId === user.id)
            .map((a) => this._effectiveBeneficiaryApp(a));
    }

    /** Applications (with personal details) for the campaign's own NGO or any verifier. */
    campaignApplications(user, campaignId) {
        const campaign = this._campaign(campaignId);
        const isOwner = sameAddress(user.wallet, campaign.ngo) && this.userHasChainRole(user, "ngo");
        const isVerifier = this.userHasChainRole(user, "verifier");
        if (!isOwner && !isVerifier) {
            throw new AccountError(403, "Only this campaign's NGO and verifiers can see applications.");
        }
        return this.db
            .collection("beneficiaryApplications")
            .filter((a) => a.campaignId === campaign.id)
            .map((a) => this._effectiveBeneficiaryApp(a))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    declineBeneficiaryApplication(user, id, note) {
        const app = this.db.collection("beneficiaryApplications").find((a) => a.id === id);
        if (!app) throw new AccountError(404, "Application not found.");
        const campaign = this._campaign(app.campaignId);
        if (!sameAddress(user.wallet, campaign.ngo) || !this.userHasChainRole(user, "ngo")) {
            throw new AccountError(403, "Only this campaign's NGO can decline applications.");
        }
        if (this._effectiveBeneficiaryApp(app).status === "registered") {
            throw new AccountError(409, "This person is already registered on-chain.");
        }
        app.status = "declined";
        app.reviewNote = cleanText(note, "Note", { max: 500 });
        app.updatedAt = now();
        this.db.save();
        return this._effectiveBeneficiaryApp(app);
    }

    // ------------------------------------------------------------------ public info

    /** Safe view of a user for the frontend (never includes the password hash). */
    publicUser(user) {
        const roleApplication = this.roleApplicationFor(user);
        return {
            id: user.id,
            email: user.email,
            name: user.name,
            phone: user.phone,
            accountType: user.accountType,
            wallet: user.wallet,
            createdAt: user.createdAt,
            chainRoles: this.chainRoles(user.wallet),
            roleApplication,
        };
    }

    /**
     * Public names for organisations: NGOs, verifiers and the admin, by wallet.
     * Donor and beneficiary names are never public.
     */
    publicProfiles() {
        return this.users
            .filter((u) => u.wallet && ["ngo", "verifier", "admin"].includes(u.accountType))
            .map((u) => {
                const app = this.db.collection("roleApplications").find((a) => a.userId === u.id);
                return {
                    wallet: u.wallet,
                    name: u.name,
                    accountType: u.accountType,
                    organisation: app?.organisationName || (u.accountType === "admin" ? "GiveChain" : null),
                    verified: this.userHasChainRole(u, u.accountType),
                };
            });
    }

    /** All users with their on-chain roles, for the admin. */
    listUsers() {
        return this.users.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            accountType: u.accountType,
            wallet: u.wallet,
            createdAt: u.createdAt,
            chainRoles: this.chainRoles(u.wallet),
        }));
    }

    // ------------------------------------------------------------------ demo data

    /**
     * Creates the local demo accounts from seed-data/demo-users.json if they do not
     * exist yet. Only for local development chains.
     */
    importDemoUsers(list) {
        let created = 0;
        for (const entry of list) {
            if (this.findUserByEmail(entry.email)) continue;
            const user = {
                id: newId(),
                email: entry.email.toLowerCase(),
                name: entry.name,
                accountType: entry.accountType,
                passwordHash: hashPassword(entry.password),
                phone: entry.phone || "",
                wallet: entry.wallet ? ethers.getAddress(entry.wallet) : null,
                createdAt: now(),
            };
            this.users.push(user);
            if (entry.organisation) {
                this.db.collection("roleApplications").push(this._newRoleApplication(user, entry.organisation));
            }
            for (const application of entry.beneficiaryApplications || []) {
                this.db.collection("beneficiaryApplications").push({
                    id: newId(),
                    userId: user.id,
                    campaignId: application.campaignId,
                    fullName: application.fullName,
                    idNumber: application.idNumber,
                    phone: application.phone || "",
                    householdSize: application.householdSize ?? null,
                    reason: application.reason,
                    status: "pending",
                    reviewNote: "",
                    createdAt: now(),
                    updatedAt: now(),
                });
            }
            created++;
        }
        if (created) this.db.save();
        return created;
    }
}

module.exports = { AccountsService, AccountError, ACCOUNT_TYPES, ROLE_FOR_TYPE };
