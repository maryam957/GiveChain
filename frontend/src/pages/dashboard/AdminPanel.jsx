import { useState } from "react";
import { ethers } from "ethers";
import { useWeb3 } from "../../context/Web3Context";
import { useTx } from "../../context/TxContext";
import { Section } from "../../components/ui";

const ROLES = {
    NGO: ethers.id("NGO_ROLE"),
    Auditor: ethers.id("AUDITOR_ROLE"),
    Pauser: ethers.id("PAUSER_ROLE"),
};

export default function AdminPanel() {
    const { contracts, readContracts, roles, paused } = useWeb3();
    const { runTx } = useTx();
    const [address, setAddress] = useState("");
    const [role, setRole] = useState("NGO");
    const [current, setCurrent] = useState(null);
    const valid = ethers.isAddress(address);

    const check = async () => {
        const access = readContracts.GiveChainAccess;
        const result = {};
        for (const [name, id] of Object.entries(ROLES)) result[name] = await access.hasRole(id, address);
        result.Admin = await access.hasRole(ethers.ZeroHash, address);
        setCurrent(result);
    };

    return (
        <>
            {roles.pauser && (
                <Section title="Emergency pause">
                    <p>
                        The system is currently <strong>{paused ? "paused" : "running"}</strong>. Pausing blocks every
                        state-changing action in all three contracts (donations, approvals, payouts and refunds). Reading
                        data still works.
                    </p>
                    {paused ? (
                        <button type="button" className="button" onClick={() => runTx("Unpause GiveChain", () => contracts.GiveChainAccess.unpause())}>
                            Unpause
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="button danger"
                            onClick={() => {
                                if (window.confirm("Pause the whole system?")) runTx("Pause GiveChain", () => contracts.GiveChainAccess.pause());
                            }}
                        >
                            Pause everything
                        </button>
                    )}
                </Section>
            )}

            {roles.admin && (
                <Section title="Manage roles">
                    <p className="small muted">
                        The admin can give and remove roles but cannot move money or approve anything. One wallet cannot be
                        both an NGO and an auditor.
                    </p>
                    <div className="form">
                        <div className="grid-2 tight">
                            <label>
                                Wallet address
                                <input
                                    value={address}
                                    onChange={(e) => {
                                        setAddress(e.target.value.trim());
                                        setCurrent(null);
                                    }}
                                    placeholder="0x…"
                                />
                            </label>
                            <label>
                                Role
                                <select value={role} onChange={(e) => setRole(e.target.value)}>
                                    {Object.keys(ROLES).map((r) => (
                                        <option key={r}>{r}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                        {address && !valid && <p className="error-note">Not a valid wallet address.</p>}
                        <div className="row">
                            <button
                                type="button"
                                className="button"
                                disabled={!valid}
                                onClick={() => runTx(`Give ${role} role to ${address.slice(0, 8)}…`, () => contracts.GiveChainAccess.grantRole(ROLES[role], address))}
                            >
                                Grant
                            </button>
                            <button
                                type="button"
                                className="button danger"
                                disabled={!valid}
                                onClick={() => runTx(`Remove ${role} role from ${address.slice(0, 8)}…`, () => contracts.GiveChainAccess.revokeRole(ROLES[role], address))}
                            >
                                Revoke
                            </button>
                            <button type="button" className="button secondary" disabled={!valid} onClick={check}>
                                Check current roles
                            </button>
                        </div>
                        {current && (
                            <p className="small">
                                On-chain:{" "}
                                {Object.entries(current)
                                    .map(([name, has]) => `${name} ${has ? "✓" : "✗"}`)
                                    .join(" · ")}
                            </p>
                        )}
                    </div>
                </Section>
            )}
        </>
    );
}
