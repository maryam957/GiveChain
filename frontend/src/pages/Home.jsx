import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useData } from "../lib/useData";
import { useAuth } from "../context/AuthContext";
import { Address, Amount, Empty, ErrorNote, Loading, Page, Progress, StatusBadge } from "../components/ui";

export function CampaignCard({ c }) {
    return (
        <Link to={`/campaigns/${c.id}`} className="campaign-card">
            <div className="campaign-card-top">
                <span className="small muted">{c.metadata?.category || "Campaign"}</span>
                <StatusBadge status={c.status} />
            </div>
            <h3>{c.metadata?.title || `Campaign #${c.id}`}</h3>
            <p className="muted">{c.metadata?.summary || ""}</p>
            <div className="small">
                by <Address value={c.ngo} />
            </div>
            <Progress value={c.donated} max={c.targetAmount} />
            <div className="campaign-card-numbers">
                <span>
                    <strong><Amount value={c.donated} /></strong> <span className="muted">of</span> <Amount value={c.targetAmount} />
                </span>
                <span className="small muted">
                    {c.donorCount} donors · {c.approvedBeneficiaryCount} people approved
                </span>
            </div>
        </Link>
    );
}

export default function Home() {
    const { user } = useAuth();
    const campaigns = useData(() => api.campaigns("?status=Active"));
    const stats = useData(() => api.stats());

    return (
        <Page>
            <section className="hero">
                <span className="eyebrow">Transparent giving, enforced by smart contracts</span>
                <h1>Your donation goes to the people it was meant for. You can check every step.</h1>
                <p className="lead">
                    Donations are held by a smart contract, not by the charity. Money is only released directly to a
                    registered person's wallet, after an independent verifier has checked the evidence.
                </p>
                <div className="row">
                    <Link to="/campaigns" className="button large">
                        Donate to a campaign
                    </Link>
                    {!user && (
                        <Link to="/signup" className="button secondary large">
                            Join as an NGO, verifier or beneficiary
                        </Link>
                    )}
                    {user && (
                        <Link to="/app" className="button secondary large">
                            Go to my portal
                        </Link>
                    )}
                </div>
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
                            <Link to="/transparency">Check every transaction →</Link>
                        </div>
                    </div>
                )}
            </section>

            <section className="trust-strip">
                <div>
                    <strong>The NGO never holds the money</strong>
                    <span>Funds stay in the vault contract until a payment is approved.</span>
                </div>
                <div>
                    <strong>Independent verifiers</strong>
                    <span>Every beneficiary and every payment is approved by someone other than the NGO.</span>
                </div>
                <div>
                    <strong>Public and permanent</strong>
                    <span>Every donation, approval and payment is recorded on the blockchain.</span>
                </div>
                <div>
                    <strong>Refunds built in</strong>
                    <span>If a campaign closes, donors can claim back their share of unspent money.</span>
                </div>
            </section>

            <div className="page-head">
                <h2>Active campaigns</h2>
                <Link to="/campaigns">See all campaigns →</Link>
            </div>
            {campaigns.loading && !campaigns.data && <Loading />}
            <ErrorNote error={campaigns.error} />
            {campaigns.data && campaigns.data.length === 0 && <Empty>No active campaigns yet.</Empty>}
            <div className="campaign-grid">
                {campaigns.data?.slice(0, 6).map((c) => (
                    <CampaignCard key={c.id} c={c} />
                ))}
            </div>
        </Page>
    );
}
