import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const RAILWAY_API = "https://price-scraper-backend-production-7ba3.up.railway.app/api";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
  define: {
    // Dev: /api (local backend) unless VITE_API_URL set. Prod: Railway
    "import.meta.env.VITE_API_URL": JSON.stringify(
      process.env.VITE_API_URL ?? (mode === "development" ? "/api" : RAILWAY_API),
    ),
  },
}));
