import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useData } from "../../lib/useData";
import { formatDate } from "../../lib/format";
import { useWeb3 } from "../../context/Web3Context";
import { useTx } from "../../context/TxContext";
import MilestoneList from "../../components/MilestoneList";
import { Amount, Empty, ErrorNote, Loading, Section, Stat, StatusBadge } from "../../components/ui";

const STATUS_HELP = {
    Registered: "Registered by the NGO. Waiting for an auditor to approve you.",
    Approved: "Approved. You can receive payments from this campaign.",
    Revoked: "Removed by an auditor. You cannot receive payments from this campaign.",
};

export default function BeneficiaryPanel() {
    const { account, contracts } = useWeb3();
    const { runTx } = useTx();
    const { data, error } = useData(() => api.beneficiary(account), [account]);
    if (error) return <ErrorNote error={error} />;
    if (!data) return <Loading />;

    const pending = data.milestones.filter((m) => m.status === "Submitted" || m.status === "Approved");
    const received = data.milestones.filter((m) => m.status === "Released" || m.status === "Confirmed");

    return (
        <>
            <div className="stats-grid wide">
                <Stat label="Received in total" value={<Amount value={data.totalReceived} />} hint="paid straight to your wallet" />
                <Stat label="Campaigns" value={data.registrations.length} />
                <Stat label="Waiting" value={pending.length} hint="payments being reviewed" />
            </div>

            <Section title="Your eligibility">
                {data.registrations.length === 0 ? (
                    <Empty>This wallet is not registered as a beneficiary in any campaign.</Empty>
                ) : (
                    <table className="table">
                        <tbody>
                            {data.registrations.map((r) => (
                                <tr key={r.campaignId}>
                                    <td>
                                        <Link to={`/campaigns/${r.campaignId}`}>Campaign #{r.campaignId}</Link>{" "}
                                        <span className="small muted">({r.campaignStatus})</span>
                                    </td>
                                    <td>
                                        <StatusBadge status={r.status} />
                                    </td>
                                    <td className="small muted">{STATUS_HELP[r.status]}</td>
                                    <td className="small muted">{formatDate(r.updatedAt)}</td>
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
                            <>
                                <span className="small muted">Did the assistance arrive?</span>
                                <button
                                    type="button"
                                    className="button"
                                    onClick={() =>
                                        runTx(`Confirm receipt of payment #${m.id}`, () =>
                                            contracts.MilestoneDisbursement.confirmReceipt(m.id)
                                        )
                                    }
                                >
                                    Confirm I received it
                                </button>
                            </>
                        ) : null
                    }
                />
            </Section>

            <Section title="Payments in progress">
                <MilestoneList milestones={pending} showCampaign emptyText="Nothing in progress." />
            </Section>
        </>
    );
}
