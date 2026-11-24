import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useData } from "../lib/useData";
import { Amount, Empty, ErrorNote, Loading, Progress, StatusBadge } from "../components/ui";

const STEPS = [
    ["Donate", "Donors send test dollars (mUSDC) to a campaign. The money goes into a smart-contract vault, never to the NGO."],
    ["Register people", "The NGO registers the people it wants to help. An independent auditor must approve each one."],
    ["Request a payment", "The NGO asks to pay a specific person, with evidence (receipts, photos) stored on IPFS."],
    ["Approve and pay", "An auditor checks the evidence and approves. The vault then pays the person's wallet directly."],
];

export function CampaignCard({ c }) {
    return (
        <Link to={`/campaigns/${c.id}`} className="campaign-card">
            <div className="campaign-card-top">
                <span className="small muted">{c.metadata?.category || "Campaign"} · #{c.id}</span>
                <StatusBadge status={c.status} />
            </div>
            <h3>{c.metadata?.title || `Campaign #${c.id}`}</h3>
            <p className="muted">{c.metadata?.summary || c.metadataError || ""}</p>
            <Progress value={c.donated} max={c.targetAmount} />
            <div className="campaign-card-numbers">
                <span>
                    <Amount value={c.donated} /> <span className="muted">of</span> <Amount value={c.targetAmount} />
                </span>
                <span className="small muted">
                    {c.donorCount} donors · {c.approvedBeneficiaryCount} people approved
                </span>
            </div>
        </Link>
    );
}

export default function Home() {
    const campaigns = useData(() => api.campaigns());
    const stats = useData(() => api.stats());

    return (
        <>
            <section className="hero">
                <h1>Donations controlled by code, not by trust.</h1>
                <p className="lead">
                    GiveChain keeps donated money in a smart contract. It only leaves the vault as a direct payment to an
                    approved person, after an independent auditor has checked the evidence. Every step is public on the
                    blockchain.
                </p>
                {stats.data && (
                    <div className="hero-stats">
                        <div>
                            <strong><Amount value={stats.data.totalDonated} /></strong>
                            <span>donated</span>
                        </div>
                        <div>
                            <strong><Amount value={stats.data.totalReleased} /></strong>
                            <span>paid directly to people</span>
                        </div>
                        <div>
                            <strong>{stats.data.beneficiariesAssisted}</strong>
                            <span>people assisted</span>
                        </div>
                        <div>
                            <Link to="/transparency">See every transaction →</Link>
                        </div>
                    </div>
                )}
            </section>

            <section className="steps">
                {STEPS.map(([title, text], i) => (
                    <div className="step" key={title}>
                        <div className="step-number">{i + 1}</div>
                        <h3>{title}</h3>
                        <p className="muted">{text}</p>
                    </div>
                ))}
            </section>

            <h2 className="section-title">Campaigns</h2>
            {campaigns.loading && !campaigns.data && <Loading />}
            <ErrorNote error={campaigns.error} />
            {campaigns.data && campaigns.data.length === 0 && <Empty>No campaigns yet.</Empty>}
            <div className="campaign-grid">
                {campaigns.data?.map((c) => (
                    <CampaignCard key={c.id} c={c} />
                ))}
            </div>
        </>
    );
}
