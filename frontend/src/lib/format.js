import { ethers } from "ethers";

export const DECIMALS = 6;
export const SYMBOL = "mUSDC";

/** "1500000000" or 1500000000n -> "1,500" (up to 2 decimals). */
export function formatAmount(value, { symbol = false } = {}) {
    if (value === null || value === undefined) return "-";
    const n = Number(ethers.formatUnits(BigInt(value), DECIMALS));
    const text = n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    return symbol ? `${text} ${SYMBOL}` : text;
}

/** User input like "12.5" -> bigint units, or null if invalid / not positive. */
export function parseAmount(text) {
    try {
        const trimmed = String(text).trim();
        if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
        const units = ethers.parseUnits(trimmed, DECIMALS);
        return units > 0n ? units : null;
    } catch {
        return null;
    }
}

export const shortAddress = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "-");
export const shortHash = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "-");
export const shortCid = (c) => (c ? `${c.slice(0, 10)}…${c.slice(-6)}` : "-");

export function formatDate(seconds) {
    if (!seconds) return "-";
    return new Date(Number(seconds) * 1000).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export const sameAddress = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();

export function percent(part, whole) {
    const p = BigInt(part || 0);
    const w = BigInt(whole || 0);
    if (w === 0n) return 0;
    return Math.min(100, Number((p * 10000n) / w) / 100);
}

/** Block explorer link for public networks; null on a local chain. */
export function explorerTxUrl(chainId, hash) {
    if (Number(chainId) === 11155111) return `https://sepolia.etherscan.io/tx/${hash}`;
    return null;
}
