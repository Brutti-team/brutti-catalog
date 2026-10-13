import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const chromiumPath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/e2e.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5190",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: chromiumPath,
      args: ["--no-sandbox"],
    },
  },
  webServer: [
    {
      command: "npm run dev -- --port 5190 --strictPort",
      url: "http://127.0.0.1:5190",
      env: { VITE_DEMO_MODE: "true", VITE_ENQUIRY_EMAIL: "" },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "npm run dev -- --port 5191 --strictPort",
      url: "http://127.0.0.1:5191",
      env: {
        VITE_DEMO_MODE: "false",
        VITE_SUPABASE_URL: "https://catalog-browser-test.supabase.co",
        VITE_SUPABASE_ANON_KEY: "browser-test-public-placeholder",
        VITE_ENQUIRY_EMAIL: "",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
