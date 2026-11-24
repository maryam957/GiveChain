// Small shared UI pieces.

import { useState } from "react";
import { ipfsUrl } from "../lib/api";
import { DEMO_ACCOUNT_LABELS, useWeb3 } from "../context/Web3Context";
import {
    explorerTxUrl,
    formatAmount,
    percent,
    shortAddress,
    shortCid,
    shortHash,
    SYMBOL,
} from "../lib/format";

const STATUS_TONE = {
    Active: "green",
    Completed: "blue",
    Cancelled: "grey",
    Registered: "amber",
    Approved: "green",
    Revoked: "red",
    Submitted: "amber",
    Rejected: "red",
    Released: "blue",
    Confirmed: "green",
};

export function StatusBadge({ status }) {
    return <span className={`badge badge-${STATUS_TONE[status] || "grey"}`}>{status}</span>;
}

export function Amount({ value, symbol = true }) {
    return (
        <span className="amount">
            {formatAmount(value)}
            {symbol && <span className="amount-symbol"> {SYMBOL}</span>}
        </span>
    );
}

/** Shows a short address, with the demo role name when it is a known demo account. */
export function Address({ value }) {
    const { demoAccounts, account } = useWeb3();
    const index = demoAccounts.findIndex((a) => a.toLowerCase() === value?.toLowerCase());
    const label = index >= 0 ? DEMO_ACCOUNT_LABELS[index] : null;
    const isMe = account && value && account.toLowerCase() === value.toLowerCase();
    return (
        <span className="address" title={value}>
            <code>{shortAddress(value)}</code>
            {label && <span className="address-label">{label}</span>}
            {isMe && <span className="address-me">you</span>}
        </span>
    );
}

export function TxHash({ hash }) {
    const { config } = useWeb3();
    const [copied, setCopied] = useState(false);
    if (!hash) return null;
    const url = explorerTxUrl(config?.chainId, hash);
    const copy = () => {
        navigator.clipboard?.writeText(hash);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
    };
    return (
        <span className="txhash" title={hash}>
            {url ? (
                <a href={url} target="_blank" rel="noreferrer">
                    <code>{shortHash(hash)}</code>
                </a>
            ) : (
                <code>{shortHash(hash)}</code>
            )}
            <button type="button" className="link-button" onClick={copy}>
                {copied ? "copied" : "copy"}
            </button>
        </span>
    );
}

export function Evidence({ cid, label = "View evidence" }) {
    if (!cid) return null;
    return (
        <a className="evidence" href={ipfsUrl(cid)} target="_blank" rel="noreferrer" title={cid}>
            {label} <code>{shortCid(cid)}</code>
        </a>
    );
}

export function Progress({ value, max }) {
    const p = percent(value, max);
    return (
        <div className="progress" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-bar" style={{ width: `${p}%` }} />
        </div>
    );
}

export function Stat({ label, value, hint }) {
    return (
        <div className="stat">
            <div className="stat-label">{label}</div>
            <div className="stat-value">{value}</div>
            {hint && <div className="stat-hint">{hint}</div>}
        </div>
    );
}

export function Empty({ children }) {
    return <p className="empty">{children}</p>;
}

export function Loading() {
    return <p className="muted">Loading…</p>;
}

export function ErrorNote({ error }) {
    if (!error) return null;
    return <p className="error-note">{error.message || String(error)}</p>;
}

export function Section({ title, actions, children }) {
    return (
        <section className="card">
            {(title || actions) && (
                <div className="card-head">
                    {title && <h2>{title}</h2>}
                    {actions && <div className="card-actions">{actions}</div>}
                </div>
            )}
            {children}
        </section>
    );
}
