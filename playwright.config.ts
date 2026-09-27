import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a production build (npm run test:e2e builds first).
 * E2E_BASE_URL points at another deployment (e.g. the Vultr URL); otherwise a local `next start` is used.
 * The signed-in suite runs only when E2E_USER / E2E_PASSWORD (an Auth0 test user) are set.
 */
const PORT = Number(process.env.E2E_PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /demo\.spec\.ts/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: `npx next start -p ${PORT}`, url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});
