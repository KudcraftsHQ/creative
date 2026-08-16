import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: Number(process.env.PORT) || 5173,
    host: true,
    proxy: {
      // Both prefixes, because the OAuth consent screen is served by the API at
      // the root and a dev login has to reach it through the same origin.
      "/api": { target: `http://localhost:${process.env.API_PORT || 3000}`, changeOrigin: true },
      "/oauth": { target: `http://localhost:${process.env.API_PORT || 3000}`, changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
