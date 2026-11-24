import { useEffect, useState } from "react";
import { useWeb3 } from "../context/Web3Context";

/**
 * Loads data with `loader()` and reloads it whenever a transaction confirms
 * (refreshKey) or a dependency changes.
 */
export function useData(loader, deps = []) {
    const { refreshKey } = useWeb3();
    const [state, setState] = useState({ data: null, error: null, loading: true });

    useEffect(() => {
        let cancelled = false;
        setState((s) => ({ ...s, loading: true }));
        Promise.resolve()
            .then(loader)
            .then((data) => !cancelled && setState({ data, error: null, loading: false }))
            .catch((error) => !cancelled && setState((s) => ({ data: s.data, error, loading: false })));
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshKey, ...deps]);

    return state;
}
