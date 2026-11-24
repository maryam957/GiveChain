import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server forwards /api to the backend and /rpc to the local blockchain,
// so the browser only ever talks to one origin (no CORS setup needed).
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        strictPort: true,
        proxy: {
            "/api": "http://localhost:4000",
            "/rpc": {
                target: "http://127.0.0.1:8545",
                changeOrigin: true,
                rewrite: () => "/",
            },
        },
    },
});
