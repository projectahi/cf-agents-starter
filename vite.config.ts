import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      // Enable cloudflare plugin in all modes for proper Workers runtime
      cloudflare(),
      react(),
      tailwindcss()
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src")
      }
    },
    server: {
      host: "0.0.0.0",
      port: 5000,
      allowedHosts: true, // Allow all hosts for Replit development
      hmr: {
        port: 5000
      }
    }
  };
});
