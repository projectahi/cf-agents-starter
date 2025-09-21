import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(() => ({
  plugins: [cloudflare(), react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true as const,        // <-- allow Replit's dynamic host
    hmr: {
      protocol: "wss",
      clientPort: 443
    },
    proxy: {
      "/api": {
        target: process.env.VITE_WORKER_URL || "http://localhost:8000",
        changeOrigin: true,
        ws: true,
        secure: false
      },
      "/_cf-agents": {
        target: process.env.VITE_WORKER_URL || "http://localhost:8000",
        changeOrigin: true,
        ws: true,
        secure: false
      }
    }
  }
}));
