import { useEffect, useState } from "react";
import { useWeb3 } from "../context/Web3Context";

/**
 * Loads data with `loader()` and reloads it whenever a transaction confirms
 * (refreshKey) or a dependency changes. With `intervalMs`, it also reloads on a
 * timer, so work created by other people (new applications, new payment requests)
 * appears without a page reload.
 */
export function useData(loader, deps = [], { intervalMs } = {}) {
    const { refreshKey } = useWeb3();
    const [state, setState] = useState({ data: null, error: null, loading: true });
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (!intervalMs) return undefined;
        const timer = setInterval(() => setTick((t) => t + 1), intervalMs);
        return () => clearInterval(timer);
    }, [intervalMs]);

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
    }, [refreshKey, tick, ...deps]);

    return state;
}
