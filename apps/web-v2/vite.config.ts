import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
