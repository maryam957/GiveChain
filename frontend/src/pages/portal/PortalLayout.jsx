import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { ACCOUNT_LABELS, useAuth } from "../../context/AuthContext";
import { useWalletState } from "../../components/Wallet";
import { shortAddress } from "../../lib/format";

/** Sidebar entries for each account type. */
export const NAV = {
    admin: [
        ["/app", "Overview", true],
        ["/app/applications", "Applications"],
        ["/app/people", "People and roles"],
        ["/app/system", "System"],
    ],
    ngo: [
        ["/app", "Overview", true],
        ["/app/campaigns", "My campaigns"],
    ],
    verifier: [
        ["/app", "Overview", true],
        ["/app/review", "Review queue"],
    ],
    donor: [
        ["/app", "Overview", true],
        ["/app/donations", "My donations"],
        ["/campaigns", "Find campaigns"],
    ],
    beneficiary: [
        ["/app", "Overview", true],
        ["/app/assistance", "My assistance"],
        ["/campaigns", "Find campaigns"],
    ],
};

const WALLET_TEXT = {
    ready: ["ok", "Wallet connected"],
    "not-linked": ["warn", "Wallet not linked"],
    "no-metamask": ["warn", "MetaMask not installed"],
    "not-connected": ["warn", "MetaMask not connected"],
    "wrong-account": ["bad", "Wrong MetaMask account"],
    "wrong-network": ["bad", "Wrong network"],
};

export default function PortalLayout() {
    const { user, loading } = useAuth();
    const location = useLocation();
    const walletState = useWalletState();

    if (loading) return <main className="container main"><p className="muted">Loading…</p></main>;
    if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

    const [tone, text] = WALLET_TEXT[walletState] || ["warn", ""];
    return (
        <div className="container portal">
            <aside className="sidebar">
                <div className="sidebar-user">
                    <strong>{user.name}</strong>
                    <span className="badge badge-blue">{ACCOUNT_LABELS[user.accountType]}</span>
                    <NavLink to="/app/profile" className={`wallet-status wallet-${tone}`}>
                        <span className="dot" />
                        {text}
                        {user.wallet && <code>{shortAddress(user.wallet)}</code>}
                    </NavLink>
                </div>
                <nav className="sidebar-nav">
                    {(NAV[user.accountType] || []).map(([to, label, end]) => (
                        <NavLink key={to} to={to} end={end}>
                            {label}
                        </NavLink>
                    ))}
                    <NavLink to="/app/profile">Profile and wallet</NavLink>
                </nav>
            </aside>
            <section className="portal-content">
                <Outlet />
            </section>
        </div>
    );
}

/**
 * Shows its children only to an approved NGO / verifier / admin (role confirmed on-chain);
 * otherwise explains where the application stands.
 */
export function RequireApproved({ type, children }) {
    const { user, approved } = useAuth();
    if (user.accountType !== type) {
        return (
            <div className="card">
                <h2>Not available</h2>
                <p>This page is for {ACCOUNT_LABELS[type]} accounts.</p>
            </div>
        );
    }
    if (approved) return children;
    return <ApprovalStatus />;
}

export function ApprovalStatus() {
    const { user } = useAuth();
    const app = user.roleApplication;
    if (!user.wallet) {
        return (
            <div className="card">
                <h2>Step 1: link your wallet</h2>
                <p>
                    Before the admin can approve you, link the MetaMask wallet your organisation will use. Your role is granted
                    to that wallet on the blockchain.
                </p>
                <NavLink to="/app/profile" className="button">
                    Link my wallet
                </NavLink>
            </div>
        );
    }
    if (app?.status === "rejected") {
        return (
            <div className="card">
                <h2>Your application was not approved</h2>
                {app.reviewNote && (
                    <p>
                        Admin's note: <em>{app.reviewNote}</em>
                    </p>
                )}
                <p>You can update your organisation's details and apply again from your profile.</p>
                <NavLink to="/app/profile" className="button">
                    Update and re-apply
                </NavLink>
            </div>
        );
    }
    if (user.accountType === "admin") {
        return (
            <div className="card">
                <h2>Admin role not found on-chain</h2>
                <p>This account's wallet does not hold the admin role in the GiveChain contracts.</p>
            </div>
        );
    }
    return (
        <div className="card">
            <h2>Waiting for approval</h2>
            <p>
                The GiveChain admin is reviewing <strong>{app?.organisationName}</strong>. When they approve, your wallet receives
                the {ACCOUNT_LABELS[user.accountType]} role on the blockchain and your tools appear here automatically.
            </p>
            <p className="small muted">Submitted {app ? new Date(app.createdAt).toLocaleString() : ""}</p>
        </div>
    );
}
