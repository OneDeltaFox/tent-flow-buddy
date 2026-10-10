import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

export default defineConfig({
  ...config,
  use: { ...config.use, baseURL: "http://127.0.0.1:8082/tent-flow-buddy/" },
  webServer: {
    command: "npm run preview:pages -- --host 127.0.0.1 --port 8082 --strictPort",
    url: "http://127.0.0.1:8082/tent-flow-buddy/",
    reuseExistingServer: false,
  },
});
