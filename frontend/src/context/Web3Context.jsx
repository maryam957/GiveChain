// MetaMask connection, contracts and on-chain reads.
//
// Every transaction is signed by the user's own MetaMask wallet. The website never
// holds private keys. Reads (balances, roles, campaign data) go through the local
// node (proxied at /rpc) and do not need a wallet.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { api } from "../lib/api";
import { registerErrorAbis } from "../lib/errors";

const Web3Context = createContext(null);
export const useWeb3 = () => useContext(Web3Context);

const LOCAL_CHAIN_ID = 31337;
const CONTRACT_NAMES = ["GiveChainAccess", "MockUSDC", "ProjectRegistry", "DonationVault", "MilestoneDisbursement"];
const STORAGE_KEY = "givechain.metamask";

function remember(on) {
    try {
        if (on) localStorage.setItem(STORAGE_KEY, "1");
        else localStorage.removeItem(STORAGE_KEY);
    } catch {
        // storage unavailable; reconnecting after reload is just a convenience
    }
}
function remembered() {
    try {
        return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

export function Web3Provider({ children }) {
    const [config, setConfig] = useState(null);
    const [configError, setConfigError] = useState(null);
    const [readProvider, setReadProvider] = useState(null);

    const [account, setAccount] = useState(null);
    const [signer, setSigner] = useState(null);
    const [walletChainId, setWalletChainId] = useState(null);

    const [paused, setPaused] = useState(false);
    const [balance, setBalance] = useState(0n);
    const [ethBalance, setEthBalance] = useState(0n);
    const [refreshKey, setRefreshKey] = useState(0);

    const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

    // MetaMask is usually injected before the page loads, but some browsers inject it
    // later and announce it with the "ethereum#initialized" event; also check a few
    // times after start-up.
    const [hasMetaMask, setHasMetaMask] = useState(() => typeof window !== "undefined" && Boolean(window.ethereum));
    useEffect(() => {
        if (hasMetaMask) return;
        const check = () => window.ethereum && setHasMetaMask(true);
        window.addEventListener("ethereum#initialized", check, { once: true });
        const timer = setInterval(check, 1000);
        const stop = setTimeout(() => clearInterval(timer), 10000);
        return () => {
            window.removeEventListener("ethereum#initialized", check);
            clearInterval(timer);
            clearTimeout(stop);
        };
    }, [hasMetaMask]);

    // ---- Contract config from the backend (retries until it is up) ----
    useEffect(() => {
        let cancelled = false;
        let timer;
        async function load() {
            try {
                const cfg = await api.config();
                if (cancelled) return;
                registerErrorAbis(Object.values(cfg.contracts).map((c) => c.abi));
                setConfig(cfg);
                setConfigError(null);
                setReadProvider(
                    new ethers.JsonRpcProvider(`${window.location.origin}/rpc`, cfg.chainId, { staticNetwork: true })
                );
            } catch (err) {
                if (cancelled) return;
                setConfigError(err.message);
                timer = setTimeout(load, 3000);
            }
        }
        load();
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, []);

    const makeContracts = useCallback(
        (runner) => {
            if (!config || !runner) return null;
            const out = {};
            for (const name of CONTRACT_NAMES) {
                const { address, abi } = config.contracts[name];
                out[name] = new ethers.Contract(address, abi, runner);
            }
            return out;
        },
        [config]
    );
    const contracts = useMemo(() => makeContracts(signer || readProvider), [makeContracts, signer, readProvider]);
    const readContracts = useMemo(() => makeContracts(readProvider), [makeContracts, readProvider]);

    // ---- MetaMask ----
    const adoptAccount = useCallback(async (address) => {
        const browserProvider = new ethers.BrowserProvider(window.ethereum);
        const network = await browserProvider.getNetwork();
        setWalletChainId(Number(network.chainId));
        setSigner(await browserProvider.getSigner(address));
        setAccount(ethers.getAddress(address));
    }, []);

    const switchNetwork = useCallback(async () => {
        if (!window.ethereum || !config) return;
        const chainIdHex = ethers.toQuantity(config.chainId);
        try {
            await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
        } catch (err) {
            if (err?.code === 4902 && config.chainId === LOCAL_CHAIN_ID) {
                await window.ethereum.request({
                    method: "wallet_addEthereumChain",
                    params: [
                        {
                            chainId: chainIdHex,
                            chainName: "GiveChain Local",
                            rpcUrls: ["http://127.0.0.1:8545"],
                            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                        },
                    ],
                });
            } else {
                throw err;
            }
        }
    }, [config]);

    const connect = useCallback(async () => {
        if (!window.ethereum) throw new Error("MetaMask is not installed in this browser.");
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        if (!accounts.length) return null;
        try {
            await switchNetwork();
        } catch {
            // the wrong-network banner lets the user retry
        }
        await adoptAccount(accounts[0]);
        remember(true);
        return ethers.getAddress(accounts[0]);
    }, [switchNetwork, adoptAccount]);

    const disconnect = useCallback(() => {
        setAccount(null);
        setSigner(null);
        setWalletChainId(null);
        remember(false);
    }, []);

    // Reconnect after a reload, without a pop-up (eth_accounts never prompts).
    useEffect(() => {
        if (!hasMetaMask || !remembered()) return;
        window.ethereum
            .request({ method: "eth_accounts" })
            .then((accounts) => accounts.length && adoptAccount(accounts[0]))
            .catch(() => {});
    }, [hasMetaMask, adoptAccount]);

    // Follow account and network changes made in MetaMask.
    useEffect(() => {
        if (!hasMetaMask) return;
        const onAccounts = (accounts) => (accounts.length ? adoptAccount(accounts[0]) : disconnect());
        const onChain = () => {
            window.ethereum
                .request({ method: "eth_accounts" })
                .then((accounts) => accounts.length && adoptAccount(accounts[0]))
                .catch(() => {});
        };
        window.ethereum.on?.("accountsChanged", onAccounts);
        window.ethereum.on?.("chainChanged", onChain);
        return () => {
            window.ethereum.removeListener?.("accountsChanged", onAccounts);
            window.ethereum.removeListener?.("chainChanged", onChain);
        };
    }, [hasMetaMask, adoptAccount, disconnect]);

    // ---- Pause state and balances of the connected wallet ----
    useEffect(() => {
        if (!readContracts || !readProvider) return;
        let cancelled = false;
        (async () => {
            const isPaused = await readContracts.GiveChainAccess.paused();
            if (cancelled) return;
            setPaused(isPaused);
            if (!account) {
                setBalance(0n);
                setEthBalance(0n);
                return;
            }
            const [bal, eth] = await Promise.all([
                readContracts.MockUSDC.balanceOf(account),
                readProvider.getBalance(account),
            ]);
            if (!cancelled) {
                setBalance(bal);
                setEthBalance(eth);
            }
        })().catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [readContracts, readProvider, account, refreshKey]);

    const wrongNetwork = Boolean(account && config && walletChainId && walletChainId !== config.chainId);

    const value = {
        config,
        configError,
        readProvider,
        contracts,
        readContracts,
        account,
        signer,
        hasMetaMask,
        connect,
        disconnect,
        switchNetwork,
        wrongNetwork,
        walletChainId,
        paused,
        balance,
        ethBalance,
        refreshKey,
        refresh,
    };
    return <Web3Context.Provider value={value}>{children}</Web3Context.Provider>;
}
