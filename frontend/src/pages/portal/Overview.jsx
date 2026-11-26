import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useData } from "../../lib/useData";
import { sameAddress } from "../../lib/format";
import { useWeb3 } from "../../context/Web3Context";
import { ACCOUNT_LABELS, useAuth } from "../../context/AuthContext";
import { useWalletState } from "../../components/Wallet";
import { Amount, Loading } from "../../components/ui";

function Checklist() {
    const { user, approved } = useAuth();
    const walletState = useWalletState();
    const needsApproval = ["ngo", "verifier"].includes(user.accountType);
    const items = [
        ["Create your account", true],
        ["Link your MetaMask wallet", Boolean(user.wallet), "/app/profile"],
        ["Connect MetaMask on this device", walletState === "ready", "/app/profile"],
    ];
    if (needsApproval) items.push([`Get approved as ${ACCOUNT_LABELS[user.accountType]} (on-chain)`, approved]);
    if (items.every(([, done]) => done)) return null;
    return (
        <section className="card">
            <h2>Get started</h2>
            <ol className="checklist">
                {items.map(([text, done, link]) => (
                    <li key={text} className={done ? "done" : ""}>
                        <span className="check">{done ? "✓" : ""}</span>
                        {done || !link ? text : <Link to={link}>{text}</Link>}
                    </li>
                ))}
            </ol>
        </section>
    );
}

function Todo({ items }) {
    const open = items.filter((i) => i.count > 0);
    return (
        <section className="card">
            <h2>Your to-do list</h2>
            {open.length === 0 ? (
                <p className="muted">Nothing needs your attention right now.</p>
            ) : (
                <div className="todo-grid">
                    {open.map((i) => (
                        <Link key={i.text} to={i.to} className="todo">
                            <span className="todo-count">{i.count}</span>
                            <span>{i.text}</span>
                        </Link>
                    ))}
                </div>
            )}
        </section>
    );
}

function AdminTodo() {
    const { paused } = useWeb3();
    const { data } = useData(() => api.roleApplications("pending"));
    if (!data) return <Loading />;
    return (
        <>
            <Todo items={[{ count: data.length, text: "NGO / verifier applications waiting for you", to: "/app/applications" }]} />
            <section className="card">
                <h2>System</h2>
                <p>
                    Status: <strong>{paused ? "Paused" : "Running"}</strong> · <Link to="/app/system">Manage</Link>
                </p>
            </section>
        </>
    );
}

function NgoTodo() {
    const { user } = useAuth();
    const { data } = useData(async () => {
        const campaigns = await api.campaigns(`?ngo=${user.wallet}`);
        const details = await Promise.all(campaigns.map((c) => api.campaign(c.id)));
        const applications = await Promise.all(
            campaigns.filter((c) => c.status === "Active").map((c) => api.campaignApplications(c.id).catch(() => []))
        );
        return { details, applications: applications.flat() };
    }, [user.wallet]);
    if (!data) return <Loading />;
    const toRelease = data.details.flatMap((c) => c.milestones.filter((m) => m.status === "Approved" && c.status === "Active"));
    return (
        <>
            <Todo
                items={[
                    { count: data.applications.filter((a) => a.status === "pending").length, text: "people applied for help", to: "/app/campaigns" },
                    { count: toRelease.length, text: "approved payments ready to release", to: "/app/campaigns" },
                ]}
            />
            <section className="card">
                <h2>Your campaigns</h2>
                <p>
                    {data.details.length} campaign(s), {data.details.filter((c) => c.status === "Active").length} active.{" "}
                    <Link to="/app/campaigns">Manage campaigns →</Link>
                </p>
            </section>
        </>
    );
}

function VerifierTodo() {
    const { data } = useData(async () => {
        const list = await api.campaigns("?status=Active");
        return Promise.all(list.map((c) => api.campaign(c.id)));
    });
    if (!data) return <Loading />;
    const people = data.flatMap((c) => c.beneficiaries.filter((b) => b.status === "Registered"));
    const payments = data.flatMap((c) => c.milestones.filter((m) => m.status === "Submitted"));
    return (
        <Todo
            items={[
                { count: people.length, text: "people waiting for your approval", to: "/app/review" },
                { count: payments.length, text: "payment requests to review", to: "/app/review" },
            ]}
        />
    );
}

function DonorTodo() {
    const { user } = useAuth();
    const { readContracts } = useWeb3();
    const { data } = useData(async () => {
        if (!user.wallet) return null;
        const donor = await api.donor(user.wallet);
        const refundable = await Promise.all(
            donor.campaigns.map((c) => readContracts.DonationVault.refundableAmount(c.id, user.wallet))
        );
        return { donor, refunds: refundable.filter((r) => r > 0n).length };
    }, [user.wallet, readContracts]);
    if (!user.wallet) return null;
    if (!data) return <Loading />;
    return (
        <>
            <Todo items={[{ count: data.refunds, text: "refunds you can claim", to: "/app/donations" }]} />
            <section className="card">
                <h2>Your giving</h2>
                <p>
                    You donated <strong><Amount value={data.donor.totalDonated} /></strong> to {data.donor.campaigns.length} campaign(s).{" "}
                    <Link to="/app/donations">See details →</Link>
                </p>
                <Link to="/campaigns" className="button">
                    Find a campaign to support
                </Link>
            </section>
        </>
    );
}

function BeneficiaryTodo() {
    const { user } = useAuth();
    const { data } = useData(async () => {
        const [apps, info] = await Promise.all([api.myApplications(), user.wallet ? api.beneficiary(user.wallet) : null]);
        return { apps, info };
    }, [user.wallet]);
    if (!data) return <Loading />;
    const toConfirm = data.info ? data.info.milestones.filter((m) => m.status === "Released" && sameAddress(m.beneficiary, user.wallet)) : [];
    return (
        <>
            <Todo items={[{ count: toConfirm.length, text: "payments to confirm you received", to: "/app/assistance" }]} />
            <section className="card">
                <h2>Your assistance</h2>
                <p>
                    {data.apps.length} application(s) · received <strong><Amount value={data.info?.totalReceived || 0} /></strong>.{" "}
                    <Link to="/app/assistance">See details →</Link>
                </p>
                <Link to="/campaigns" className="button secondary">
                    Find a campaign to apply to
                </Link>
            </section>
        </>
    );
}

export default function Overview() {
    const { user, approved } = useAuth();
    const type = user.accountType;
    const needsApproval = ["ngo", "verifier", "admin"].includes(type);

    return (
        <>
            <div className="page-head">
                <div>
                    <h1>Hello, {user.name.split(" ")[0]}</h1>
                    <p className="muted">
                        {ACCOUNT_LABELS[type]} account
                        {user.roleApplication?.organisationName && ` · ${user.roleApplication.organisationName}`}
                    </p>
                </div>
            </div>
            <Checklist />
            {needsApproval && !approved ? null : (
                <>
                    {type === "admin" && <AdminTodo />}
                    {type === "ngo" && <NgoTodo />}
                    {type === "verifier" && <VerifierTodo />}
                    {type === "donor" && <DonorTodo />}
                    {type === "beneficiary" && <BeneficiaryTodo />}
                </>
            )}
        </>
    );
}
