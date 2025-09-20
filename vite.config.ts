import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const isReplit = process.env.REPL_ID !== undefined;
  
  return {
    plugins: [
      // Disable Cloudflare plugin in Replit due to auth issues, use manual wrangler instead
      ...(isReplit ? [] : [cloudflare()]),
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
      // In Replit, proxy to manually started wrangler backend
      ...(isReplit && {
        proxy: {
          '/check-open-ai-key': 'http://localhost:8787',
          '/agents': 'http://localhost:8787'
        }
      })
    }
  };
});
