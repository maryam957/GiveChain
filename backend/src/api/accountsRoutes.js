// HTTP routes for accounts, wallet linking and applications.
//
// Sessions use an HttpOnly, SameSite=Lax cookie holding a random token; only a hash
// of the token is stored. JavaScript in the page cannot read the cookie, and other
// sites cannot send it with a cross-site POST.

const express = require("express");
const { AccountError } = require("../accounts/accountsService");

const COOKIE = "gc_session";
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function readCookie(req, name) {
    const header = req.headers.cookie || "";
    for (const part of header.split(";")) {
        const [key, ...rest] = part.trim().split("=");
        if (key === name) return decodeURIComponent(rest.join("="));
    }
    return null;
}

function setSessionCookie(res, token, { secure }) {
    const attrs = [`${COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${7 * 86400}`];
    if (secure) attrs.push("Secure");
    res.setHeader("Set-Cookie", attrs.join("; "));
}

function clearSessionCookie(res) {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Simple in-memory limiter for login attempts, per email and per IP. */
function createLoginLimiter() {
    const attempts = new Map();
    return {
        check(key) {
            const list = (attempts.get(key) || []).filter((t) => Date.now() - t < LOGIN_WINDOW_MS);
            attempts.set(key, list);
            if (list.length >= LOGIN_MAX_ATTEMPTS) {
                throw new AccountError(429, "Too many login attempts. Wait 15 minutes and try again.");
            }
        },
        fail(key) {
            attempts.set(key, [...(attempts.get(key) || []), Date.now()]);
        },
        reset(key) {
            attempts.delete(key);
        },
    };
}

/**
 * @param {object} deps
 * @param {import("../accounts/accountsService").AccountsService} deps.accounts
 * @param {boolean} [deps.secureCookies]
 */
function createAccountsRouter({ accounts, secureCookies = false }) {
    const router = express.Router();
    const limiter = createLoginLimiter();

    const route = (handler) => async (req, res, next) => {
        try {
            const result = await handler(req, res);
            if (result !== undefined) res.json(result);
        } catch (err) {
            next(err);
        }
    };

    // Attaches req.user when a valid session cookie is present.
    router.use((req, res, next) => {
        req.sessionToken = readCookie(req, COOKIE);
        req.user = accounts.userForSession(req.sessionToken);
        next();
    });

    const requireUser = (req) => {
        if (!req.user) throw new AccountError(401, "Please log in.");
        return req.user;
    };
    const requireAdmin = (req) => {
        const user = requireUser(req);
        if (user.accountType !== "admin" || !accounts.userHasChainRole(user, "admin")) {
            throw new AccountError(403, "Only the GiveChain admin can do this.");
        }
        return user;
    };

    // ------------------------------------------------------------------ auth

    router.post("/auth/signup", route((req, res) => {
        const user = accounts.signup(req.body || {});
        setSessionCookie(res, accounts.createSession(user), { secure: secureCookies });
        res.status(201);
        return accounts.publicUser(user);
    }));

    router.post("/auth/login", route((req, res) => {
        const email = String(req.body?.email || "").toLowerCase();
        const keys = [`email:${email}`, `ip:${req.ip}`];
        keys.forEach((k) => limiter.check(k));
        let user;
        try {
            user = accounts.login(email, req.body?.password);
        } catch (err) {
            keys.forEach((k) => limiter.fail(k));
            throw err;
        }
        limiter.reset(`email:${email}`);
        setSessionCookie(res, accounts.createSession(user), { secure: secureCookies });
        return accounts.publicUser(user);
    }));

    router.post("/auth/logout", route((req, res) => {
        if (req.sessionToken) accounts.deleteSession(req.sessionToken);
        clearSessionCookie(res);
        return { ok: true };
    }));

    router.get("/auth/me", route((req) => (req.user ? accounts.publicUser(req.user) : null)));

    router.patch("/auth/profile", route((req) => accounts.publicUser(accounts.updateProfile(requireUser(req), req.body || {}))));

    router.post("/auth/password", route((req) => {
        accounts.changePassword(requireUser(req), req.body?.currentPassword, req.body?.newPassword);
        return { ok: true };
    }));

    router.post("/auth/wallet/challenge", route((req) => ({ message: accounts.walletChallenge(requireUser(req)) })));

    router.post("/auth/wallet/link", route((req) =>
        accounts.publicUser(accounts.linkWallet(requireUser(req), req.body || {}))
    ));

    router.post("/auth/role-application", route((req) =>
        accounts.resubmitRoleApplication(requireUser(req), req.body || {})
    ));

    // ------------------------------------------------------------------ public names

    router.get("/profiles", route(() => accounts.publicProfiles()));

    // ------------------------------------------------------------------ admin

    router.get("/admin/role-applications", route((req) => {
        requireAdmin(req);
        return accounts.listRoleApplications(req.query.status);
    }));

    router.post("/admin/role-applications/:id/reject", route((req) =>
        accounts.rejectRoleApplication(req.params.id, requireAdmin(req), req.body?.note)
    ));

    router.get("/admin/users", route((req) => {
        requireAdmin(req);
        return accounts.listUsers();
    }));

    // ------------------------------------------------------------------ beneficiary applications

    router.post("/campaigns/:id/applications", route((req, res) => {
        res.status(201);
        return accounts.applyToCampaign(requireUser(req), req.params.id, req.body || {});
    }));

    router.get("/campaigns/:id/applications", route((req) =>
        accounts.campaignApplications(requireUser(req), req.params.id)
    ));

    router.get("/my/applications", route((req) => accounts.myBeneficiaryApplications(requireUser(req))));

    router.post("/beneficiary-applications/:id/decline", route((req) =>
        accounts.declineBeneficiaryApplication(requireUser(req), req.params.id, req.body?.note)
    ));

    return router;
}

module.exports = { createAccountsRouter, COOKIE };
