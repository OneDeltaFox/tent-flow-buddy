import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./auth-dev/tests",
  use: { baseURL: "http://127.0.0.1:8084", channel: "msedge" },
  webServer: {
    command: "npx vite --config vite.auth.config.ts --host 127.0.0.1 --port 8084 --strictPort",
    url: "http://127.0.0.1:8084",
    env: {
      VITE_SUPABASE_URL: "https://authtest.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_not_a_real_key",
      VITE_GOOGLE_AUTH_ENABLED: "false",
    },
    reuseExistingServer: false,
  },
});
