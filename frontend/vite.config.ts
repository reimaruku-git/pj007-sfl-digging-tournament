import { defineConfig } from "vitest/config";
import { loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function apiProxy(apiBase: string): Record<string, ProxyOptions> | undefined {
  const match = apiBase.match(/^(https?:\/\/[^/]+)(\/.*)?$/);
  if (!match) return undefined;
  const origin = match[1];
  const prefix = (match[2] || "").replace(/\/$/, "");
  return {
    "/__api": {
      target: origin,
      changeOrigin: true,
      rewrite: (path) => `${prefix}${path.replace(/^\/__api/, "")}`,
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const proxy = apiProxy(env.VITE_API_BASE);
  return {
    plugins: [react(), tailwindcss()],
    server: { proxy },
    preview: { proxy },
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      env: {
        VITE_API_BASE: "http://localhost:3001",
        VITE_COGNITO_USER_POOL_ID: "ap-southeast-1_test",
        VITE_COGNITO_USER_POOL_CLIENT_ID: "testclient",
      },
    },
  };
});
