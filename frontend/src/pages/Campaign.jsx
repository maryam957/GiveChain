import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useData } from "../lib/useData";
import { formatAmount, formatDate, parseAmount, sameAddress, SYMBOL } from "../lib/format";
import { useWeb3 } from "../context/Web3Context";
import { useTx } from "../context/TxContext";
import MilestoneList from "../components/MilestoneList";
import {
    Address,
    Amount,
    Empty,
    ErrorNote,
    Evidence,
    Loading,
    Progress,
    Section,
    Stat,
    StatusBadge,
    TxHash,
} from "../components/ui";

const FAUCET_AMOUNT = 1000n * 10n ** 6n;

export function FaucetButton({ label = `Get 1,000 test ${SYMBOL}` }) {
    const { contracts, account } = useWeb3();
    const { runTx } = useTx();
    return (
        <button
            type="button"
            className="button secondary"
            disabled={!account}
            onClick={() => runTx(`Get 1,000 ${SYMBOL} from the faucet`, () => contracts.MockUSDC.faucet(FAUCET_AMOUNT))}
        >
            {label}
        </button>
    );
}

function DonatePanel({ campaign }) {
    const { contracts, readContracts, account, balance, paused } = useWeb3();
    const { runTx } = useTx();
    const [amountText, setAmountText] = useState("");
    const [busy, setBusy] = useState(false);
    const amount = parseAmount(amountText);
    const active = campaign.status === "Active";

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
            const done = await runTx(`Donate ${formatAmount(amount)} ${SYMBOL} to campaign #${campaign.id}`, () =>
                contracts.DonationVault.donate(campaign.id, amount)
            );
            if (done) setAmountText("");
        } finally {
            setBusy(false);
        }
    };

    if (!active) {
        return <p className="muted">This campaign is {campaign.status.toLowerCase()} and no longer accepts donations.</p>;
    }
    if (!account) return <p className="muted">Connect a wallet to donate.</p>;

    const tooMuch = amount !== null && amount > balance;
    return (
        <div className="form">
            <label>
                Amount ({SYMBOL})
                <input
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 100"
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                />
            </label>
            <div className="small muted">
                Your balance: <Amount value={balance} />
            </div>
            {amountText && !amount && <p className="error-note">Enter a positive amount with at most 6 decimals.</p>}
            {tooMuch && <p className="error-note">That is more than your balance. Use the faucet to get test tokens.</p>}
            <div className="row">
                <button type="button" className="button" disabled={!amount || tooMuch || busy || paused} onClick={donate}>
                    {busy ? "Working…" : "Donate"}
                </button>
                <FaucetButton />
            </div>
            <p className="small muted">
                Two wallet steps the first time: allow the vault to take the tokens, then donate. The money stays in the
                vault until an auditor approves a payment to a registered person.
            </p>
        </div>
    );
}

function RefundPanel({ campaign }) {
    const { contracts, readContracts, account } = useWeb3();
    const { runTx } = useTx();
    const info = useData(async () => {
        if (!account || !readContracts) return null;
        const [contribution, claimed, refundable] = await Promise.all([
            readContracts.DonationVault.contributions(campaign.id, account),
            readContracts.DonationVault.refundClaimed(campaign.id, account),
            readContracts.DonationVault.refundableAmount(campaign.id, account),
        ]);
        return { contribution, claimed, refundable };
    }, [account, readContracts, campaign.id]);

    if (campaign.status === "Active" || !account || !info.data || info.data.contribution === 0n) return null;
    const { contribution, claimed, refundable } = info.data;
    return (
        <Section title="Your refund">
            <p>
                You donated <Amount value={contribution} />. This campaign is {campaign.status.toLowerCase()}, so you can
                take back your share of the money that was not paid out.
            </p>
            {claimed ? (
                <p className="muted">You already claimed your refund.</p>
            ) : refundable > 0n ? (
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
            ) : (
                <p className="muted">Nothing is left to refund for you.</p>
            )}
        </Section>
    );
}

export default function Campaign() {
    const { id } = useParams();
    const { account } = useWeb3();
    const { data: c, error, loading } = useData(() => api.campaign(id), [id]);

    if (loading && !c) return <Loading />;
    if (error && !c) return <ErrorNote error={error} />;
    if (!c) return null;

    const isOwner = sameAddress(account, c.ngo);

    return (
        <>
            <p className="breadcrumb">
                <Link to="/">Campaigns</Link> / #{c.id}
            </p>
            <div className="campaign-header">
                <div>
                    <div className="row">
                        <StatusBadge status={c.status} />
                        <span className="muted small">
                            {c.metadata?.category} · {c.metadata?.location}
                        </span>
                    </div>
                    <h1>{c.metadata?.title || `Campaign #${c.id}`}</h1>
                    <p className="lead">{c.metadata?.summary}</p>
                    <p className="small muted">
                        Run by <Address value={c.ngo} /> {c.metadata?.organisation && `(${c.metadata.organisation})`} ·
                        created {formatDate(c.createdAt)} · <TxHash hash={c.createdTx} />
                    </p>
                    {isOwner && (
                        <p className="small">
                            You own this campaign. Manage it in <Link to="/dashboard">your dashboard</Link>.
                        </p>
                    )}
                </div>
            </div>

            <div className="grid-2">
                <div>
                    <Section title="About">
                        <p>{c.metadata?.description || "No description."}</p>
                        <p className="small muted">
                            Details stored on IPFS: <Evidence cid={c.metadataCID} label="details file" />{" "}
                            {c.metadataVerified === true && <span className="verified">✓ verified against CID</span>}
                        </p>
                    </Section>

                    <Section title={`Payment requests (${c.milestones.length})`}>
                        <MilestoneList milestones={c.milestones} />
                    </Section>

                    <Section title={`Registered people (${c.beneficiaries.length})`}>
                        <p className="small muted">
                            Only wallets and a hashed ID are public. Names and ID numbers stay with the NGO.
                        </p>
                        {c.beneficiaries.length === 0 ? (
                            <Empty>No one registered yet.</Empty>
                        ) : (
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Wallet</th>
                                        <th>Status</th>
                                        <th>Since</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {c.beneficiaries.map((b) => (
                                        <tr key={b.wallet}>
                                            <td>
                                                <Address value={b.wallet} />
                                            </td>
                                            <td>
                                                <StatusBadge status={b.status} />
                                            </td>
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
                        <Progress value={c.donated} max={c.targetAmount} />
                        <p>
                            <strong><Amount value={c.donated} /></strong> raised of <Amount value={c.targetAmount} /> target
                        </p>
                        <div className="stats-grid">
                            <Stat label="Available" value={<Amount value={c.available} />} hint="free for new payments" />
                            <Stat label="Reserved" value={<Amount value={c.reserved} />} hint="approved, not yet paid" />
                            <Stat label="Paid out" value={<Amount value={c.released} />} hint="sent to people" />
                            <Stat label="Refunded" value={<Amount value={c.refunded} />} hint="returned to donors" />
                        </div>
                    </Section>

                    <Section title="Donate">
                        <DonatePanel campaign={c} />
                    </Section>

                    <RefundPanel campaign={c} />

                    <Section title={`Donations (${c.donations.length})`}>
                        {c.donations.length === 0 ? (
                            <Empty>No donations yet.</Empty>
                        ) : (
                            <ul className="list">
                                {[...c.donations].reverse().map((d) => (
                                    <li key={d.txHash}>
                                        <Amount value={d.amount} /> from <Address value={d.donor} />
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
        </>
    );
}
