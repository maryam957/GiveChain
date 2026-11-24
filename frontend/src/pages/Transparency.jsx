import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useData } from "../lib/useData";
import { formatDate } from "../lib/format";
import { useWeb3 } from "../context/Web3Context";
import { Address, Amount, Empty, ErrorNote, Evidence, Loading, Page, Section, Stat, StatusBadge, TxHash } from "../components/ui";

const EVENT_TEXT = {
    CampaignCreated: "Campaign created",
    CampaignStatusChanged: "Campaign status changed",
    BeneficiaryRegistered: "Person registered",
    BeneficiaryStatusChanged: "Person status changed",
    DonationReceived: "Donation",
    FundsReserved: "Money reserved for a payment",
    ReservationCancelled: "Reservation cancelled",
    FundsReleased: "Paid to person",
    RefundClaimed: "Refund to donor",
    MilestoneSubmitted: "Payment requested",
    MilestoneApproved: "Payment approved",
    MilestoneRejected: "Payment rejected",
    MilestoneCancelled: "Payment cancelled",
    MilestoneReleased: "Payment released",
    ReceiptConfirmed: "Receipt confirmed",
    RoleGranted: "Role granted",
    RoleRevoked: "Role removed",
    Paused: "System paused",
    Unpaused: "System unpaused",
    DisbursementContractSet: "Vault linked to payment contract",
};

export default function Transparency() {
    const { readContracts, config } = useWeb3();
    const [limit, setLimit] = useState(30);
    const stats = useData(() => api.stats());
    const activity = useData(() => api.activity(`?limit=${limit}`), [limit]);

    // Independent check: the vault's real token balance, read straight from the chain.
    const onChain = useData(async () => {
        if (!readContracts || !config) return null;
        return readContracts.MockUSDC.balanceOf(config.contracts.DonationVault.address);
    }, [readContracts, config]);

    if (stats.error) return <Page><ErrorNote error={stats.error} /></Page>;
    if (!stats.data) return <Page><Loading /></Page>;
    const s = stats.data;
    const matches = onChain.data !== null && onChain.data !== undefined && BigInt(s.totalHeld) === onChain.data;

    return (
        <Page>
            <h1>Transparency</h1>
            <p className="lead">
                Every number here is rebuilt from public blockchain events. You do not have to trust this website: each line
                links to a transaction you can check yourself.
            </p>

            <div className="stats-grid wide">
                <Stat label="Total donated" value={<Amount value={s.totalDonated} />} />
                <Stat label="Paid directly to people" value={<Amount value={s.totalReleased} />} />
                <Stat label="Reserved for approved payments" value={<Amount value={s.totalReserved} />} />
                <Stat label="Refunded to donors" value={<Amount value={s.totalRefunded} />} />
                <Stat label="Still held in the vault" value={<Amount value={s.totalHeld} />} />
                <Stat label="People assisted" value={s.beneficiariesAssisted} hint={`${s.beneficiariesApproved} approved in total`} />
                <Stat label="Campaigns" value={s.campaigns.total} hint={`${s.campaigns.Active} active · ${s.campaigns.Completed} completed · ${s.campaigns.Cancelled} cancelled`} />
                <Stat label="Donations" value={s.donations} hint={`from ${s.donors} donors`} />
            </div>

            <Section title="Independent check">
                {onChain.data === null || onChain.data === undefined ? (
                    <Loading />
                ) : (
                    <p>
                        The vault contract really holds <strong><Amount value={onChain.data} /></strong> (read directly from the
                        token contract).{" "}
                        {matches ? (
                            <span className="verified">✓ Matches the indexed total above.</span>
                        ) : (
                            <span className="error-note">Does not match the index yet; it may still be catching up.</span>
                        )}
                    </p>
                )}
                <p className="small muted">
                    Vault address: <code>{config?.contracts.DonationVault.address}</code> · indexed up to block {s.lastIndexedBlock}
                </p>
            </Section>

            <Section title="On-chain activity">
                {activity.error && <ErrorNote error={activity.error} />}
                {!activity.data ? (
                    <Loading />
                ) : activity.data.length === 0 ? (
                    <Empty>No activity yet.</Empty>
                ) : (
                    <table className="table activity">
                        <thead>
                            <tr>
                                <th>What</th>
                                <th>Details</th>
                                <th>When</th>
                                <th>Transaction</th>
                            </tr>
                        </thead>
                        <tbody>
                            {activity.data.map((a) => (
                                <tr key={`${a.txHash}-${a.logIndex}`}>
                                    <td>
                                        <strong>{EVENT_TEXT[a.event] || a.event}</strong>
                                        {a.status && (
                                            <>
                                                {" "}
                                                <StatusBadge status={a.status} />
                                            </>
                                        )}
                                    </td>
                                    <td className="small">
                                        {a.amount && (
                                            <>
                                                <Amount value={a.amount} />{" "}
                                            </>
                                        )}
                                        {a.campaignId && <Link to={`/campaigns/${a.campaignId}`}>campaign #{a.campaignId}</Link>}
                                        {a.milestoneId && <> · payment #{a.milestoneId}</>}
                                        {a.beneficiary && (
                                            <>
                                                {" "}· to <Address value={a.beneficiary} />
                                            </>
                                        )}
                                        {a.actor && (
                                            <>
                                                {" "}· by <Address value={a.actor} />
                                            </>
                                        )}
                                        {a.role && <> · {a.role}</>}
                                        {a.cid && (
                                            <>
                                                {" "}· <Evidence cid={a.cid} label="file" />
                                            </>
                                        )}
                                    </td>
                                    <td className="small muted">
                                        {formatDate(a.timestamp)}
                                        <div>block {a.blockNumber}</div>
                                    </td>
                                    <td>
                                        <TxHash hash={a.txHash} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                {activity.data?.length === limit && (
                    <button type="button" className="button secondary" onClick={() => setLimit(limit + 50)}>
                        Show more
                    </button>
                )}
            </Section>
        </Page>
    );
}
