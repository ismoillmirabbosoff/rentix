import { defineConfig, devices } from "@playwright/test";
import { ADMIN_URL, USER_URL } from "./tests/support/env";

/**
 * Rentix E2E.
 *
 *   npx playwright test                       # full local suite (needs ./run-local.sh up)
 *   npx playwright test --project=prod-smoke  # read-only checks, safe for production
 *
 * USER_URL / ADMIN_URL select the target (defaults: local docker stack).
 * Credentials come from env (RENTIX_ADMIN_LOGIN, RENTIX_ADMIN_PASSWORD,
 * RENTIX_MANAGER_LOGIN, RENTIX_MANAGER_PASSWORD) — .env.e2e is loaded by
 * tests/support/env.ts when present.
 */

const mobile = { ...devices["Pixel 7"], browserName: "chromium" as const };

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    // Logs admin + manager in through the real login form once and saves
    // storageState under .auth/ (login throttle is 10/min per IP).
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...mobile, baseURL: ADMIN_URL, locale: "en-US" },
    },
    {
      name: "admin",
      testDir: "./tests/admin",
      dependencies: ["setup"],
      use: { ...mobile, baseURL: ADMIN_URL, locale: "en-US" },
    },
    {
      name: "manager",
      testDir: "./tests/manager",
      dependencies: ["setup"],
      use: { ...mobile, baseURL: ADMIN_URL, locale: "en-US" },
    },
    {
      name: "customer",
      testDir: "./tests/customer",
      dependencies: ["setup"],
      use: { ...mobile, baseURL: USER_URL, locale: "uz-UZ" },
    },
    {
      name: "cross-role",
      testDir: "./tests/cross",
      dependencies: ["setup"],
      use: { ...mobile, baseURL: USER_URL, locale: "uz-UZ" },
    },
    // Read-only production checks: no data is created and the OTP form is
    // never submitted (production sends real SMS).
    {
      name: "prod-smoke",
      testDir: "./tests/prod-smoke",
      use: { ...mobile, baseURL: ADMIN_URL, locale: "en-US" },
    },
  ],
});
