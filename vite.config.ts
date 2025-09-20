import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(() => {
  const isReplit = process.env.REPL_ID !== undefined;
  
  return {
    plugins: [
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
      hmr: {
        port: 5000
      },
      // Only add allowedHosts in Replit environment
      ...(isReplit ? { allowedHosts: true as const } : {})
    }
  };
});
