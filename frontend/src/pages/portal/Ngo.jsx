import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ethers } from "ethers";
import { api } from "../../lib/api";
import { useData } from "../../lib/useData";
import { formatAmount, formatDate, parseAmount, sameAddress, SYMBOL } from "../../lib/format";
import { identityCommitment, ngoIdentityKey } from "../../lib/identity";
import { useWeb3 } from "../../context/Web3Context";
import { useAuth } from "../../context/AuthContext";
import { useTx } from "../../context/TxContext";
import MilestoneList from "../../components/MilestoneList";
import { WalletGate } from "../../components/Wallet";
import { Address, Amount, Empty, ErrorNote, Loading, Progress, Section, Stat, StatusBadge } from "../../components/ui";
import { RequireApproved } from "./PortalLayout";

// ------------------------------------------------------------------ campaign list + create

function CreateCampaign({ onDone }) {
    const { contracts } = useWeb3();
    const { user } = useAuth();
    const { runTx } = useTx();
    const empty = {
        title: "",
        summary: "",
        description: "",
        category: "",
        location: "",
        organisation: user.roleApplication?.organisationName || "",
        target: "",
    };
    const [form, setForm] = useState(empty);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
    const target = parseAmount(form.target);

    const submit = async (e) => {
        e.preventDefault();
        setError(null);
        if (!target) return setError("Enter a positive funding target.");
        setBusy(true);
        try {
            const { target: _t, ...details } = form;
            const { cid } = await api.uploadJson(details);
            const ok = await runTx(`Create campaign "${form.title}"`, () => contracts.ProjectRegistry.createCampaign(target, cid));
            if (ok) {
                setForm(empty);
                onDone?.();
            }
        } catch (err) {
            setError(`Could not save the campaign details: ${err.message}`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Section title="New campaign">
            <WalletGate action="create a campaign">
                <form className="form" onSubmit={submit}>
                    <div className="grid-2 tight">
                        <label>
                            Title
                            <input value={form.title} onChange={set("title")} required maxLength={120} placeholder="e.g. Winter Food Packages" />
                        </label>
                        <label>
                            Funding target ({SYMBOL})
                            <input value={form.target} onChange={set("target")} required inputMode="decimal" placeholder="5000" />
                        </label>
                    </div>
                    <label>
                        One-line summary
                        <input value={form.summary} onChange={set("summary")} maxLength={300} />
                    </label>
                    <label>
                        Description
                        <textarea value={form.description} onChange={set("description")} rows={4} maxLength={5000} />
                    </label>
                    <div className="grid-3 tight">
                        <label>
                            Category
                            <input value={form.category} onChange={set("category")} maxLength={60} placeholder="Food, Health…" />
                        </label>
                        <label>
                            Location
                            <input value={form.location} onChange={set("location")} maxLength={120} />
                        </label>
                        <label>
                            Organisation
                            <input value={form.organisation} onChange={set("organisation")} maxLength={120} />
                        </label>
                    </div>
                    <p className="small muted">
                        The details are stored on IPFS and their fingerprint on the blockchain. Do not include personal data.
                    </p>
                    {error && <p className="error-note">{error}</p>}
                    <div className="row">
                        <button className="button" disabled={busy}>
                            {busy ? "Working…" : "Create campaign"}
                        </button>
                        {onDone && (
                            <button type="button" className="button secondary" onClick={onDone}>
                                Cancel
                            </button>
                        )}
                    </div>
                </form>
            </WalletGate>
        </Section>
    );
}

export function NgoCampaigns() {
    const { user } = useAuth();
    const [creating, setCreating] = useState(false);
    const { data, error } = useData(() => (user.wallet ? api.campaigns(`?ngo=${user.wallet}`) : []), [user.wallet]);

    return (
        <RequireApproved type="ngo">
            <div className="page-head">
                <div>
                    <h1>My campaigns</h1>
                    <p className="muted">Create campaigns, choose who to help, and request payments.</p>
                </div>
                {!creating && (
                    <button type="button" className="button" onClick={() => setCreating(true)}>
                        + New campaign
                    </button>
                )}
            </div>
            {creating && <CreateCampaign onDone={() => setCreating(false)} />}
            <ErrorNote error={error} />
            {!data ? (
                <Loading />
            ) : data.length === 0 ? (
                !creating && <Empty>You have no campaigns yet. Create your first one.</Empty>
            ) : (
                <div className="list-cards">
                    {data.map((c) => (
                        <Link key={c.id} to={`/app/campaigns/${c.id}`} className="item-card link-card">
                            <div className="item-card-head">
                                <strong>{c.metadata?.title || `Campaign #${c.id}`}</strong>
                                <StatusBadge status={c.status} />
                            </div>
                            <Progress value={c.donated} max={c.targetAmount} />
                            <div className="small muted">
                                <Amount value={c.donated} /> of <Amount value={c.targetAmount} /> · {c.approvedBeneficiaryCount} people approved ·{" "}
                                {c.milestoneCount} payments
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </RequireApproved>
    );
}

// ------------------------------------------------------------------ manage one campaign

function useRegister(campaign) {
    const { contracts, signer } = useWeb3();
    const { runTx } = useTx();
    return async (wallet, idNumber, label) => {
        // One MetaMask signature per session creates the NGO's private hashing key.
        let key;
        try {
            key = await ngoIdentityKey(signer);
        } catch {
            return null;
        }
        const commitment = identityCommitment(key, idNumber);
        return runTx(`Register ${label} in "${campaign.metadata?.title || campaign.id}"`, () =>
            contracts.ProjectRegistry.registerBeneficiary(campaign.id, wallet, commitment)
        );
    };
}

function Applicants({ campaign, applications }) {
    const { refresh } = useWeb3();
    const register = useRegister(campaign);
    const [declining, setDeclining] = useState(null);
    const [note, setNote] = useState("");
    const pending = applications.filter((a) => a.status === "pending");
    const others = applications.filter((a) => a.status !== "pending");

    const decline = async (app) => {
        await api.declineApplication(app.id, note);
        setDeclining(null);
        setNote("");
        refresh();
    };

    return (
        <>
            <Section title={`Waiting for your decision (${pending.length})`}>
                <p className="small muted">
                    People who applied for help. Selecting someone registers their wallet on the blockchain; a verifier must then
                    approve them before they can be paid. Their ID number is turned into a private fingerprint in your browser.
                </p>
                {pending.length === 0 ? (
                    <Empty>No new applications.</Empty>
                ) : (
                    pending.map((a) => (
                        <div className="item-card" key={a.id}>
                            <div className="item-card-head">
                                <strong>{a.fullName}</strong>
                                <span className="small muted">applied {formatDate(Date.parse(a.createdAt) / 1000)}</span>
                            </div>
                            <dl className="facts">
                                <dt>ID number</dt>
                                <dd>{a.idNumber}</dd>
                                <dt>Phone</dt>
                                <dd>{a.phone || "-"}</dd>
                                <dt>Household</dt>
                                <dd>{a.householdSize || "-"}</dd>
                                <dt>Reason</dt>
                                <dd>{a.reason}</dd>
                                <dt>Wallet</dt>
                                <dd>
                                    <code>{a.wallet}</code>
                                </dd>
                            </dl>
                            {declining === a.id ? (
                                <div className="form">
                                    <label>
                                        Reason (shown to the applicant)
                                        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
                                    </label>
                                    <div className="row">
                                        <button type="button" className="button danger" onClick={() => decline(a)}>
                                            Decline application
                                        </button>
                                        <button type="button" className="button secondary" onClick={() => setDeclining(null)}>
                                            Back
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <WalletGate action="select applicants">
                                    <div className="row">
                                        <button type="button" className="button" onClick={() => register(a.wallet, a.idNumber, a.fullName)}>
                                            Select and register on-chain
                                        </button>
                                        <button type="button" className="button danger" onClick={() => setDeclining(a.id)}>
                                            Decline
                                        </button>
                                    </div>
                                </WalletGate>
                            )}
                        </div>
                    ))
                )}
            </Section>
            {others.length > 0 && (
                <Section title="Handled applications">
                    <table className="table">
                        <tbody>
                            {others.map((a) => (
                                <tr key={a.id}>
                                    <td>{a.fullName}</td>
                                    <td>
                                        <StatusBadge status={a.status === "registered" ? a.chainStatus : "Rejected"} />
                                    </td>
                                    <td className="small muted">{a.reviewNote}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Section>
            )}
        </>
    );
}

function AddDirectly({ campaign }) {
    const register = useRegister(campaign);
    const [wallet, setWallet] = useState("");
    const [idNumber, setIdNumber] = useState("");
    const valid = ethers.isAddress(wallet) && idNumber.trim().length >= 4;
    const submit = async (e) => {
        e.preventDefault();
        if (!valid) return;
        const ok = await register(wallet, idNumber, `${wallet.slice(0, 8)}…`);
        if (ok) {
            setWallet("");
            setIdNumber("");
        }
    };
    return (
        <Section title="Add a person directly">
            <p className="small muted">
                For people who cannot use the app themselves. You need their wallet address and ID number; the ID number stays in
                your browser and only its fingerprint goes on-chain.
            </p>
            <WalletGate action="register people">
                <form className="form" onSubmit={submit}>
                    <div className="grid-2 tight">
                        <label>
                            Their wallet address
                            <input value={wallet} onChange={(e) => setWallet(e.target.value.trim())} placeholder="0x…" />
                        </label>
                        <label>
                            Their national ID number
                            <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
                        </label>
                    </div>
                    {wallet && !ethers.isAddress(wallet) && <p className="error-note">Not a valid wallet address.</p>}
                    <div>
                        <button className="button" disabled={!valid}>
                            Register person
                        </button>
                    </div>
                </form>
            </WalletGate>
        </Section>
    );
}

function People({ campaign, applications }) {
    const nameFor = (wallet) => applications.find((a) => sameAddress(a.wallet, wallet))?.fullName;
    return (
        <>
            <Section title={`Registered people (${campaign.beneficiaries.length})`}>
                {campaign.beneficiaries.length === 0 ? (
                    <Empty>No one registered yet.</Empty>
                ) : (
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Person</th>
                                <th>Status</th>
                                <th>Updated</th>
                            </tr>
                        </thead>
                        <tbody>
                            {campaign.beneficiaries.map((b) => (
                                <tr key={b.wallet}>
                                    <td>
                                        {nameFor(b.wallet) && <strong>{nameFor(b.wallet)} </strong>}
                                        <Address value={b.wallet} />
                                    </td>
                                    <td>
                                        <StatusBadge status={b.status} />
                                        {b.status === "Registered" && <div className="small muted">waiting for a verifier</div>}
                                    </td>
                                    <td className="small muted">{formatDate(b.updatedAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Section>
            {campaign.status === "Active" && <AddDirectly campaign={campaign} />}
        </>
    );
}

function RequestPayment({ campaign, applications }) {
    const { contracts, config } = useWeb3();
    const { runTx } = useTx();
    const approved = campaign.beneficiaries.filter((b) => b.status === "Approved");
    const [beneficiary, setBeneficiary] = useState("");
    const [amountText, setAmountText] = useState("");
    const [file, setFile] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const amount = parseAmount(amountText);
    const nameFor = (wallet) => applications.find((a) => sameAddress(a.wallet, wallet))?.fullName;

    if (!approved.length) {
        return (
            <Section title="Request a payment">
                <p className="muted">No approved people yet. A verifier must approve someone before you can request a payment.</p>
            </Section>
        );
    }

    const submit = async (e) => {
        e.preventDefault();
        setError(null);
        if (!beneficiary) return setError("Choose who to pay.");
        if (!amount) return setError("Enter a positive amount.");
        if (!file) return setError("Evidence is required (receipt, quote or photo).");
        if (file.size > config.maxUploadBytes) return setError("That file is larger than 5 MB.");
        setBusy(true);
        try {
            const { cid } = await api.uploadFile(file);
            const ok = await runTx(`Request ${formatAmount(amount)} ${SYMBOL} for ${nameFor(beneficiary) || beneficiary.slice(0, 8)}`, () =>
                contracts.MilestoneDisbursement.submitMilestone(campaign.id, beneficiary, amount, cid)
            );
            if (ok) {
                setAmountText("");
                setFile(null);
                e.target.reset();
            }
        } catch (err) {
            setError(`Could not upload the evidence: ${err.message}`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Section title="Request a payment">
            <WalletGate action="request payments">
                <form className="form" onSubmit={submit}>
                    <div className="grid-3 tight">
                        <label>
                            Pay to
                            <select value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)}>
                                <option value="">Choose a person…</option>
                                {approved.map((b) => (
                                    <option key={b.wallet} value={b.wallet}>
                                        {nameFor(b.wallet) || "Beneficiary"} ({b.wallet.slice(0, 6)}…{b.wallet.slice(-4)})
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            Amount ({SYMBOL})
                            <input value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal" />
                        </label>
                        <label>
                            Evidence (PDF, image or text)
                            <input type="file" accept={config.allowedUploadTypes.join(",")} onChange={(e) => setFile(e.target.files?.[0] || null)} />
                        </label>
                    </div>
                    <p className="small muted">
                        Available now: <Amount value={campaign.available} />. A verifier reviews the evidence and reserves the money
                        when approving.
                    </p>
                    {error && <p className="error-note">{error}</p>}
                    <div>
                        <button className="button" disabled={busy}>
                            {busy ? "Working…" : "Submit request"}
                        </button>
                    </div>
                </form>
            </WalletGate>
        </Section>
    );
}

function Payments({ campaign, applications }) {
    const { contracts } = useWeb3();
    const { runTx } = useTx();
    const active = campaign.status === "Active";
    return (
        <>
            {active && <RequestPayment campaign={campaign} applications={applications} />}
            <Section title={`Payment requests (${campaign.milestones.length})`}>
                <MilestoneList
                    milestones={[...campaign.milestones].reverse()}
                    actions={(m) =>
                        m.status === "Approved" && active ? (
                            <WalletGate action="release payments">
                                <span className="small muted">Approved by a verifier. Release to pay the person directly.</span>
                                <button
                                    type="button"
                                    className="button"
                                    onClick={() =>
                                        runTx(`Release payment #${m.id} (${formatAmount(m.amount)} ${SYMBOL})`, () =>
                                            contracts.MilestoneDisbursement.releaseMilestone(m.id)
                                        )
                                    }
                                >
                                    Release payment
                                </button>
                            </WalletGate>
                        ) : null
                    }
                />
            </Section>
        </>
    );
}

function Close({ campaign }) {
    const { contracts } = useWeb3();
    const { runTx } = useTx();
    const unpaid = campaign.milestones.filter((m) => m.status === "Approved");
    const close = (kind) => {
        const warning = unpaid.length
            ? `\n\n${unpaid.length} approved payment(s) have not been released yet. They will never be paid; that money becomes refundable to donors.`
            : "";
        const text =
            kind === "complete"
                ? "Mark this campaign as completed? Donors can then claim back any unspent money."
                : "Cancel this campaign? Donors can then claim back any unspent money.";
        if (!window.confirm(text + warning + "\n\nThis cannot be undone.")) return;
        runTx(`${kind === "complete" ? "Complete" : "Cancel"} campaign "${campaign.metadata?.title || campaign.id}"`, () =>
            kind === "complete" ? contracts.ProjectRegistry.completeCampaign(campaign.id) : contracts.ProjectRegistry.cancelCampaign(campaign.id)
        );
    };
    if (campaign.status !== "Active") {
        return (
            <Section title="Campaign closed">
                <p>This campaign is {campaign.status.toLowerCase()}. Donors can claim refunds of unspent money.</p>
            </Section>
        );
    }
    return (
        <Section title="Close this campaign">
            <p>
                <strong>Complete</strong> when the work is finished, or <strong>cancel</strong> if it cannot continue. Either way,
                donations stop and donors can claim back their share of unspent money. This cannot be undone.
            </p>
            {unpaid.length > 0 && <p className="notice">{unpaid.length} approved payment(s) are not released yet. Release them first.</p>}
            <WalletGate action="close the campaign">
                <div className="row">
                    <button type="button" className="button secondary" onClick={() => close("complete")}>
                        Complete campaign
                    </button>
                    <button type="button" className="button danger" onClick={() => close("cancel")}>
                        Cancel campaign
                    </button>
                </div>
            </WalletGate>
        </Section>
    );
}

const TABS = [
    ["applicants", "Applicants"],
    ["people", "People"],
    ["payments", "Payments"],
    ["close", "Close"],
];

export function NgoCampaign() {
    const { id } = useParams();
    const { user } = useAuth();
    const navigate = useNavigate();
    const [tab, setTab] = useState("applicants");
    // Refreshes every 8 seconds so new applications appear without reloading.
    // If applications cannot be loaded, say so instead of showing an empty list.
    const { data, error } = useData(
        async () => {
            const [campaign, applications] = await Promise.all([
                api.campaign(id),
                api.campaignApplications(id).then(
                    (list) => ({ list, error: null }),
                    (err) => ({ list: [], error: err })
                ),
            ]);
            return { campaign, applications: applications.list, applicationsError: applications.error };
        },
        [id],
        { intervalMs: 8000 }
    );

    if (error && !data) return <ErrorNote error={error} />;
    if (!data) return <Loading />;
    const c = data.campaign;
    if (!sameAddress(c.ngo, user.wallet)) {
        navigate("/app/campaigns", { replace: true });
        return null;
    }
    const pendingCount = data.applications.filter((a) => a.status === "pending").length;
    const toRelease = c.milestones.filter((m) => m.status === "Approved").length;

    return (
        <RequireApproved type="ngo">
            <p className="breadcrumb">
                <Link to="/app/campaigns">My campaigns</Link> / {c.metadata?.title}
            </p>
            <div className="page-head">
                <div>
                    <h1>{c.metadata?.title || `Campaign #${c.id}`}</h1>
                    <p className="muted">
                        <StatusBadge status={c.status} /> · <Link to={`/campaigns/${c.id}`}>Public page</Link>
                    </p>
                </div>
            </div>
            <div className="stats-grid wide">
                <Stat label="Raised" value={<Amount value={c.donated} />} hint={<>of <Amount value={c.targetAmount} /></>} />
                <Stat label="Available" value={<Amount value={c.available} />} hint="for new payments" />
                <Stat label="Reserved" value={<Amount value={c.reserved} />} hint="approved, not yet released" />
                <Stat label="Paid to people" value={<Amount value={c.released} />} />
            </div>
            <div className="tabs" role="tablist">
                {TABS.map(([key, label]) => (
                    <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "tab active" : "tab"} onClick={() => setTab(key)}>
                        {label}
                        {key === "applicants" && pendingCount > 0 && <span className="tab-count">{pendingCount}</span>}
                        {key === "payments" && toRelease > 0 && <span className="tab-count">{toRelease}</span>}
                    </button>
                ))}
            </div>
            {data.applicationsError && (
                <p className="error-note">
                    Could not load the people who applied: {data.applicationsError.message} The page tries again every few
                    seconds.
                </p>
            )}
            {tab === "applicants" && <Applicants campaign={c} applications={data.applications} />}
            {tab === "people" && <People campaign={c} applications={data.applications} />}
            {tab === "payments" && <Payments campaign={c} applications={data.applications} />}
            {tab === "close" && <Close campaign={c} />}
        </RequireApproved>
    );
}
