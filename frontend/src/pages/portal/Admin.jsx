import { useState } from "react";
import { ethers } from "ethers";
import { api } from "../../lib/api";
import { useData } from "../../lib/useData";
import { formatDate } from "../../lib/format";
import { useWeb3 } from "../../context/Web3Context";
import { ACCOUNT_LABELS } from "../../context/AuthContext";
import { useTx } from "../../context/TxContext";
import { WalletGate } from "../../components/Wallet";
import { Empty, ErrorNote, Loading, Section, StatusBadge } from "../../components/ui";
import { RequireApproved } from "./PortalLayout";

export const ROLE_IDS = {
    ngo: ethers.id("NGO_ROLE"),
    verifier: ethers.id("AUDITOR_ROLE"),
    pauser: ethers.id("PAUSER_ROLE"),
};

function ApplicationCard({ app }) {
    const { contracts, refresh } = useWeb3();
    const { runTx } = useTx();
    const [rejecting, setRejecting] = useState(false);
    const [note, setNote] = useState("");
    const [error, setError] = useState(null);
    const wallet = app.applicant?.wallet;

    const approve = () =>
        runTx(`Grant the ${ACCOUNT_LABELS[app.role]} role to ${app.organisationName}`, () =>
            contracts.GiveChainAccess.grantRole(ROLE_IDS[app.role], wallet)
        );
    const reject = async () => {
        setError(null);
        try {
            await api.rejectRoleApplication(app.id, note);
            setRejecting(false);
            refresh();
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <div className="item-card">
            <div className="item-card-head">
                <div>
                    <strong>{app.organisationName}</strong>{" "}
                    <span className="badge badge-blue">{ACCOUNT_LABELS[app.role]}</span>
                </div>
                <StatusBadge status={app.status === "pending" ? "Submitted" : app.status[0].toUpperCase() + app.status.slice(1)} />
            </div>
            <dl className="facts">
                <dt>Applicant</dt>
                <dd>
                    {app.applicant?.name} · {app.applicant?.email}
                </dd>
                <dt>Wallet</dt>
                <dd>{wallet ? <code>{wallet}</code> : <em>not linked yet; cannot be approved until they link it</em>}</dd>
                <dt>Registration no.</dt>
                <dd>{app.registrationNumber || "-"}</dd>
                <dt>Country</dt>
                <dd>{app.country || "-"}</dd>
                <dt>Website</dt>
                <dd>{app.website || "-"}</dd>
                <dt>About</dt>
                <dd>{app.description}</dd>
                <dt>Applied</dt>
                <dd>{formatDate(Date.parse(app.createdAt) / 1000)}</dd>
                {app.reviewNote && (
                    <>
                        <dt>Note</dt>
                        <dd>{app.reviewNote}</dd>
                    </>
                )}
            </dl>
            {app.status === "pending" && (
                <WalletGate action="approve applications">
                    {rejecting ? (
                        <div className="form">
                            <label>
                                Reason (shown to the applicant)
                                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
                            </label>
                            {error && <p className="error-note">{error}</p>}
                            <div className="row">
                                <button type="button" className="button danger" onClick={reject}>
                                    Reject application
                                </button>
                                <button type="button" className="button secondary" onClick={() => setRejecting(false)}>
                                    Back
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="row">
                            <button type="button" className="button" disabled={!wallet} onClick={approve}>
                                Approve and grant role on-chain
                            </button>
                            <button type="button" className="button danger" onClick={() => setRejecting(true)}>
                                Reject
                            </button>
                        </div>
                    )}
                </WalletGate>
            )}
        </div>
    );
}

export function AdminApplications() {
    const [status, setStatus] = useState("pending");
    const { data, error } = useData(() => api.roleApplications(status), [status]);
    return (
        <RequireApproved type="admin">
            <div className="page-head">
                <div>
                    <h1>Applications</h1>
                    <p className="muted">NGOs and verifiers who want to join. Approving grants their role on the blockchain.</p>
                </div>
            </div>
            <div className="segmented">
                {["pending", "approved", "rejected"].map((s) => (
                    <button key={s} type="button" className={s === status ? "active" : ""} onClick={() => setStatus(s)}>
                        {s[0].toUpperCase() + s.slice(1)}
                    </button>
                ))}
            </div>
            <ErrorNote error={error} />
            {!data ? <Loading /> : data.length === 0 ? <Empty>No {status} applications.</Empty> : data.map((a) => <ApplicationCard key={a.id} app={a} />)}
        </RequireApproved>
    );
}

export function AdminPeople() {
    const { contracts } = useWeb3();
    const { runTx } = useTx();
    const { data, error } = useData(() => api.users());

    const revoke = (u, role) => {
        if (!window.confirm(`Remove the ${ACCOUNT_LABELS[role]} role from ${u.name}? They will lose access to their tools.`)) return;
        runTx(`Remove ${ACCOUNT_LABELS[role]} role from ${u.name}`, () => contracts.GiveChainAccess.revokeRole(ROLE_IDS[role], u.wallet));
    };

    return (
        <RequireApproved type="admin">
            <div className="page-head">
                <div>
                    <h1>People and roles</h1>
                    <p className="muted">Every GiveChain account. Roles are read live from the blockchain.</p>
                </div>
            </div>
            <ErrorNote error={error} />
            {!data ? (
                <Loading />
            ) : (
                <Section>
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Account</th>
                                <th>Wallet</th>
                                <th>On-chain roles</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {data.map((u) => {
                                const roles = Object.entries(u.chainRoles).filter(([, v]) => v).map(([k]) => k);
                                return (
                                    <tr key={u.id}>
                                        <td>
                                            <strong>{u.name}</strong>
                                            <div className="small muted">{u.email}</div>
                                        </td>
                                        <td>{ACCOUNT_LABELS[u.accountType]}</td>
                                        <td>{u.wallet ? <code>{u.wallet.slice(0, 8)}…{u.wallet.slice(-4)}</code> : <em className="muted">none</em>}</td>
                                        <td>{roles.length ? roles.map((r) => <span key={r} className="badge badge-green">{r}</span>) : <span className="muted">-</span>}</td>
                                        <td>
                                            <WalletGate action="change roles">
                                                <div className="row">
                                                    {u.chainRoles.ngo && (
                                                        <button type="button" className="button danger small" onClick={() => revoke(u, "ngo")}>
                                                            Remove NGO role
                                                        </button>
                                                    )}
                                                    {u.chainRoles.verifier && (
                                                        <button type="button" className="button danger small" onClick={() => revoke(u, "verifier")}>
                                                            Remove verifier role
                                                        </button>
                                                    )}
                                                </div>
                                            </WalletGate>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </Section>
            )}
        </RequireApproved>
    );
}

export function AdminSystem() {
    const { contracts, paused, config } = useWeb3();
    const { runTx } = useTx();
    return (
        <RequireApproved type="admin">
            <div className="page-head">
                <h1>System</h1>
            </div>
            <Section title="Emergency pause">
                <p>
                    GiveChain is currently <strong>{paused ? "paused" : "running"}</strong>. Pausing blocks every donation,
                    approval, payment and refund in all contracts at once. Viewing still works.
                </p>
                <WalletGate action="pause or unpause">
                    {paused ? (
                        <button type="button" className="button" onClick={() => runTx("Unpause GiveChain", () => contracts.GiveChainAccess.unpause())}>
                            Unpause
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="button danger"
                            onClick={() => {
                                if (window.confirm("Pause the whole system? Every transaction will be blocked until you unpause.")) {
                                    runTx("Pause GiveChain", () => contracts.GiveChainAccess.pause());
                                }
                            }}
                        >
                            Pause everything
                        </button>
                    )}
                </WalletGate>
            </Section>
            <Section title="Contracts">
                <p className="small muted">
                    Network: {config?.network} (chain {config?.chainId})
                </p>
                <dl className="facts">
                    {config &&
                        Object.entries(config.contracts).map(([name, c]) => (
                            <div key={name} className="facts-row">
                                <dt>{name}</dt>
                                <dd>
                                    <code>{c.address}</code>
                                </dd>
                            </div>
                        ))}
                </dl>
            </Section>
        </RequireApproved>
    );
}
