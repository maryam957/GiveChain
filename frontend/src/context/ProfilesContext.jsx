// Public names for organisation wallets (NGOs, verifiers, admin), so the site can show
// "Demo Relief Foundation" instead of 0x7099…79C8. Donor and beneficiary names are
// private and never returned by the backend.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useWeb3 } from "./Web3Context";

const ProfilesContext = createContext({ byWallet: new Map() });
export const useProfiles = () => useContext(ProfilesContext);

export function ProfilesProvider({ children }) {
    const { refreshKey } = useWeb3();
    const [list, setList] = useState([]);

    useEffect(() => {
        api.profiles().then(setList).catch(() => setList([]));
    }, [refreshKey]);

    const byWallet = useMemo(() => new Map(list.map((p) => [p.wallet.toLowerCase(), p])), [list]);
    return <ProfilesContext.Provider value={{ byWallet }}>{children}</ProfilesContext.Provider>;
}
