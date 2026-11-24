// Password hashing with scrypt (built into Node.js). Only the hash and a random salt
// are stored; the password itself is never saved or logged.

const crypto = require("crypto");

const KEY_LENGTH = 64;
const PARAMS = { N: 16384, r: 8, p: 1 };

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, KEY_LENGTH, PARAMS).toString("hex");
    return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
    const [scheme, salt, hash] = String(stored || "").split("$");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, KEY_LENGTH, PARAMS);
    const expected = Buffer.from(hash, "hex");
    return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

/** Returns an error message, or null if the password is acceptable. */
function passwordProblem(password) {
    if (typeof password !== "string" || password.length < 8) return "Password must be at least 8 characters.";
    if (password.length > 200) return "Password is too long.";
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Password must contain letters and numbers.";
    return null;
}

module.exports = { hashPassword, verifyPassword, passwordProblem };
