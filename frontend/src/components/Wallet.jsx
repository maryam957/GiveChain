// Wallet linking and "is the right wallet connected?" checks.

import { useState } from "react";
import { ethers } from "ethers";
import { api } from "../lib/api";
import { sameAddress, shortAddress } from "../lib/format";
import { useWeb3 } from "../context/Web3Context";
import { useAuth } from "../context/AuthContext";

/** Where the user stands with their wallet. */
export function useWalletState() {
    const { hasMetaMask, account, wrongNetwork } = useWeb3();
    const { user } = useAuth();
    if (!user) return "logged-out";
    if (!user.wallet) return "not-linked";
    if (!hasMetaMask) return "no-metamask";
    if (!account) return "not-connected";
    if (!sameAddress(account, user.wallet)) return "wrong-account";
    if (wrongNetwork) return "wrong-network";
    return "ready";
}

/** Connects MetaMask and proves wallet ownership by signing a one-time message. */
export function LinkWalletButton({ label = "Connect and link MetaMask", className = "button" }) {
    const { connect, hasMetaMask } = useWeb3();
    const { setUser } = useAuth();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    const link = async () => {
        setBusy(true);
        setError(null);
        try {
            const address = await connect();
            if (!address) return;
            const { message } = await api.walletChallenge();
            const signer = await new ethers.BrowserProvider(window.ethereum).getSigner(address);
            const signature = await signer.signMessage(message);
            setUser(await api.linkWallet(address, signature));
        } catch (err) {
            setError(err?.code === "ACTION_REJECTED" || err?.code === 4001 ? "You cancelled the signature in MetaMask." : err.message);
        } finally {
            setBusy(false);
        }
    };

    if (!hasMetaMask) return <MetaMaskMissing />;
    return (
        <div className="stack">
            <button type="button" className={className} onClick={link} disabled={busy}>
                {busy ? "Check MetaMask…" : label}
            </button>
            {error && <p className="error-note">{error}</p>}
        </div>
    );
}

export function MetaMaskMissing() {
    return (
        <p className="notice">
            MetaMask is not installed in this browser. Install it from{" "}
            <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                metamask.io
            </a>
            , then reload this page.
        </p>
    );
}

/**
 * Shows its children only when the logged-in user's own wallet is connected on the
 * right network; otherwise explains exactly what to do.
 */
export function WalletGate({ children, action = "do this" }) {
    const state = useWalletState();
    const { connect, account, switchNetwork, config } = useWeb3();
    const { user } = useAuth();
    const [error, setError] = useState(null);

    if (state === "ready") return children;

    const box = (title, body) => (
        <div className="gate">
            <strong>{title}</strong>
            {body}
            {error && <p className="error-note">{error}</p>}
        </div>
    );

    switch (state) {
        case "logged-out":
            return box("Log in first", <p>You need a GiveChain account to {action}.</p>);
        case "not-linked":
            return box(
                "Link your wallet",
                <>
                    <p>Your account has no wallet yet. Every action is signed by your own MetaMask wallet.</p>
                    <LinkWalletButton />
                </>
            );
        case "no-metamask":
            return box("MetaMask needed", <MetaMaskMissing />);
        case "not-connected":
            return box(
                "Connect MetaMask",
                <>
                    <p>
                        To {action}, connect MetaMask with your account's wallet <code>{shortAddress(user.wallet)}</code>.
                    </p>
                    <button type="button" className="button" onClick={() => connect().catch((e) => setError(e.message))}>
                        Connect MetaMask
                    </button>
                </>
            );
        case "wrong-account":
            return box(
                "Wrong MetaMask account",
                <p>
                    MetaMask is using <code>{shortAddress(account)}</code>, but your GiveChain account is linked to{" "}
                    <code>{shortAddress(user.wallet)}</code>. Switch accounts in MetaMask.
                </p>
            );
        case "wrong-network":
            return box(
                "Wrong network",
                <>
                    <p>MetaMask is on a different network. GiveChain runs on chain {config?.chainId}.</p>
                    <button type="button" className="button" onClick={() => switchNetwork().catch((e) => setError(e.message))}>
                        Switch network
                    </button>
                </>
            );
        default:
            return null;
    }
}
