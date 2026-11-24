// Donor and beneficiary portal pages.

import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useData } from "../../lib/useData";
import { formatDate, sameAddress } from "../../lib/format";
import { useWeb3 } from "../../context/Web3Context";
import { useAuth } from "../../context/AuthContext";
import { useTx } from "../../context/TxContext";
import MilestoneList from "../../components/MilestoneList";
import { WalletGate } from "../../components/Wallet";
import { Amount, Empty, ErrorNote, Loading, Progress, Section, Stat, StatusBadge, TxHash } from "../../components/ui";
import { FaucetButton } from "../Campaign";

function NeedsWallet() {
    return (
        <div className="card">
            <h2>Link your wallet first</h2>
            <p>Your donations and payments are tied to your MetaMask wallet.</p>
            <Link to="/app/profile" className="button">
                Link my wallet
            </Link>
        </div>
    );
}

export function DonorDonations() {
    const { user } = useAuth();
    const { readContracts, balance } = useWeb3();
    const { data, error } = useData(async () => {
        if (!user.wallet) return null;
        const donor = await api.donor(user.wallet);
        // Refundable amounts come straight from the contract, not from the server.
        const refundable = await Promise.all(donor.campaigns.map((c) => readContracts.DonationVault.refundableAmount(c.id, user.wallet)));
        const details = await Promise.all(donor.campaigns.map((c) => api.campaign(c.id)));
        return {
            ...donor,
            campaigns: donor.campaigns.map((c, i) => ({ ...c, refundable: refundable[i], title: details[i].metadata?.title })),
        };
    }, [user.wallet, readContracts]);

    if (!user.wallet) return <NeedsWallet />;
    if (error) return <ErrorNote error={error} />;
    if (!data) return <Loading />;

    return (
        <>
            <div className="page-head">
                <div>
                    <h1>My donations</h1>
                    <p className="muted">Where your money is, and what it paid for.</p>
                </div>
                <Link to="/campaigns" className="button">
                    Donate again
                </Link>
            </div>
            <div className="stats-grid wide">
                <Stat label="Wallet balance" value={<Amount value={balance} />} hint={<WalletGate action="get test tokens"><FaucetButton label="Get test tokens" /></WalletGate>} />
                <Stat label="You donated" value={<Amount value={data.totalDonated} />} />
                <Stat label="Refunded to you" value={<Amount value={data.totalRefunded} />} />
            </div>

            <Section title="Campaigns you support">
                {data.campaigns.length === 0 ? (
                    <Empty>
                        You have not donated yet. <Link to="/campaigns">Browse campaigns</Link>.
                    </Empty>
                ) : (
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Campaign</th>
                                <th>You gave</th>
                                <th>Progress</th>
                                <th>Paid to people</th>
                                <th>Refund</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.campaigns.map((c) => (
                                <tr key={c.id}>
                                    <td>
                                        <Link to={`/campaigns/${c.id}`}>{c.title || `Campaign #${c.id}`}</Link> <StatusBadge status={c.status} />
                                    </td>
                                    <td>
                                        <Amount value={c.myContribution} />
                                    </td>
                                    <td style={{ minWidth: 140 }}>
                                        <Progress value={c.donated} max={c.targetAmount} />
                                    </td>
                                    <td>
                                        <Amount value={c.released} />
                                    </td>
                                    <td>
                                        {c.refundClaimed ? (
                                            <span className="small muted">claimed</span>
                                        ) : c.refundable > 0n ? (
                                            <Link to={`/campaigns/${c.id}`} className="button small">
                                                Claim <Amount value={c.refundable} />
                                            </Link>
                                        ) : (
                                            <span className="small muted">{c.status === "Active" ? "if it closes" : "none"}</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Section>

            <Section title="History">
                {data.donations.length + data.refunds.length === 0 ? (
                    <Empty>No transactions yet.</Empty>
                ) : (
                    <ul className="list">
                        {[...data.donations.map((d) => ({ ...d, kind: "Donation" })), ...data.refunds.map((r) => ({ ...r, kind: "Refund" }))]
                            .sort((a, b) => b.blockNumber - a.blockNumber)
                            .map((t) => (
                                <li key={t.txHash}>
                                    <strong>{t.kind}</strong> <Amount value={t.amount} /> · campaign #{t.campaignId}
                                    <div className="small muted">
                                        {formatDate(t.timestamp)} · block {t.blockNumber} · <TxHash hash={t.txHash} />
                                    </div>
                                </li>
                            ))}
                    </ul>
                )}
            </Section>
        </>
    );
}

const APP_STATUS = {
    pending: ["Submitted", "The NGO is reviewing your application."],
    declined: ["Rejected", "The NGO did not select you for this campaign."],
};
const CHAIN_STATUS_HELP = {
    Registered: "Selected by the NGO. Waiting for a verifier to approve you.",
    Approved: "Approved. Payments from this campaign can reach you.",
    Revoked: "Removed by a verifier. You cannot receive payments from this campaign.",
};

export function BeneficiaryAssistance() {
    const { user } = useAuth();
    const { contracts } = useWeb3();
    const { runTx } = useTx();
    const { data, error } = useData(async () => {
        const [applications, info] = await Promise.all([api.myApplications(), user.wallet ? api.beneficiary(user.wallet) : null]);
        const ids = [...new Set([...applications.map((a) => a.campaignId), ...(info?.registrations || []).map((r) => r.campaignId)])];
        const titles = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, (await api.campaign(id)).metadata?.title])));
        return { applications, info, titles };
    }, [user.wallet]);

    if (!user.wallet) return <NeedsWallet />;
    if (error) return <ErrorNote error={error} />;
    if (!data) return <Loading />;

    const { info, titles } = data;
    const registeredIds = new Set(info.registrations.map((r) => r.campaignId));
    const openApplications = data.applications.filter((a) => !registeredIds.has(a.campaignId));
    const mine = info.milestones.filter((m) => sameAddress(m.beneficiary, user.wallet));
    const received = mine.filter((m) => m.status === "Released" || m.status === "Confirmed");
    const inProgress = mine.filter((m) => m.status === "Submitted" || m.status === "Approved");

    return (
        <>
            <div className="page-head">
                <div>
                    <h1>My assistance</h1>
                    <p className="muted">Your applications, your eligibility and the payments sent to your wallet.</p>
                </div>
                <Link to="/campaigns" className="button secondary">
                    Apply to a campaign
                </Link>
            </div>
            <div className="stats-grid wide">
                <Stat label="Received in total" value={<Amount value={info.totalReceived} />} hint="paid straight to your wallet" />
                <Stat label="Campaigns" value={info.registrations.length} hint="you are registered in" />
                <Stat label="In progress" value={inProgress.length} hint="payments being reviewed" />
            </div>

            <Section title="Your eligibility">
                {info.registrations.length === 0 && openApplications.length === 0 ? (
                    <Empty>
                        You have not applied anywhere yet. <Link to="/campaigns">Find a campaign</Link> and click "Apply for help".
                    </Empty>
                ) : (
                    <table className="table">
                        <tbody>
                            {info.registrations.map((r) => (
                                <tr key={`r-${r.campaignId}`}>
                                    <td>
                                        <Link to={`/campaigns/${r.campaignId}`}>{titles[r.campaignId] || `Campaign #${r.campaignId}`}</Link>
                                    </td>
                                    <td>
                                        <StatusBadge status={r.status} />
                                    </td>
                                    <td className="small muted">{CHAIN_STATUS_HELP[r.status]}</td>
                                </tr>
                            ))}
                            {openApplications.map((a) => (
                                <tr key={a.id}>
                                    <td>
                                        <Link to={`/campaigns/${a.campaignId}`}>{titles[a.campaignId] || `Campaign #${a.campaignId}`}</Link>
                                    </td>
                                    <td>
                                        <StatusBadge status={APP_STATUS[a.status]?.[0] || a.status} />
                                    </td>
                                    <td className="small muted">
                                        {APP_STATUS[a.status]?.[1]} {a.reviewNote && <em>"{a.reviewNote}"</em>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Section>

            <Section title="Payments received">
                <MilestoneList
                    milestones={received}
                    showCampaign
                    emptyText="No payments received yet."
                    actions={(m) =>
                        m.status === "Released" ? (
                            <WalletGate action="confirm receipt">
                                <span className="small muted">Did you receive this help?</span>
                                <button
                                    type="button"
                                    className="button"
                                    onClick={() => runTx(`Confirm I received payment #${m.id}`, () => contracts.MilestoneDisbursement.confirmReceipt(m.id))}
                                >
                                    Yes, I received it
                                </button>
                            </WalletGate>
                        ) : null
                    }
                />
            </Section>

            <Section title="Payments in progress">
                <MilestoneList milestones={inProgress} showCampaign emptyText="Nothing in progress." />
            </Section>
        </>
    );
}
