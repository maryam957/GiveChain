import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server forwards /api to the backend and /rpc to the local blockchain,
// so the browser only ever talks to one origin (no CORS setup needed).
// GIVECHAIN_RPC_URL selects the chain: Hardhat (default, port 8545) or Ganache (7545).
const RPC_URL = process.env.GIVECHAIN_RPC_URL || "http://127.0.0.1:8545";
const API_URL = process.env.GIVECHAIN_API_URL || "http://localhost:4000";

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        strictPort: true,
        proxy: {
            "/api": API_URL,
            "/rpc": {
                target: RPC_URL,
                changeOrigin: true,
                rewrite: () => "/",
            },
        },
    },
});
