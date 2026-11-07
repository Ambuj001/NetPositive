import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const nodeModules = fileURLToPath(new URL("./node_modules", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // src/lib/vaultCrypto.ts imports ../backend/vault-sdk, which imports @noble/*. Bare imports resolve from that
    // file's own location (backend/node_modules), which does not exist on Vercel (only this app is installed).
    // Pin them to this app's copies so the build does not depend on the backend being installed.
    alias: [{ find: /^@noble\/(curves|hashes|ciphers)(\/|$)/, replacement: `${nodeModules}/@noble/$1$2` }],
  },
  server: {
    // Always 5173. If something already holds it, fail loudly instead of quietly moving to 5174
    // (the backend's CORS list and the wallet/World ID setup expect 5173).
    port: 5173,
    strictPort: true,
    proxy: {
      // Frontend calls /api/*. The backend serves those routes at the root.
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
