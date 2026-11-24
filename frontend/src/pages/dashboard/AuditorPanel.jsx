import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useData } from "../../lib/useData";
import { formatAmount, sameAddress, SYMBOL } from "../../lib/format";
import { useWeb3 } from "../../context/Web3Context";
import { useTx } from "../../context/TxContext";
import MilestoneList from "../../components/MilestoneList";
import { Address, Empty, ErrorNote, Loading, Section, StatusBadge } from "../../components/ui";

export default function AuditorPanel() {
    const { contracts, account } = useWeb3();
    const { runTx } = useTx();

    // All active campaigns with their beneficiaries and milestones.
    const { data, error } = useData(async () => {
        const list = await api.campaigns("?status=Active");
        return Promise.all(list.map((c) => api.campaign(c.id)));
    });

    if (error) return <ErrorNote error={error} />;
    if (!data) return <Loading />;

    const pendingPeople = [];
    const approvedPeople = [];
    for (const c of data) {
        for (const b of c.beneficiaries) {
            const row = { campaign: c, ...b };
            if (b.status === "Registered") pendingPeople.push(row);
            if (b.status === "Approved") approvedPeople.push(row);
        }
    }
    const milestones = data.flatMap((c) => c.milestones.map((m) => ({ ...m, campaign: c })));
    const submitted = milestones.filter((m) => m.status === "Submitted");
    const approved = milestones.filter((m) => m.status === "Approved");

    const ownCampaign = (m) => sameAddress(m.campaign.ngo, account);
    const toSelf = (m) => sameAddress(m.beneficiary, account);

    const personRow = (p, actions) => (
        <tr key={`${p.campaign.id}-${p.wallet}`}>
            <td>
                <Link to={`/campaigns/${p.campaign.id}`}>{p.campaign.metadata?.title || `#${p.campaign.id}`}</Link>
            </td>
            <td>
                <Address value={p.wallet} />
            </td>
            <td>
                <StatusBadge status={p.status} />
            </td>
            <td className="row">{actions}</td>
        </tr>
    );

    const approveBeneficiary = (p) =>
        runTx(`Approve beneficiary ${p.wallet.slice(0, 8)}…`, () =>
            contracts.ProjectRegistry.approveBeneficiary(p.campaign.id, p.wallet)
        );
    const revokeBeneficiary = (p) => {
        if (!window.confirm("Revoke this person? They can never be paid in this campaign again. This cannot be undone.")) return;
        runTx(`Revoke beneficiary ${p.wallet.slice(0, 8)}…`, () =>
            contracts.ProjectRegistry.revokeBeneficiary(p.campaign.id, p.wallet)
        );
    };

    return (
        <>
            <Section title={`People waiting for approval (${pendingPeople.length})`}>
                <p className="small muted">
                    Check the NGO's off-chain records for each person before approving. Approval lets them receive payments.
                </p>
                {pendingPeople.length === 0 ? (
                    <Empty>Nobody is waiting.</Empty>
                ) : (
                    <table className="table">
                        <tbody>
                            {pendingPeople.map((p) =>
                                personRow(
                                    p,
                                    <>
                                        <button type="button" className="button" onClick={() => approveBeneficiary(p)}>
                                            Approve
                                        </button>
                                        <button type="button" className="button danger" onClick={() => revokeBeneficiary(p)}>
                                            Revoke
                                        </button>
                                    </>
                                )
                            )}
                        </tbody>
                    </table>
                )}
            </Section>

            <Section title={`Payment requests to review (${submitted.length})`}>
                <MilestoneList
                    milestones={submitted}
                    showCampaign
                    emptyText="No requests are waiting for review."
                    actions={(m) => {
                        const blocked = ownCampaign(m)
                            ? "You own this campaign, so you cannot review it."
                            : toSelf(m)
                              ? "This payment is to you, so you cannot review it."
                              : null;
                        return blocked ? (
                            <span className="small muted">{blocked}</span>
                        ) : (
                            <>
                                <span className="small muted">Open the evidence first.</span>
                                <button
                                    type="button"
                                    className="button"
                                    onClick={() =>
                                        runTx(`Approve payment #${m.id} (${formatAmount(m.amount)} ${SYMBOL})`, () =>
                                            contracts.MilestoneDisbursement.approveMilestone(m.id)
                                        )
                                    }
                                >
                                    Approve and reserve money
                                </button>
                                <button
                                    type="button"
                                    className="button danger"
                                    onClick={() =>
                                        runTx(`Reject payment #${m.id}`, () =>
                                            contracts.MilestoneDisbursement.rejectMilestone(m.id)
                                        )
                                    }
                                >
                                    Reject
                                </button>
                            </>
                        );
                    }}
                />
            </Section>

            <Section title={`Approved, not yet paid (${approved.length})`}>
                <MilestoneList
                    milestones={approved}
                    showCampaign
                    emptyText="Nothing is waiting to be paid."
                    actions={(m) => (
                        <button
                            type="button"
                            className="button secondary"
                            onClick={() => {
                                if (!window.confirm("Cancel this approved payment? Its reserved money goes back to the campaign.")) return;
                                runTx(`Cancel payment #${m.id}`, () => contracts.MilestoneDisbursement.cancelMilestone(m.id));
                            }}
                        >
                            Cancel payment
                        </button>
                    )}
                />
            </Section>

            <Section title={`Approved people (${approvedPeople.length})`}>
                {approvedPeople.length === 0 ? (
                    <Empty>No approved people.</Empty>
                ) : (
                    <table className="table">
                        <tbody>
                            {approvedPeople.map((p) =>
                                personRow(
                                    p,
                                    <button type="button" className="button danger" onClick={() => revokeBeneficiary(p)}>
                                        Revoke
                                    </button>
                                )
                            )}
                        </tbody>
                    </table>
                )}
            </Section>
        </>
    );
}
