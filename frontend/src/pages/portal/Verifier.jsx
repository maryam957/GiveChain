import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useData } from "../../lib/useData";
import { formatAmount, sameAddress, SYMBOL } from "../../lib/format";
import { useWeb3 } from "../../context/Web3Context";
import { useAuth } from "../../context/AuthContext";
import { useTx } from "../../context/TxContext";
import MilestoneList from "../../components/MilestoneList";
import { WalletGate } from "../../components/Wallet";
import { Address, Empty, ErrorNote, Loading, Section, StatusBadge } from "../../components/ui";
import { RequireApproved } from "./PortalLayout";

const TABS = [
    ["people", "People to approve"],
    ["payments", "Payments to review"],
    ["approved", "Approved, not paid"],
    ["registered", "All approved people"],
];

export function VerifierReview() {
    const { contracts, account } = useWeb3();
    const { user } = useAuth();
    const { runTx } = useTx();
    const [tab, setTab] = useState("people");

    const { data, error } = useData(async () => {
        const list = await api.campaigns("?status=Active");
        return Promise.all(
            list.map(async (c) => {
                const [detail, applications] = await Promise.all([api.campaign(c.id), api.campaignApplications(c.id).catch(() => [])]);
                return { ...detail, applications };
            })
        );
    });

    if (error) return <ErrorNote error={error} />;
    if (!data) return <Loading />;

    const people = [];
    for (const c of data) {
        for (const b of c.beneficiaries) {
            people.push({ campaign: c, ...b, application: c.applications.find((a) => sameAddress(a.wallet, b.wallet)) });
        }
    }
    const pendingPeople = people.filter((p) => p.status === "Registered");
    const approvedPeople = people.filter((p) => p.status === "Approved");
    const milestones = data.flatMap((c) => c.milestones.map((m) => ({ ...m, campaign: c })));
    const submitted = milestones.filter((m) => m.status === "Submitted");
    const approved = milestones.filter((m) => m.status === "Approved");
    const counts = { people: pendingPeople.length, payments: submitted.length, approved: approved.length, registered: approvedPeople.length };

    const me = user.wallet || account;
    const approvePerson = (p) =>
        runTx(`Approve ${p.application?.fullName || "beneficiary"} for "${p.campaign.metadata?.title}"`, () =>
            contracts.ProjectRegistry.approveBeneficiary(p.campaign.id, p.wallet)
        );
    const revokePerson = (p) => {
        if (!window.confirm("Revoke this person? They can never be paid in this campaign again.")) return;
        runTx(`Revoke ${p.application?.fullName || "beneficiary"}`, () => contracts.ProjectRegistry.revokeBeneficiary(p.campaign.id, p.wallet));
    };

    const PersonCard = ({ p, actions }) => (
        <div className="item-card">
            <div className="item-card-head">
                <div>
                    <strong>{p.application?.fullName || "Added directly by the NGO"}</strong>{" "}
                    <span className="small muted">
                        in <Link to={`/campaigns/${p.campaign.id}`}>{p.campaign.metadata?.title}</Link>
                    </span>
                </div>
                <StatusBadge status={p.status} />
            </div>
            <dl className="facts">
                <dt>Wallet</dt>
                <dd>
                    <Address value={p.wallet} />
                </dd>
                {p.application ? (
                    <>
                        <dt>ID number</dt>
                        <dd>{p.application.idNumber}</dd>
                        <dt>Household</dt>
                        <dd>{p.application.householdSize || "-"}</dd>
                        <dt>Reason</dt>
                        <dd>{p.application.reason}</dd>
                    </>
                ) : (
                    <>
                        <dt>Details</dt>
                        <dd className="muted">The NGO added this person directly; ask the NGO for their records before approving.</dd>
                    </>
                )}
                <dt>Registered by</dt>
                <dd>
                    <Address value={p.campaign.ngo} />
                </dd>
            </dl>
            <WalletGate action="review people">
                <div className="row">{actions}</div>
            </WalletGate>
        </div>
    );

    return (
        <RequireApproved type="verifier">
            <div className="page-head">
                <div>
                    <h1>Review queue</h1>
                    <p className="muted">Check people and evidence independently of the NGO. Every decision is recorded on-chain.</p>
                </div>
            </div>
            <div className="tabs" role="tablist">
                {TABS.map(([key, label]) => (
                    <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "tab active" : "tab"} onClick={() => setTab(key)}>
                        {label}
                        {counts[key] > 0 && key !== "registered" && <span className="tab-count">{counts[key]}</span>}
                    </button>
                ))}
            </div>

            {tab === "people" &&
                (pendingPeople.length === 0 ? (
                    <Empty>Nobody is waiting for approval.</Empty>
                ) : (
                    pendingPeople.map((p) => (
                        <PersonCard
                            key={`${p.campaign.id}-${p.wallet}`}
                            p={p}
                            actions={
                                sameAddress(p.wallet, me) ? (
                                    <span className="small muted">You cannot approve yourself.</span>
                                ) : (
                                    <>
                                        <button type="button" className="button" onClick={() => approvePerson(p)}>
                                            Approve person
                                        </button>
                                        <button type="button" className="button danger" onClick={() => revokePerson(p)}>
                                            Reject (revoke)
                                        </button>
                                    </>
                                )
                            }
                        />
                    ))
                ))}

            {tab === "payments" && (
                <Section>
                    <MilestoneList
                        milestones={submitted}
                        showCampaign
                        emptyText="No payment requests are waiting."
                        actions={(m) => {
                            if (sameAddress(m.campaign.ngo, me)) return <span className="small muted">You run this campaign, so you cannot review it.</span>;
                            if (sameAddress(m.beneficiary, me)) return <span className="small muted">This payment is to you, so you cannot review it.</span>;
                            return (
                                <WalletGate action="review payments">
                                    <span className="small muted">Open the evidence before deciding.</span>
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
                                        onClick={() => runTx(`Reject payment #${m.id}`, () => contracts.MilestoneDisbursement.rejectMilestone(m.id))}
                                    >
                                        Reject
                                    </button>
                                </WalletGate>
                            );
                        }}
                    />
                </Section>
            )}

            {tab === "approved" && (
                <Section>
                    <MilestoneList
                        milestones={approved}
                        showCampaign
                        emptyText="Nothing is waiting to be released."
                        actions={(m) => (
                            <WalletGate action="cancel payments">
                                <span className="small muted">Waiting for the NGO to release.</span>
                                <button
                                    type="button"
                                    className="button secondary"
                                    onClick={() => {
                                        if (window.confirm("Cancel this approved payment? Its reserved money goes back to the campaign.")) {
                                            runTx(`Cancel payment #${m.id}`, () => contracts.MilestoneDisbursement.cancelMilestone(m.id));
                                        }
                                    }}
                                >
                                    Cancel payment
                                </button>
                            </WalletGate>
                        )}
                    />
                </Section>
            )}

            {tab === "registered" &&
                (approvedPeople.length === 0 ? (
                    <Empty>No approved people.</Empty>
                ) : (
                    approvedPeople.map((p) => (
                        <PersonCard
                            key={`${p.campaign.id}-${p.wallet}`}
                            p={p}
                            actions={
                                <button type="button" className="button danger" onClick={() => revokePerson(p)}>
                                    Revoke
                                </button>
                            }
                        />
                    ))
                ))}
        </RequireApproved>
    );
}
