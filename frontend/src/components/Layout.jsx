import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { DEMO_ACCOUNT_LABELS, useWeb3 } from "../context/Web3Context";
import { useTx } from "../context/TxContext";
import { Address, Amount, TxHash } from "./ui";

function WalletButton() {
    const w = useWeb3();
    const [open, setOpen] = useState(false);
    const [error, setError] = useState(null);
    const ref = useRef(null);

    useEffect(() => {
        const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, []);

    const attempt = async (fn) => {
        setError(null);
        try {
            await fn();
            setOpen(false);
        } catch (err) {
            setError(err.message);
        }
    };

    const roleNames = Object.entries(w.roles)
        .filter(([, has]) => has)
        .map(([name]) => name);

    return (
        <div className="wallet" ref={ref}>
            <button type="button" className={w.account ? "wallet-button connected" : "wallet-button"} onClick={() => setOpen(!open)}>
                {w.account ? (
                    <>
                        <span className="dot" />
                        <code>{w.account.slice(0, 6)}…{w.account.slice(-4)}</code>
                    </>
                ) : (
                    "Connect wallet"
                )}
            </button>
            {open && (
                <div className="wallet-menu">
                    {w.account ? (
                        <>
                            <div className="wallet-row">
                                <Address value={w.account} />
                            </div>
                            <div className="wallet-row muted small">
                                {w.walletMode === "demo" ? "Demo account (local chain)" : "MetaMask"} ·{" "}
                                {roleNames.length ? roleNames.join(", ") : "no special role"}
                            </div>
                            <div className="wallet-row">
                                Balance: <Amount value={w.balance} />
                            </div>
                            <button type="button" className="button secondary full" onClick={() => attempt(async () => w.disconnect())}>
                                Disconnect
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                type="button"
                                className="button full"
                                disabled={!w.hasMetaMask || !w.config}
                                onClick={() => attempt(w.connectMetaMask)}
                            >
                                Connect MetaMask
                            </button>
                            {!w.hasMetaMask && <p className="small muted">MetaMask is not installed in this browser.</p>}
                        </>
                    )}
                    {w.isLocal && w.demoAccounts.length > 0 && (
                        <div className="demo-accounts">
                            <div className="small muted">Demo accounts (local chain only)</div>
                            {w.demoAccounts.map((address, i) => (
                                <button
                                    type="button"
                                    key={address}
                                    className={`demo-account ${w.account === address ? "active" : ""}`}
                                    onClick={() => attempt(() => w.connectDemo(address))}
                                >
                                    <span>{DEMO_ACCOUNT_LABELS[i]}</span>
                                    <code>{address.slice(0, 6)}…{address.slice(-4)}</code>
                                </button>
                            ))}
                        </div>
                    )}
                    {error && <p className="error-note">{error}</p>}
                </div>
            )}
        </div>
    );
}

const STATUS_TEXT = {
    signing: "Confirm in wallet",
    pending: "Pending",
    confirmed: "Confirmed",
    rejected: "Rejected",
    failed: "Failed",
};

function Toasts() {
    const { toasts, dismiss } = useTx();
    return (
        <div className="toasts" aria-live="polite">
            {toasts.map((t) => (
                <div key={t.id} className={`toast toast-${t.status}`}>
                    <div className="toast-head">
                        <span className="toast-status">
                            {(t.status === "signing" || t.status === "pending") && <span className="spinner" />}
                            {STATUS_TEXT[t.status]}
                        </span>
                        {t.status !== "signing" && t.status !== "pending" && (
                            <button type="button" className="link-button" onClick={() => dismiss(t.id)}>
                                close
                            </button>
                        )}
                    </div>
                    <div className="toast-label">{t.label}</div>
                    <div className="toast-message">{t.message}</div>
                    {t.hash && (
                        <div className="small">
                            Tx: <TxHash hash={t.hash} />
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

function Banners() {
    const w = useWeb3();
    return (
        <>
            {w.configError && (
                <div className="banner banner-red">
                    Cannot reach the GiveChain backend ({w.configError}). Start it with <code>npm run backend</code>, after
                    deploying the contracts. Retrying…
                </div>
            )}
            {w.paused && (
                <div className="banner banner-red">
                    GiveChain is <strong>paused</strong> for an emergency. All transactions are blocked; you can still view
                    everything.
                </div>
            )}
            {w.wrongNetwork && (
                <div className="banner banner-amber">
                    Your wallet is on the wrong network (chain {w.walletChainId}). GiveChain runs on chain {w.config?.chainId}.{" "}
                    <button type="button" className="link-button" onClick={() => w.switchMetaMaskNetwork().catch(() => {})}>
                        Switch network
                    </button>
                </div>
            )}
        </>
    );
}

export default function Layout() {
    return (
        <div className="app">
            <header className="header">
                <div className="container header-inner">
                    <NavLink to="/" className="brand">
                        <span className="brand-mark">✓</span> GiveChain
                    </NavLink>
                    <nav className="nav">
                        <NavLink to="/" end>
                            Campaigns
                        </NavLink>
                        <NavLink to="/transparency">Transparency</NavLink>
                        <NavLink to="/dashboard">My dashboard</NavLink>
                    </nav>
                    <WalletButton />
                </div>
            </header>
            <Banners />
            <main className="container main">
                <Outlet />
            </main>
            <footer className="footer container small muted">
                GiveChain university prototype. Test tokens only (mUSDC has no value). Every amount on this site comes from
                the blockchain; the backend only indexes it.
            </footer>
            <Toasts />
        </div>
    );
}
