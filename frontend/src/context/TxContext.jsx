// Transaction runner with honest status reporting.
//
// Every write goes through runTx(), which shows:
//   "Confirm in your wallet"  -> waiting for the user's signature
//   "Pending"                 -> sent, waiting for a block (with the tx hash)
//   "Confirmed"               -> included in a block AND status = success
//   "Rejected" / "Failed"     -> the user said no, or the contract refused (with the reason)
// Success is never shown before the receipt arrives. After confirmation it waits for
// the backend to index that block, then refreshes every page.

import { createContext, useCallback, useContext, useState } from "react";
import { api } from "../lib/api";
import { describeError } from "../lib/errors";
import { useWeb3 } from "./Web3Context";
import { useAuth } from "./AuthContext";
import { sameAddress, shortAddress } from "../lib/format";

const TxContext = createContext(null);
export const useTx = () => useContext(TxContext);

let nextId = 1;

async function waitForBackend(blockNumber, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const health = await api.health();
            if (health.indexedBlock !== null && health.indexedBlock >= blockNumber) return true;
        } catch {
            // backend down; the page will still refresh from the chain where it can
        }
        await new Promise((r) => setTimeout(r, 400));
    }
    return false;
}

export function TxProvider({ children }) {
    const { signer, account, wrongNetwork, refresh, config } = useWeb3();
    const { user } = useAuth();
    const [toasts, setToasts] = useState([]);

    const update = (id, patch) => setToasts((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

    /**
     * @param {string} label  What the user is doing, e.g. "Donate 100 mUSDC".
     * @param {() => Promise<import("ethers").TransactionResponse>} send
     * @returns {Promise<import("ethers").TransactionReceipt|null>} receipt, or null on failure
     */
    const runTx = useCallback(
        async (label, send) => {
            const id = nextId++;
            const add = (t) => setToasts((list) => [...list.slice(-4), { id, label, chainId: config?.chainId, ...t }]);

            if (!signer) {
                add({ status: "failed", message: "Connect MetaMask first." });
                return null;
            }
            if (user?.wallet && !sameAddress(user.wallet, account)) {
                add({
                    status: "failed",
                    message: `MetaMask is on ${shortAddress(account)}, but your account's wallet is ${shortAddress(user.wallet)}. Switch accounts in MetaMask.`,
                });
                return null;
            }
            if (wrongNetwork) {
                add({ status: "failed", message: "Your wallet is on the wrong network. Switch networks first." });
                return null;
            }

            add({ status: "signing", message: "Confirm the transaction in your wallet." });
            let tx;
            try {
                tx = await send();
            } catch (err) {
                const { kind, message } = describeError(err);
                update(id, { status: kind, message });
                return null;
            }

            update(id, { status: "pending", hash: tx.hash, message: "Waiting for the transaction to be included in a block." });
            try {
                const receipt = await tx.wait();
                if (!receipt || receipt.status !== 1) {
                    update(id, { status: "failed", message: "The transaction was reverted." });
                    return null;
                }
                update(id, {
                    status: "confirmed",
                    block: receipt.blockNumber,
                    message: `Confirmed in block ${receipt.blockNumber}.`,
                });
                await waitForBackend(receipt.blockNumber);
                refresh();
                setTimeout(() => dismiss(id), 8000);
                return receipt;
            } catch (err) {
                const { message } = describeError(err);
                update(id, { status: "failed", message });
                return null;
            }
        },
        [signer, account, user, wrongNetwork, refresh, dismiss, config]
    );

    return <TxContext.Provider value={{ runTx, toasts, dismiss }}>{children}</TxContext.Provider>;
}
