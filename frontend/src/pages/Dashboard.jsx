import { useEffect, useState } from "react";
import { useWeb3 } from "../context/Web3Context";
import { api } from "../lib/api";
import { useData } from "../lib/useData";
import { Address } from "../components/ui";
import DonorPanel from "./dashboard/DonorPanel";
import NgoPanel from "./dashboard/NgoPanel";
import AuditorPanel from "./dashboard/AuditorPanel";
import BeneficiaryPanel from "./dashboard/BeneficiaryPanel";
import AdminPanel from "./dashboard/AdminPanel";

export default function Dashboard() {
    const { account, roles } = useWeb3();
    const beneficiaryInfo = useData(() => (account ? api.beneficiary(account) : null), [account]);
    const isBeneficiary = Boolean(beneficiaryInfo.data?.registrations?.length);

    // Tabs depend on the roles this wallet holds on-chain; registered beneficiaries
    // see their own tab first.
    const tabs = [
        roles.ngo && ["ngo", "NGO", NgoPanel],
        roles.auditor && ["auditor", "Auditor", AuditorPanel],
        (roles.admin || roles.pauser) && ["admin", "Admin", AdminPanel],
        isBeneficiary && ["beneficiary", "Beneficiary", BeneficiaryPanel],
        ["donor", "Donor", DonorPanel],
        !isBeneficiary && ["beneficiary", "Beneficiary", BeneficiaryPanel],
    ].filter(Boolean);

    const [tab, setTab] = useState(tabs[0][0]);
    const tabKeys = tabs.map((t) => t[0]).join(",");
    useEffect(() => {
        setTab(tabs[0][0]);
        // reset to the most relevant tab when the wallet or its roles change
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [account, tabKeys]);

    if (!account) {
        return (
            <div className="card center">
                <h1>My dashboard</h1>
                <p>Connect a wallet (top right) to see your donations, campaigns, approvals or payments.</p>
            </div>
        );
    }

    const active = tabs.find((t) => t[0] === tab) || tabs[0];
    const Panel = active[2];
    const roleList = Object.entries(roles)
        .filter(([, has]) => has)
        .map(([r]) => r);

    return (
        <>
            <div className="dashboard-head">
                <h1>My dashboard</h1>
                <p className="muted">
                    <Address value={account} /> · roles checked on-chain:{" "}
                    {roleList.length ? roleList.join(", ") : "none (donor / beneficiary features are open to everyone)"}
                </p>
            </div>
            <div className="tabs" role="tablist">
                {tabs.map(([key, label]) => (
                    <button
                        type="button"
                        role="tab"
                        aria-selected={key === active[0]}
                        key={key}
                        className={key === active[0] ? "tab active" : "tab"}
                        onClick={() => setTab(key)}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <Panel key={`${active[0]}-${account}`} />
        </>
    );
}
