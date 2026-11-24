import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useData } from "../../lib/useData";
import { formatDate } from "../../lib/format";
import { useWeb3 } from "../../context/Web3Context";
import { FaucetButton } from "../Campaign";
import { Amount, Empty, ErrorNote, Loading, Progress, Section, Stat, StatusBadge, TxHash } from "../../components/ui";

export default function DonorPanel() {
    const { account, balance, readContracts } = useWeb3();
    const { data, error } = useData(async () => {
        const donor = await api.donor(account);
        // Refundable amounts come straight from the contract, not the backend.
        const refundable = await Promise.all(
            donor.campaigns.map((c) => readContracts.DonationVault.refundableAmount(c.id, account))
        );
        return { ...donor, campaigns: donor.campaigns.map((c, i) => ({ ...c, refundable: refundable[i] })) };
    }, [account, readContracts]);

    if (error) return <ErrorNote error={error} />;
    if (!data) return <Loading />;

    return (
        <>
            <div className="stats-grid wide">
                <Stat label="Wallet balance" value={<Amount value={balance} />} hint={<FaucetButton label="Get test tokens" />} />
                <Stat label="You donated" value={<Amount value={data.totalDonated} />} />
                <Stat label="Refunded to you" value={<Amount value={data.totalRefunded} />} />
            </div>

            <Section title="Campaigns you support">
                {data.campaigns.length === 0 ? (
                    <Empty>
                        You have not donated yet. <Link to="/">Browse campaigns</Link>.
                    </Empty>
                ) : (
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Campaign</th>
                                <th>You gave</th>
                                <th>Campaign progress</th>
                                <th>Paid to people</th>
                                <th>Refund</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.campaigns.map((c) => (
                                <tr key={c.id}>
                                    <td>
                                        <Link to={`/campaigns/${c.id}`}>Campaign #{c.id}</Link> <StatusBadge status={c.status} />
                                    </td>
                                    <td>
                                        <Amount value={c.myContribution} />
                                    </td>
                                    <td style={{ minWidth: 140 }}>
                                        <Progress value={c.donated} max={c.targetAmount} />
                                        <span className="small muted">
                                            <Amount value={c.donated} /> / <Amount value={c.targetAmount} />
                                        </span>
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
                                            <span className="small muted">{c.status === "Active" ? "after it closes" : "none"}</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Section>

            <Section title="Your transactions">
                {data.donations.length + data.refunds.length === 0 ? (
                    <Empty>No transactions yet.</Empty>
                ) : (
                    <ul className="list">
                        {[
                            ...data.donations.map((d) => ({ ...d, kind: "Donation" })),
                            ...data.refunds.map((r) => ({ ...r, kind: "Refund" })),
                        ]
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
