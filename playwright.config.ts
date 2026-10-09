import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:8081",
    channel: process.env["PLAYWRIGHT_CHANNEL"] || undefined,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
    {
      name: "tablet",
      use: { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 8081 --strictPort",
    url: "http://127.0.0.1:8081",
    reuseExistingServer: !process.env["CI"],
    timeout: 60000,
  },
});
