// Logged-in user (email + password account) and helpers for roles.
//
// The account decides which portal a person sees. Permissions that involve money
// are still checked on-chain: `chainRoles` comes from the blockchain index, and every
// transaction is signed by the user's own linked wallet in MetaMask.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useWeb3 } from "./Web3Context";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export const ACCOUNT_LABELS = {
    admin: "Admin",
    ngo: "NGO",
    verifier: "Verifier",
    donor: "Donor",
    beneficiary: "Beneficiary",
};

export function AuthProvider({ children }) {
    const { refreshKey } = useWeb3();
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const refreshUser = useCallback(async () => {
        try {
            setUser(await api.me());
        } catch {
            setUser(null);
        } finally {
            setLoading(false);
        }
    }, []);

    // Reload after every confirmed transaction, so on-chain role changes show up.
    useEffect(() => {
        refreshUser();
    }, [refreshUser, refreshKey]);

    const login = async (email, password) => {
        const u = await api.login(email, password);
        setUser(u);
        return u;
    };
    const signup = async (data) => {
        const u = await api.signup(data);
        setUser(u);
        return u;
    };
    const logout = async () => {
        await api.logout().catch(() => {});
        setUser(null);
    };

    // Whether this account may use its role's tools right now.
    const type = user?.accountType;
    const approved =
        type === "admin"
            ? Boolean(user?.chainRoles?.admin)
            : type === "ngo"
              ? Boolean(user?.chainRoles?.ngo)
              : type === "verifier"
                ? Boolean(user?.chainRoles?.verifier)
                : Boolean(user);

    return (
        <AuthContext.Provider value={{ user, loading, login, signup, logout, refreshUser, setUser, approved }}>
            {children}
        </AuthContext.Provider>
    );
}
