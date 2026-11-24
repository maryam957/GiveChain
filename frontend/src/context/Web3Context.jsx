// Wallet connection, contracts and on-chain role detection.
//
// Two ways to connect:
//  - MetaMask (the real way): the user's own wallet signs every transaction.
//  - Demo accounts (local chain 31337 only): uses the local Hardhat node's built-in,
//    unlocked test accounts, so the demo can switch roles quickly. No private keys are
//    stored in the app. This mode is refused on any other network.
//
// Reads go through the local node (proxied at /rpc) and do not need a wallet.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { api } from "../lib/api";
import { registerErrorAbis } from "../lib/errors";

const Web3Context = createContext(null);
export const useWeb3 = () => useContext(Web3Context);

const LOCAL_CHAIN_ID = 31337;
const CONTRACT_NAMES = ["GiveChainAccess", "MockUSDC", "ProjectRegistry", "DonationVault", "MilestoneDisbursement"];

/** Labels for the Hardhat test accounts, matching docs/DEMO.md and scripts/seed.js. */
export const DEMO_ACCOUNT_LABELS = [
    "Admin",
    "NGO 1 (Demo Relief Foundation)",
    "NGO 2 (Demo Learning Trust)",
    "Auditor",
    "Donor A",
    "Donor B",
    "Beneficiary 1",
    "Beneficiary 2",
    "Beneficiary 3",
    "Beneficiary 4",
];

const NO_ROLES = { admin: false, ngo: false, auditor: false, pauser: false };

// Remembers which wallet was connected, so a page reload reconnects quietly.
const STORAGE_KEY = "givechain.wallet";
function saveWallet(value) {
    try {
        if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
        else localStorage.removeItem(STORAGE_KEY);
    } catch {
        // storage unavailable (private mode); reconnecting is just a convenience
    }
}
function loadWallet() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
        return null;
    }
}

export function Web3Provider({ children }) {
    const [config, setConfig] = useState(null);
    const [configError, setConfigError] = useState(null);
    const [readProvider, setReadProvider] = useState(null);

    const [walletMode, setWalletMode] = useState(null); // "metamask" | "demo" | null
    const [account, setAccount] = useState(null);
    const [signer, setSigner] = useState(null);
    const [walletChainId, setWalletChainId] = useState(null);
    const [demoAccounts, setDemoAccounts] = useState([]);

    const [roles, setRoles] = useState(NO_ROLES);
    const [paused, setPaused] = useState(false);
    const [balance, setBalance] = useState(0n);
    const [refreshKey, setRefreshKey] = useState(0);

    const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
    const hasMetaMask = typeof window !== "undefined" && Boolean(window.ethereum);

    // ---- Load contract config from the backend (retries until it is up) ----
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
                const rpc = new ethers.JsonRpcProvider(`${window.location.origin}/rpc`, cfg.chainId, {
                    staticNetwork: true,
                });
                setReadProvider(rpc);
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

    const isLocal = config?.chainId === LOCAL_CHAIN_ID;

    // ---- Demo accounts (local chain only) ----
    useEffect(() => {
        if (!readProvider || !isLocal) return;
        readProvider
            .send("eth_accounts", [])
            .then((list) => setDemoAccounts(list.slice(0, DEMO_ACCOUNT_LABELS.length).map((a) => ethers.getAddress(a))))
            .catch(() => setDemoAccounts([]));
    }, [readProvider, isLocal]);

    // ---- Contracts ----
    const contracts = useMemo(() => {
        if (!config || !readProvider) return null;
        const runner = signer || readProvider;
        const out = {};
        for (const name of CONTRACT_NAMES) {
            const { address, abi } = config.contracts[name];
            out[name] = new ethers.Contract(address, abi, runner);
        }
        return out;
    }, [config, readProvider, signer]);

    const readContracts = useMemo(() => {
        if (!config || !readProvider) return null;
        const out = {};
        for (const name of CONTRACT_NAMES) {
            const { address, abi } = config.contracts[name];
            out[name] = new ethers.Contract(address, abi, readProvider);
        }
        return out;
    }, [config, readProvider]);

    // ---- Connect / disconnect ----
    const switchMetaMaskNetwork = useCallback(async () => {
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

    const adoptMetaMaskAccount = useCallback(async (address) => {
        const browserProvider = new ethers.BrowserProvider(window.ethereum);
        const network = await browserProvider.getNetwork();
        setWalletChainId(Number(network.chainId));
        setSigner(await browserProvider.getSigner(address));
        setAccount(ethers.getAddress(address));
        setWalletMode("metamask");
    }, []);

    const connectMetaMask = useCallback(async () => {
        if (!window.ethereum) throw new Error("MetaMask is not installed in this browser.");
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        if (!accounts.length) return;
        try {
            await switchMetaMaskNetwork();
        } catch {
            // The wrong-network banner lets the user retry.
        }
        await adoptMetaMaskAccount(accounts[0]);
        saveWallet({ mode: "metamask" });
    }, [switchMetaMaskNetwork, adoptMetaMaskAccount]);

    const connectDemo = useCallback(
        async (address) => {
            if (!isLocal || !readProvider) throw new Error("Demo accounts only work on the local chain.");
            setSigner(await readProvider.getSigner(address));
            setAccount(ethers.getAddress(address));
            setWalletChainId(LOCAL_CHAIN_ID);
            setWalletMode("demo");
            saveWallet({ mode: "demo", address });
        },
        [isLocal, readProvider]
    );

    const disconnect = useCallback(() => {
        setWalletMode(null);
        setAccount(null);
        setSigner(null);
        setWalletChainId(null);
        saveWallet(null);
    }, []);

    // Reconnect the remembered wallet after a reload, without any wallet pop-up.
    const [restored, setRestored] = useState(false);
    useEffect(() => {
        if (restored || !config || !readProvider) return;
        const saved = loadWallet();
        if (!saved) return setRestored(true);
        if (saved.mode === "demo") {
            if (!isLocal || !demoAccounts.length) return; // wait until demo accounts are loaded
            if (demoAccounts.includes(saved.address)) connectDemo(saved.address).catch(() => {});
            setRestored(true);
        } else if (saved.mode === "metamask" && window.ethereum) {
            setRestored(true);
            window.ethereum
                .request({ method: "eth_accounts" }) // only returns accounts already allowed; never prompts
                .then((accounts) => accounts.length && adoptMetaMaskAccount(accounts[0]))
                .catch(() => {});
        } else {
            setRestored(true);
        }
    }, [restored, config, readProvider, isLocal, demoAccounts, connectDemo, adoptMetaMaskAccount]);

    // MetaMask account / network changes.
    useEffect(() => {
        if (!window.ethereum || walletMode !== "metamask") return;
        const onAccounts = (accounts) => {
            if (!accounts.length) disconnect();
            else adoptMetaMaskAccount(accounts[0]);
        };
        const onChain = () => {
            const current = window.ethereum.selectedAddress;
            if (current) adoptMetaMaskAccount(current);
        };
        window.ethereum.on?.("accountsChanged", onAccounts);
        window.ethereum.on?.("chainChanged", onChain);
        return () => {
            window.ethereum.removeListener?.("accountsChanged", onAccounts);
            window.ethereum.removeListener?.("chainChanged", onChain);
        };
    }, [walletMode, disconnect, adoptMetaMaskAccount]);

    // ---- On-chain roles, pause state and token balance ----
    useEffect(() => {
        if (!readContracts) return;
        let cancelled = false;
        (async () => {
            const access = readContracts.GiveChainAccess;
            const isPaused = await access.paused();
            if (!cancelled) setPaused(isPaused);
            if (!account) {
                if (!cancelled) {
                    setRoles(NO_ROLES);
                    setBalance(0n);
                }
                return;
            }
            const [admin, ngo, auditor, pauser, bal] = await Promise.all([
                access.hasRole(ethers.ZeroHash, account),
                access.hasRole(ethers.id("NGO_ROLE"), account),
                access.hasRole(ethers.id("AUDITOR_ROLE"), account),
                access.hasRole(ethers.id("PAUSER_ROLE"), account),
                readContracts.MockUSDC.balanceOf(account),
            ]);
            if (!cancelled) {
                setRoles({ admin, ngo, auditor, pauser });
                setBalance(bal);
            }
        })().catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [readContracts, account, refreshKey]);

    const wrongNetwork = Boolean(account && config && walletChainId && walletChainId !== config.chainId);

    const value = {
        config,
        configError,
        readProvider,
        contracts,
        readContracts,
        walletMode,
        account,
        signer,
        hasMetaMask,
        isLocal,
        demoAccounts,
        connectMetaMask,
        connectDemo,
        disconnect,
        switchMetaMaskNetwork,
        wrongNetwork,
        walletChainId,
        roles,
        paused,
        balance,
        refreshKey,
        refresh,
    };
    return <Web3Context.Provider value={value}>{children}</Web3Context.Provider>;
}
