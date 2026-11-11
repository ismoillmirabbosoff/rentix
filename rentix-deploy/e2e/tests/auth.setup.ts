import fs from "node:fs";
import { test as setup, expect } from "@playwright/test";
import { Api, flushThrottle } from "./support/api";
import { AUTH_DIR, authFile, creds } from "./support/env";

setup.beforeAll(() => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  // Local stack only: reset login/OTP throttle counters left over from previous runs.
  flushThrottle();
});

for (const role of ["admin", "manager"] as const) {
  setup(`log in as ${role} through the login form`, async ({ page }) => {
    const { login, password } = creds[role]();
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByPlaceholder("Enter the username").fill(login);
    await page.getByPlaceholder("Enter the password").fill(password);
    await page.getByRole("button", { name: "Log In" }).click();
    if (role === "admin") {
      await expect(page).toHaveURL(/\/admin\/statistics$/);
      await expect(page.getByRole("heading", { name: "Statistics" })).toBeVisible();
    } else {
      await expect(page).toHaveURL(/\/manager\/dashboard$/);
      await expect(page.getByPlaceholder("Search by car name or plate")).toBeVisible();
    }
    await page.context().storageState({ path: authFile(role) });
  });
}

setup("test data baseline: default filial is open 24/7", async () => {
  // The customer search form validates pick-up/return times against branch
  // working hours (default 09:00-18:00) and defaults the return time to
  // now+10h. Make the default branch 24/7 so date-based tests are time-of-day
  // independent. Branch working hours are exercised separately in admin tests.
  const api = await Api.staff("admin");
  try {
    const res = await api.patch("/user/filials/1/", { is_24_7: true });
    expect(res.status).toBe(200);
  } finally {
    await api.dispose();
  }
});
