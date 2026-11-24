import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useData } from "../lib/useData";
import { formatAmount, formatDate, parseAmount, sameAddress, SYMBOL } from "../lib/format";
import { useWeb3 } from "../context/Web3Context";
import { useAuth } from "../context/AuthContext";
import { useTx } from "../context/TxContext";
import MilestoneList from "../components/MilestoneList";
import { WalletGate } from "../components/Wallet";
import {
    Address,
    Amount,
    Empty,
    ErrorNote,
    Evidence,
    Loading,
    Page,
    Progress,
    Section,
    Stat,
    StatusBadge,
    TxHash,
} from "../components/ui";

const FAUCET_AMOUNT = 1000n * 10n ** 6n;

export function FaucetButton({ label = `Get 1,000 test ${SYMBOL}` }) {
    const { contracts } = useWeb3();
    const { runTx } = useTx();
    return (
        <button
            type="button"
            className="button secondary"
            onClick={() => runTx(`Get 1,000 ${SYMBOL} from the test faucet`, () => contracts.MockUSDC.faucet(FAUCET_AMOUNT))}
        >
            {label}
        </button>
    );
}

function LoginPrompt({ text }) {
    const location = useLocation();
    return (
        <p className="muted">
            <Link to="/login" state={{ from: location.pathname }}>
                Log in
            </Link>{" "}
            or <Link to="/signup">create an account</Link> to {text}.
        </p>
    );
}

function DonatePanel({ campaign }) {
    const { contracts, readContracts, account, balance, paused } = useWeb3();
    const { user } = useAuth();
    const { runTx } = useTx();
    const [amountText, setAmountText] = useState("");
    const [busy, setBusy] = useState(false);
    const amount = parseAmount(amountText);

    if (campaign.status !== "Active") {
        return <p className="muted">This campaign is {campaign.status.toLowerCase()} and no longer accepts donations.</p>;
    }
    if (!user) return <LoginPrompt text="donate" />;

    const donate = async () => {
        if (!amount) return;
        setBusy(true);
        try {
            const vaultAddress = await contracts.DonationVault.getAddress();
            const allowance = await readContracts.MockUSDC.allowance(account, vaultAddress);
            if (allowance < amount) {
                const ok = await runTx(`Allow the vault to take ${formatAmount(amount)} ${SYMBOL}`, () =>
                    contracts.MockUSDC.approve(vaultAddress, amount)
                );
                if (!ok) return;
            }
            const done = await runTx(`Donate ${formatAmount(amount)} ${SYMBOL} to "${campaign.metadata?.title || campaign.id}"`, () =>
                contracts.DonationVault.donate(campaign.id, amount)
            );
            if (done) setAmountText("");
        } finally {
            setBusy(false);
        }
    };

    const tooMuch = amount !== null && amount > balance;
    return (
        <WalletGate action="donate">
            <div className="form">
                <label>
                    Amount ({SYMBOL})
                    <div className="input-group">
                        <input
                            type="text"
                            inputMode="decimal"
                            placeholder="100"
                            value={amountText}
                            onChange={(e) => setAmountText(e.target.value)}
                        />
                        {[50, 100, 500].map((n) => (
                            <button key={n} type="button" className="chip" onClick={() => setAmountText(String(n))}>
                                {n}
                            </button>
                        ))}
                    </div>
                </label>
                <div className="small muted">
                    Your balance: <Amount value={balance} />
                </div>
                {amountText && !amount && <p className="error-note">Enter a positive amount with at most 6 decimals.</p>}
                {tooMuch && <p className="error-note">That is more than your balance. Use the test faucet to get tokens.</p>}
                <div className="row">
                    <button type="button" className="button" disabled={!amount || tooMuch || busy || paused} onClick={donate}>
                        {busy ? "Working…" : "Donate"}
                    </button>
                    <FaucetButton />
                </div>
                <p className="small muted">
                    The first time, MetaMask asks twice: once to allow the vault to take the tokens, then to donate.
                </p>
            </div>
        </WalletGate>
    );
}

function ApplyPanel({ campaign }) {
    const { user } = useAuth();
    const { refresh } = useWeb3();
    const mine = useData(() => (user?.accountType === "beneficiary" ? api.myApplications() : []), [user?.id]);
    const [form, setForm] = useState({ fullName: user?.name || "", idNumber: "", phone: user?.phone || "", householdSize: "", reason: "" });
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    if (campaign.status !== "Active") return null;
    if (!user) {
        return (
            <Section title="Need help?">
                <LoginPrompt text="apply for help from this campaign as a beneficiary" />
            </Section>
        );
    }
    if (user.accountType !== "beneficiary") return null;

    const existing = mine.data?.find((a) => a.campaignId === campaign.id && a.status !== "declined");
    const registered = campaign.beneficiaries.some((b) => sameAddress(b.wallet, user.wallet));

    const submit = async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
            await api.applyToCampaign(campaign.id, form);
            refresh();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Section title="Apply for help">
            {registered ? (
                <p>
                    You are registered in this campaign. Track your status and payments in{" "}
                    <Link to="/app/assistance">your portal</Link>.
                </p>
            ) : existing ? (
                <p>
                    You applied on {new Date(existing.createdAt).toLocaleDateString()}. Status:{" "}
                    <StatusBadge status={existing.status === "pending" ? "Submitted" : existing.status} />. The NGO will review
                    your application.
                </p>
            ) : (
                <WalletGate action="apply for help">
                    <form className="form" onSubmit={submit}>
                        <p className="small muted">
                            Only this campaign's NGO and GiveChain verifiers can see these details. Nothing here is published on
                            the blockchain.
                        </p>
                        <div className="grid-2 tight">
                            <label>
                                Full name
                                <input value={form.fullName} onChange={set("fullName")} required minLength={2} maxLength={100} />
                            </label>
                            <label>
                                National ID number
                                <input value={form.idNumber} onChange={set("idNumber")} required minLength={4} maxLength={40} />
                            </label>
                            <label>
                                Phone (optional)
                                <input value={form.phone} onChange={set("phone")} maxLength={30} />
                            </label>
                            <label>
                                People in your household (optional)
                                <input value={form.householdSize} onChange={set("householdSize")} inputMode="numeric" />
                            </label>
                        </div>
                        <label>
                            Why do you need help?
                            <textarea value={form.reason} onChange={set("reason")} rows={3} required minLength={10} maxLength={1000} />
                        </label>
                        {error && <p className="error-note">{error}</p>}
                        <button className="button" disabled={busy}>
                            {busy ? "Sending…" : "Send application"}
                        </button>
                    </form>
                </WalletGate>
            )}
        </Section>
    );
}

function RefundPanel({ campaign }) {
    const { contracts, readContracts } = useWeb3();
    const { user } = useAuth();
    const { runTx } = useTx();
    const wallet = user?.wallet;
    const info = useData(async () => {
        if (!wallet || !readContracts) return null;
        const [contribution, claimed, refundable] = await Promise.all([
            readContracts.DonationVault.contributions(campaign.id, wallet),
            readContracts.DonationVault.refundClaimed(campaign.id, wallet),
            readContracts.DonationVault.refundableAmount(campaign.id, wallet),
        ]);
        return { contribution, claimed, refundable };
    }, [wallet, readContracts, campaign.id]);

    if (campaign.status === "Active" || !wallet || !info.data || info.data.contribution === 0n) return null;
    const { contribution, claimed, refundable } = info.data;
    return (
        <Section title="Your refund">
            <p>
                You donated <Amount value={contribution} />. This campaign is {campaign.status.toLowerCase()}, so you can take
                back your share of the money that was not paid out.
            </p>
            {claimed ? (
                <p className="muted">You already claimed your refund.</p>
            ) : refundable > 0n ? (
                <WalletGate action="claim your refund">
                    <button
                        type="button"
                        className="button"
                        onClick={() =>
                            runTx(`Claim refund of ${formatAmount(refundable)} ${SYMBOL}`, () =>
                                contracts.DonationVault.claimRefund(campaign.id)
                            )
                        }
                    >
                        Claim <Amount value={refundable} />
                    </button>
                </WalletGate>
            ) : (
                <p className="muted">Nothing is left to refund for you.</p>
            )}
        </Section>
    );
}

export default function Campaign() {
    const { id } = useParams();
    const { user } = useAuth();
    const { data: c, error, loading } = useData(() => api.campaign(id), [id]);

    if (loading && !c) return <Page><Loading /></Page>;
    if (error && !c) return <Page><ErrorNote error={error} /></Page>;
    if (!c) return null;

    const isOwner = sameAddress(user?.wallet, c.ngo);

    return (
        <Page>
            <p className="breadcrumb">
                <Link to="/campaigns">Campaigns</Link> / {c.metadata?.title || `#${c.id}`}
            </p>
            <div className="campaign-header">
                <div className="row">
                    <StatusBadge status={c.status} />
                    <span className="muted small">
                        {[c.metadata?.category, c.metadata?.location].filter(Boolean).join(" · ")}
                    </span>
                </div>
                <h1>{c.metadata?.title || `Campaign #${c.id}`}</h1>
                <p className="lead">{c.metadata?.summary}</p>
                <p className="small muted">
                    Run by <Address value={c.ngo} /> · created {formatDate(c.createdAt)} · <TxHash hash={c.createdTx} />
                </p>
                {isOwner && (
                    <p className="notice">
                        You run this campaign. <Link to={`/app/campaigns/${c.id}`}>Manage it in your portal →</Link>
                    </p>
                )}
            </div>

            <div className="grid-2">
                <div>
                    <Section title="About this campaign">
                        <p>{c.metadata?.description || "No description."}</p>
                        <p className="small muted">
                            Details stored on IPFS: <Evidence cid={c.metadataCID} label="details file" />{" "}
                            {c.metadataVerified === true && <span className="verified">✓ verified against its fingerprint</span>}
                        </p>
                    </Section>

                    <Section title={`Payments (${c.milestones.length})`}>
                        <p className="small muted">Every payment, who approved it, and the evidence behind it.</p>
                        <MilestoneList milestones={c.milestones} emptyText="No payments requested yet." />
                    </Section>

                    <Section title={`People helped (${c.beneficiaries.length})`}>
                        <p className="small muted">
                            Only wallets and status are public. Names and ID numbers stay private with the NGO.
                        </p>
                        {c.beneficiaries.length === 0 ? (
                            <Empty>No one registered yet.</Empty>
                        ) : (
                            <table className="table">
                                <tbody>
                                    {c.beneficiaries.map((b) => (
                                        <tr key={b.wallet}>
                                            <td><Address value={b.wallet} /></td>
                                            <td><StatusBadge status={b.status} /></td>
                                            <td className="small muted">{formatDate(b.updatedAt)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </Section>
                </div>

                <div>
                    <Section title="Funding">
                        <div className="big-number">
                            <Amount value={c.donated} />
                        </div>
                        <p className="muted small">
                            raised of <Amount value={c.targetAmount} /> target · {c.donorCount} donors
                        </p>
                        <Progress value={c.donated} max={c.targetAmount} />
                        <div className="stats-grid">
                            <Stat label="Available" value={<Amount value={c.available} />} hint="free for new payments" />
                            <Stat label="Reserved" value={<Amount value={c.reserved} />} hint="approved, not yet paid" />
                            <Stat label="Paid to people" value={<Amount value={c.released} />} />
                            <Stat label="Refunded" value={<Amount value={c.refunded} />} />
                        </div>
                    </Section>

                    <Section title="Donate">
                        <DonatePanel campaign={c} />
                    </Section>

                    <RefundPanel campaign={c} />
                    <ApplyPanel campaign={c} />

                    <Section title={`Recent donations (${c.donations.length})`}>
                        {c.donations.length === 0 ? (
                            <Empty>No donations yet.</Empty>
                        ) : (
                            <ul className="list">
                                {[...c.donations].reverse().slice(0, 8).map((d) => (
                                    <li key={d.txHash}>
                                        <Amount value={d.amount} />
                                        <div className="small muted">
                                            {formatDate(d.timestamp)} · <TxHash hash={d.txHash} />
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Section>
                </div>
            </div>
        </Page>
    );
}
