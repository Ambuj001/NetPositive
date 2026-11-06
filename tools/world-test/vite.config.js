import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The page calls /api/* and Vite forwards it to the backend, so no CORS setup is needed.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, proxy: { '/api': { target: process.env.BACKEND_URL ?? "http://127.0.0.1:8081", rewrite: (p) => p.replace(/^\/api/, '') } } },
});
