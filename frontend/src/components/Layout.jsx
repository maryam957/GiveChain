import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useWeb3 } from "../context/Web3Context";
import { ACCOUNT_LABELS, useAuth } from "../context/AuthContext";
import { useTx } from "../context/TxContext";
import { shortAddress } from "../lib/format";
import { TxHash } from "./ui";

const STATUS_TEXT = {
    signing: "Confirm in MetaMask",
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
                    Cannot reach the GiveChain server ({w.configError}). Make sure the blockchain, contracts and backend are
                    running. Retrying…
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
                    MetaMask is on the wrong network (chain {w.walletChainId}). GiveChain runs on chain {w.config?.chainId}.{" "}
                    <button type="button" className="link-button" onClick={() => w.switchNetwork().catch(() => {})}>
                        Switch network
                    </button>
                </div>
            )}
        </>
    );
}

function UserMenu() {
    const { user, logout } = useAuth();
    const { account } = useWeb3();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const navigate = useNavigate();

    useEffect(() => {
        const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, []);

    const initials = user.name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();

    return (
        <div className="user-menu" ref={ref}>
            <button type="button" className="user-button" onClick={() => setOpen(!open)}>
                <span className="avatar">{initials}</span>
                <span className="user-button-text">
                    <span>{user.name}</span>
                    <span className="small muted">{ACCOUNT_LABELS[user.accountType]}</span>
                </span>
            </button>
            {open && (
                <div className="menu">
                    <div className="menu-head">
                        <strong>{user.name}</strong>
                        <span className="small muted">{user.email}</span>
                        <span className="small">
                            Wallet: {user.wallet ? <code>{shortAddress(user.wallet)}</code> : <em>not linked</em>}
                            {account && user.wallet && account.toLowerCase() === user.wallet.toLowerCase() && (
                                <span className="dot-ok" title="Connected in MetaMask" />
                            )}
                        </span>
                    </div>
                    <Link to="/app" onClick={() => setOpen(false)}>
                        My portal
                    </Link>
                    <Link to="/app/profile" onClick={() => setOpen(false)}>
                        Profile and wallet
                    </Link>
                    <button
                        type="button"
                        onClick={async () => {
                            setOpen(false);
                            await logout();
                            navigate("/");
                        }}
                    >
                        Log out
                    </button>
                </div>
            )}
        </div>
    );
}

function Header() {
    const { user } = useAuth();
    return (
        <header className="header">
            <div className="container header-inner">
                <NavLink to="/" className="brand">
                    <span className="brand-mark">✓</span> <span>GiveChain</span>
                </NavLink>
                <nav className="nav">
                    <NavLink to="/campaigns">Campaigns</NavLink>
                    <NavLink to="/transparency">Transparency</NavLink>
                    <NavLink to="/how-it-works">How it works</NavLink>
                </nav>
                <div className="header-actions">
                    {user ? (
                        <>
                            <NavLink to="/app" className="button small">
                                My portal
                            </NavLink>
                            <UserMenu />
                        </>
                    ) : (
                        <>
                            <NavLink to="/login" className="button secondary small">
                                Log in
                            </NavLink>
                            <NavLink to="/signup" className="button small">
                                Sign up
                            </NavLink>
                        </>
                    )}
                </div>
            </div>
        </header>
    );
}

/** Frame for every page: header, warning banners, content, footer, transaction notifications. */
export default function Layout() {
    return (
        <div className="app">
            <Header />
            <Banners />
            <Outlet />
            <footer className="footer">
                <div className="container small muted">
                    GiveChain university prototype · test tokens only (mUSDC has no value) · every amount comes from the
                    blockchain; the server only indexes it.
                </div>
            </footer>
            <Toasts />
        </div>
    );
}
