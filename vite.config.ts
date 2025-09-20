import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const isReplit = process.env.REPL_ID !== undefined;
  
  return {
    plugins: [
      // For Replit environment, we'll disable cloudflare plugin during development
      ...(isReplit && mode === 'development' ? [] : [cloudflare()]),
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
      },
      proxy: {
        // Proxy specific API endpoints to Cloudflare Worker backend
        '/check-open-ai-key': {
          target: 'http://localhost:8787',
          changeOrigin: true,
          secure: false
        },
        // Proxy agent API calls
        '/agents': {
          target: 'http://localhost:8787',
          changeOrigin: true,
          secure: false
        },
        // Proxy any other API routes but NOT static files or root
        '^/api/.*': {
          target: 'http://localhost:8787',
          changeOrigin: true,
          secure: false
        }
      }
    }
  };
});
