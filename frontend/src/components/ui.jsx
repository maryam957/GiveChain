// Small shared UI pieces.

import { useState } from "react";
import { ipfsUrl } from "../lib/api";
import { useWeb3 } from "../context/Web3Context";
import { useAuth } from "../context/AuthContext";
import { useProfiles } from "../context/ProfilesContext";
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

/** Short address, with the organisation's public name when it has one. */
export function Address({ value }) {
    const { byWallet } = useProfiles();
    const { user } = useAuth();
    const profile = value ? byWallet.get(value.toLowerCase()) : null;
    const isMe = user?.wallet && value && user.wallet.toLowerCase() === value.toLowerCase();
    return (
        <span className="address" title={value}>
            {profile && (
                <span className="address-label">
                    {profile.organisation || profile.name}
                    {profile.verified && <span className="tick" title="Role verified on-chain"> ✓</span>}
                </span>
            )}
            <code>{shortAddress(value)}</code>
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

/** Standard page container for public pages. */
export function Page({ children }) {
    return <main className="container main">{children}</main>;
}

/** Page title with an optional subtitle and action buttons. */
export function PageHead({ title, subtitle, actions }) {
    return (
        <div className="page-head">
            <div>
                <h1>{title}</h1>
                {subtitle && <p className="muted">{subtitle}</p>}
            </div>
            {actions && <div className="row">{actions}</div>}
        </div>
    );
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
