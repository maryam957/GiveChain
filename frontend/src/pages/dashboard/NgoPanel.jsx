import { useState } from "react";
import { Link } from "react-router-dom";
import { ethers } from "ethers";
import { api } from "../../lib/api";
import { useData } from "../../lib/useData";
import { formatAmount, parseAmount, SYMBOL } from "../../lib/format";
import { identityCommitment, newSalt } from "../../lib/identity";
import { useWeb3 } from "../../context/Web3Context";
import { useTx } from "../../context/TxContext";
import MilestoneList from "../../components/MilestoneList";
import { Address, Amount, Empty, ErrorNote, Loading, Progress, Section, StatusBadge } from "../../components/ui";

function CreateCampaign() {
    const { contracts } = useWeb3();
    const { runTx } = useTx();
    const empty = { title: "", summary: "", description: "", category: "", location: "", organisation: "", target: "" };
    const [form, setForm] = useState(empty);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
    const target = parseAmount(form.target);

    const submit = async (e) => {
        e.preventDefault();
        setError(null);
        if (!form.title.trim()) return setError("A title is required.");
        if (!target) return setError("Enter a positive funding target.");
        setBusy(true);
        try {
            const { target: _ignored, ...details } = form;
            const { cid } = await api.uploadJson(details);
            const ok = await runTx(`Create campaign "${form.title}"`, () => contracts.ProjectRegistry.createCampaign(target, cid));
            if (ok) setForm(empty);
        } catch (err) {
            setError(`Could not store the campaign details on IPFS: ${err.message}`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Section title="Create a campaign">
            <form className="form" onSubmit={submit}>
                <div className="grid-2 tight">
                    <label>
                        Title
                        <input value={form.title} onChange={set("title")} maxLength={120} placeholder="Winter Food Packages" />
                    </label>
                    <label>
                        Funding target ({SYMBOL})
                        <input value={form.target} onChange={set("target")} inputMode="decimal" placeholder="5000" />
                    </label>
                </div>
                <label>
                    Short summary
                    <input value={form.summary} onChange={set("summary")} maxLength={300} />
                </label>
                <label>
                    Description
                    <textarea value={form.description} onChange={set("description")} maxLength={5000} rows={3} />
                </label>
                <div className="grid-3 tight">
                    <label>
                        Category
                        <input value={form.category} onChange={set("category")} maxLength={60} placeholder="Food" />
                    </label>
                    <label>
                        Location
                        <input value={form.location} onChange={set("location")} maxLength={120} />
                    </label>
                    <label>
                        Organisation name
                        <input value={form.organisation} onChange={set("organisation")} maxLength={120} />
                    </label>
                </div>
                <p className="small muted">
                    The details are stored on IPFS; only their fingerprint goes on-chain. Do not include personal data about
                    the people you help.
                </p>
                {error && <p className="error-note">{error}</p>}
                <button className="button" disabled={busy}>
                    {busy ? "Working…" : "Create campaign"}
                </button>
            </form>
        </Section>
    );
}

function RegisterBeneficiary({ campaign }) {
    const { contracts } = useWeb3();
    const { runTx } = useTx();
    const [wallet, setWallet] = useState("");
    const [idNumber, setIdNumber] = useState("");
    const [salt, setSalt] = useState(newSalt);
    const [saved, setSaved] = useState(null);
    const validWallet = ethers.isAddress(wallet);
    const commitment = idNumber.trim() ? identityCommitment(salt, idNumber) : null;

    const submit = async (e) => {
        e.preventDefault();
        if (!validWallet || !commitment) return;
        const ok = await runTx(`Register ${wallet.slice(0, 8)}… in campaign #${campaign.id}`, () =>
            contracts.ProjectRegistry.registerBeneficiary(campaign.id, wallet, commitment)
        );
        if (ok) {
            setSaved({ wallet, salt });
            setWallet("");
            setIdNumber("");
            setSalt(newSalt());
        }
    };

    return (
        <form className="form subform" onSubmit={submit}>
            <h3>Register a person</h3>
            <div className="grid-2 tight">
                <label>
                    Their wallet address
                    <input value={wallet} onChange={(e) => setWallet(e.target.value.trim())} placeholder="0x…" />
                </label>
                <label>
                    National ID number (stays in this browser)
                    <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="e.g. 35202-1234567-1" />
                </label>
            </div>
            {wallet && !validWallet && <p className="error-note">Not a valid wallet address.</p>}
            {commitment && (
                <p className="small muted">
                    On-chain identity commitment: <code>{commitment.slice(0, 18)}…</code> (hash of a random salt + the ID). The ID
                    number itself is never sent anywhere.
                </p>
            )}
            <button className="button" disabled={!validWallet || !commitment}>
                Register
            </button>
            {saved && (
                <div className="notice">
                    Registered <code>{saved.wallet}</code>. Keep this salt with your private records, so the commitment can
                    be checked later:
                    <code className="block">{saved.salt}</code>
                    An auditor must now approve this person before they can be paid.
                </div>
            )}
        </form>
    );
}

function SubmitPayment({ campaign }) {
    const { contracts, config } = useWeb3();
    const { runTx } = useTx();
    const approved = campaign.beneficiaries.filter((b) => b.status === "Approved");
    const [beneficiary, setBeneficiary] = useState("");
    const [amountText, setAmountText] = useState("");
    const [file, setFile] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const amount = parseAmount(amountText);

    if (!approved.length) {
        return <p className="muted small">No approved people yet. An auditor must approve someone before you can request a payment.</p>;
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
            const ok = await runTx(`Request ${formatAmount(amount)} ${SYMBOL} for ${beneficiary.slice(0, 8)}…`, () =>
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
        <form className="form subform" onSubmit={submit}>
            <h3>Request a payment</h3>
            <div className="grid-3 tight">
                <label>
                    Pay to
                    <select value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)}>
                        <option value="">Choose…</option>
                        {approved.map((b) => (
                            <option key={b.wallet} value={b.wallet}>
                                {b.wallet.slice(0, 10)}…{b.wallet.slice(-4)}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    Amount ({SYMBOL})
                    <input value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal" />
                </label>
                <label>
                    Evidence file
                    <input
                        type="file"
                        accept={config.allowedUploadTypes.join(",")}
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                </label>
            </div>
            <p className="small muted">
                Available now: <Amount value={campaign.available} />. The auditor reserves the money when approving.
            </p>
            {error && <p className="error-note">{error}</p>}
            <button className="button" disabled={busy}>
                {busy ? "Working…" : "Submit request"}
            </button>
        </form>
    );
}

function CloseCampaign({ campaign }) {
    const { contracts } = useWeb3();
    const { runTx } = useTx();
    const unpaid = campaign.milestones.filter((m) => m.status === "Approved");
    const close = (kind) => {
        const warning = unpaid.length
            ? `\n\n${unpaid.length} approved payment(s) have not been released yet. Closing the campaign means they can never be paid; that money becomes refundable to donors instead.`
            : "";
        const text =
            kind === "complete"
                ? `Mark campaign #${campaign.id} as completed? Donors can then claim back any unspent money.`
                : `Cancel campaign #${campaign.id}? Donors can then claim back any unspent money.`;
        if (!window.confirm(text + warning + "\n\nThis cannot be undone.")) return;
        runTx(`${kind === "complete" ? "Complete" : "Cancel"} campaign #${campaign.id}`, () =>
            kind === "complete"
                ? contracts.ProjectRegistry.completeCampaign(campaign.id)
                : contracts.ProjectRegistry.cancelCampaign(campaign.id)
        );
    };
    return (
        <div className="row">
            <button type="button" className="button secondary" onClick={() => close("complete")}>
                Complete campaign
            </button>
            <button type="button" className="button danger" onClick={() => close("cancel")}>
                Cancel campaign
            </button>
        </div>
    );
}

function ManageCampaign({ id }) {
    const { contracts } = useWeb3();
    const { runTx } = useTx();
    const { data: c, error } = useData(() => api.campaign(id), [id]);
    if (error) return <ErrorNote error={error} />;
    if (!c) return <Loading />;
    const active = c.status === "Active";

    return (
        <Section
            title={
                <>
                    <Link to={`/campaigns/${c.id}`}>{c.metadata?.title || `Campaign #${c.id}`}</Link> <StatusBadge status={c.status} />
                </>
            }
        >
            <Progress value={c.donated} max={c.targetAmount} />
            <p className="small">
                <Amount value={c.donated} /> raised of <Amount value={c.targetAmount} /> · available <Amount value={c.available} /> ·
                reserved <Amount value={c.reserved} /> · paid <Amount value={c.released} />
            </p>

            <h3>People ({c.beneficiaries.length})</h3>
            {c.beneficiaries.length === 0 ? (
                <Empty>No one registered yet.</Empty>
            ) : (
                <ul className="list compact">
                    {c.beneficiaries.map((b) => (
                        <li key={b.wallet}>
                            <Address value={b.wallet} /> <StatusBadge status={b.status} />
                        </li>
                    ))}
                </ul>
            )}

            {active && <RegisterBeneficiary campaign={c} />}
            {active && <SubmitPayment campaign={c} />}

            <h3>Payment requests</h3>
            <MilestoneList
                milestones={c.milestones}
                actions={(m) =>
                    m.status === "Approved" && active ? (
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
                    ) : null
                }
            />
            {active && (
                <>
                    <h3>Close campaign</h3>
                    <CloseCampaign campaign={c} />
                </>
            )}
        </Section>
    );
}

export default function NgoPanel() {
    const { account } = useWeb3();
    const mine = useData(() => api.campaigns(`?ngo=${account}`), [account]);
    return (
        <>
            <CreateCampaign />
            <h2 className="section-title">Your campaigns</h2>
            <ErrorNote error={mine.error} />
            {mine.data?.length === 0 && <Empty>You have not created a campaign yet.</Empty>}
            {mine.data?.map((c) => (
                <ManageCampaign key={c.id} id={c.id} />
            ))}
        </>
    );
}
