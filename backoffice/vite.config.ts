import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        // Prevent SSE/EventSource connections from being cancelled by proxy timeout
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
  define: {
    // Ensure API URL is available at build time
    "import.meta.env.VITE_API_URL": JSON.stringify(process.env.VITE_API_URL || "/api"),
  },
});
