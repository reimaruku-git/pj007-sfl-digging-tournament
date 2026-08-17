import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    env: {
      VITE_API_BASE: "http://localhost:3001",
      VITE_COGNITO_USER_POOL_ID: "ap-southeast-1_test",
      VITE_COGNITO_USER_POOL_CLIENT_ID: "testclient",
    },
  },
});
