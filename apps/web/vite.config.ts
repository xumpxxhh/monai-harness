import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const harnessTarget = process.env.HARNESS_API_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/v1": { target: harnessTarget, changeOrigin: true },
      "/healthz": { target: harnessTarget, changeOrigin: true },
    },
  },
});
