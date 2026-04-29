import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /run and /health to the FastAPI backend on :8000 so the
// frontend can use same-origin URLs and we don't need to fight CORS during
// local dev. In production both apps are served from the same origin (or
// CORS is configured via ALLOWED_ORIGINS in the backend).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/run": { target: "http://localhost:8000", changeOrigin: true },
      "/health": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
});
