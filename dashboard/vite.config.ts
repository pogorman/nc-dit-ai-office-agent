import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@shared": path.resolve(__dirname, "../src/shared"),
      },
    },
    server: {
      proxy: {
        "/api": {
          target:
            env.VITE_APIM_BASE_URL ||
            "https://nc-comms-agent-dev-apim.azure-api.net",
          changeOrigin: true,
          // Rewrite /api → /comms for APIM, keep /api for direct Function App
          rewrite: env.VITE_APIM_BASE_URL?.includes("azurewebsites.net")
            ? undefined
            : (p) => p.replace(/^\/api/, "/comms"),
          headers: env.VITE_APIM_BASE_URL?.includes("azurewebsites.net")
            ? { "x-functions-key": env.VITE_APIM_SUBSCRIPTION_KEY || "" }
            : { "Ocp-Apim-Subscription-Key": env.VITE_APIM_SUBSCRIPTION_KEY || "" },
        },
      },
    },
  };
});
