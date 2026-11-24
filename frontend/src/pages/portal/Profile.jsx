import { useState } from "react";
import { ethers } from "ethers";
import { api } from "../../lib/api";
import { useWeb3 } from "../../context/Web3Context";
import { ACCOUNT_LABELS, useAuth } from "../../context/AuthContext";
import { LinkWalletButton, useWalletState, WalletGate } from "../../components/Wallet";
import { Amount, Section, StatusBadge } from "../../components/ui";
import { FaucetButton } from "../Campaign";
import { ApprovalStatus } from "./PortalLayout";

function Details() {
    const { user, setUser } = useAuth();
    const [form, setForm] = useState({ name: user.name, phone: user.phone || "" });
    const [message, setMessage] = useState(null);
    const save = async (e) => {
        e.preventDefault();
        setMessage(null);
        try {
            setUser(await api.updateProfile(form));
            setMessage({ ok: true, text: "Saved." });
        } catch (err) {
            setMessage({ ok: false, text: err.message });
        }
    };
    return (
        <Section title="Your details">
            <form className="form" onSubmit={save}>
                <div className="grid-2 tight">
                    <label>
                        Full name
                        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </label>
                    <label>
                        Phone
                        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    </label>
                    <label>
                        Email
                        <input value={user.email} disabled />
                    </label>
                    <label>
                        Account type
                        <input value={ACCOUNT_LABELS[user.accountType]} disabled />
                    </label>
                </div>
                {message && <p className={message.ok ? "verified" : "error-note"}>{message.text}</p>}
                <div>
                    <button className="button">Save</button>
                </div>
            </form>
        </Section>
    );
}

function WalletCard() {
    const { user } = useAuth();
    const { balance, ethBalance, account } = useWeb3();
    const state = useWalletState();
    const roles = Object.entries(user.chainRoles || {})
        .filter(([, v]) => v)
        .map(([k]) => (k === "verifier" ? "Verifier" : k === "ngo" ? "NGO" : k[0].toUpperCase() + k.slice(1)));

    return (
        <Section title="Your wallet">
            {!user.wallet ? (
                <>
                    <p>
                        Link the MetaMask wallet you will use with GiveChain. You will sign a short message to prove it is yours;
                        this does not cost anything or send a transaction.
                    </p>
                    <LinkWalletButton />
                </>
            ) : (
                <>
                    <dl className="facts">
                        <dt>Linked wallet</dt>
                        <dd>
                            <code>{user.wallet}</code>
                        </dd>
                        <dt>Roles on the blockchain</dt>
                        <dd>{roles.length ? roles.join(", ") : "none (donors and beneficiaries need no role)"}</dd>
                    </dl>
                    <WalletGate action="see your balances">
                        <dl className="facts">
                            <dt>Test dollars</dt>
                            <dd>
                                <Amount value={balance} />
                            </dd>
                            <dt>ETH for transaction fees</dt>
                            <dd>{Number(ethers.formatEther(ethBalance)).toFixed(4)} ETH</dd>
                        </dl>
                        {ethBalance === 0n && (
                            <p className="notice">
                                This wallet has no ETH, so it cannot pay transaction fees. On the local test chain, send it some
                                test ETH from another MetaMask account.
                            </p>
                        )}
                        <div className="row">
                            <FaucetButton />
                        </div>
                    </WalletGate>
                    {state === "wrong-account" && (
                        <div className="stack">
                            <p className="small muted">
                                Want to use the connected wallet <code>{account}</code> instead? Re-link it (your on-chain
                                roles stay with the old wallet).
                            </p>
                            <LinkWalletButton label="Link the connected wallet instead" className="button secondary" />
                        </div>
                    )}
                </>
            )}
        </Section>
    );
}

function RoleApplication() {
    const { user, setUser, approved } = useAuth();
    const app = user.roleApplication;
    const [form, setForm] = useState({
        organisationName: app?.organisationName || "",
        registrationNumber: app?.registrationNumber || "",
        country: app?.country || "",
        website: app?.website || "",
        description: app?.description || "",
    });
    const [error, setError] = useState(null);
    if (!["ngo", "verifier"].includes(user.accountType)) return null;

    const resubmit = async (e) => {
        e.preventDefault();
        setError(null);
        try {
            await api.resubmitRoleApplication(form);
            setUser(await api.me());
        } catch (err) {
            setError(err.message);
        }
    };
    const set = (f) => (e) => setForm({ ...form, [f]: e.target.value });

    return (
        <Section
            title={
                <>
                    Organisation <StatusBadge status={approved ? "Approved" : app?.status === "rejected" ? "Rejected" : "Submitted"} />
                </>
            }
        >
            {!approved && <ApprovalStatus />}
            {app?.status === "rejected" ? (
                <form className="form" onSubmit={resubmit}>
                    <div className="grid-2 tight">
                        <label>
                            Organisation name
                            <input value={form.organisationName} onChange={set("organisationName")} />
                        </label>
                        <label>
                            Registration number
                            <input value={form.registrationNumber} onChange={set("registrationNumber")} />
                        </label>
                        <label>
                            Country
                            <input value={form.country} onChange={set("country")} />
                        </label>
                        <label>
                            Website
                            <input value={form.website} onChange={set("website")} />
                        </label>
                    </div>
                    <label>
                        What does your organisation do?
                        <textarea value={form.description} onChange={set("description")} rows={3} />
                    </label>
                    {error && <p className="error-note">{error}</p>}
                    <div>
                        <button className="button">Send updated application</button>
                    </div>
                </form>
            ) : (
                app && (
                    <dl className="facts">
                        <dt>Organisation</dt>
                        <dd>{app.organisationName}</dd>
                        <dt>Registration number</dt>
                        <dd>{app.registrationNumber || "-"}</dd>
                        <dt>Country</dt>
                        <dd>{app.country || "-"}</dd>
                        <dt>Website</dt>
                        <dd>{app.website || "-"}</dd>
                        <dt>Description</dt>
                        <dd>{app.description}</dd>
                    </dl>
                )
            )}
        </Section>
    );
}

function Password() {
    const [form, setForm] = useState({ current: "", next: "", confirm: "" });
    const [message, setMessage] = useState(null);
    const submit = async (e) => {
        e.preventDefault();
        setMessage(null);
        if (form.next !== form.confirm) return setMessage({ ok: false, text: "The new passwords do not match." });
        try {
            await api.changePassword(form.current, form.next);
            setForm({ current: "", next: "", confirm: "" });
            setMessage({ ok: true, text: "Password changed. Other devices were logged out." });
        } catch (err) {
            setMessage({ ok: false, text: err.message });
        }
    };
    const set = (f) => (e) => setForm({ ...form, [f]: e.target.value });
    return (
        <Section title="Change password">
            <form className="form" onSubmit={submit}>
                <div className="grid-3 tight">
                    <label>
                        Current password
                        <input type="password" autoComplete="current-password" value={form.current} onChange={set("current")} />
                    </label>
                    <label>
                        New password
                        <input type="password" autoComplete="new-password" value={form.next} onChange={set("next")} />
                    </label>
                    <label>
                        Repeat new password
                        <input type="password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} />
                    </label>
                </div>
                {message && <p className={message.ok ? "verified" : "error-note"}>{message.text}</p>}
                <div>
                    <button className="button secondary">Change password</button>
                </div>
            </form>
        </Section>
    );
}

export default function Profile() {
    return (
        <>
            <div className="page-head">
                <h1>Profile and wallet</h1>
            </div>
            <WalletCard />
            <RoleApplication />
            <Details />
            <Password />
        </>
    );
}
