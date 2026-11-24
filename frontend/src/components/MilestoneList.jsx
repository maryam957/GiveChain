import { Address, Amount, Empty, Evidence, StatusBadge, TxHash } from "./ui";
import { formatDate } from "../lib/format";

/**
 * Shows payment requests (milestones) with their full on-chain history.
 * `actions(milestone)` can render buttons for the current user's role.
 */
export default function MilestoneList({ milestones, actions, showCampaign = false, emptyText = "No payment requests yet." }) {
    if (!milestones?.length) return <Empty>{emptyText}</Empty>;
    return (
        <div className="milestones">
            {milestones.map((m) => (
                <div className="milestone" key={m.id}>
                    <div className="milestone-head">
                        <div>
                            <strong>Payment #{m.id}</strong>
                            {showCampaign && <span className="muted"> · campaign #{m.campaignId}</span>}
                        </div>
                        <StatusBadge status={m.status} />
                    </div>
                    <div className="milestone-body">
                        <div>
                            <Amount value={m.amount} /> to <Address value={m.beneficiary} />
                        </div>
                        <Evidence cid={m.evidenceCID} />
                    </div>
                    <ol className="timeline">
                        {m.history.map((h) => (
                            <li key={`${h.status}-${h.txHash}`}>
                                <StatusBadge status={h.status} />
                                <span className="small muted">{formatDate(h.timestamp)}</span>
                                {h.actor && (
                                    <span className="small">
                                        by <Address value={h.actor} />
                                    </span>
                                )}
                                <TxHash hash={h.txHash} />
                            </li>
                        ))}
                    </ol>
                    {actions && <div className="milestone-actions">{actions(m)}</div>}
                </div>
            ))}
        </div>
    );
}
