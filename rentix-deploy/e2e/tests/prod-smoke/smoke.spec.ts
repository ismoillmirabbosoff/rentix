/**
 * Production smoke checks — READ-ONLY.
 *   USER_URL=https://user.rentix.uz ADMIN_URL=https://admin.rentix.uz \
 *   RENTIX_ADMIN_LOGIN=… RENTIX_ADMIN_PASSWORD=… RENTIX_MANAGER_LOGIN=… RENTIX_MANAGER_PASSWORD=… \
 *   npx playwright test --project=prod-smoke
 *
 * Never creates data, never submits forms other than staff login, and never
 * requests an OTP (production sends real SMS).
 */
import { test, expect, type Page } from "@playwright/test";
import { ADMIN_URL, USER_URL, creds } from "../support/env";
import { stubTelegram } from "../support/fixtures";

const COMPANY_ID = process.env.RENTIX_COMPANY_ID || "1";

const staffLogin = async (page: Page, role: "admin" | "manager") => {
  const { login, password } = creds[role]();
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByPlaceholder("Enter the username").fill(login);
  await page.getByPlaceholder("Enter the password").fill(password);
  await page.getByRole("button", { name: "Log In" }).click();
};

/** Fail on any 5xx from the API while the page is used. */
const watchServerErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
};

test.describe("prod smoke (read-only)", () => {
  test("admin app loads the login page", async ({ page }) => {
    const res = await page.goto(`${ADMIN_URL}/`);
    expect(res?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Log In" })).toBeVisible();
  });

  test("customer app loads the search screen", async ({ page, context }) => {
    await stubTelegram(context, null);
    const errors = watchServerErrors(page);
    const res = await page.goto(`${USER_URL}/?company=${COMPANY_ID}`);
    expect(res?.status()).toBeLessThan(400);
    await expect(page.locator(".ant-select").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Natijalarni ko|View results|Показать результаты/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("customer app shows the phone login screen (OTP is NOT requested)", async ({ page, context }) => {
    await stubTelegram(context, null);
    let otpRequested = false;
    await page.route(/\/api\/user\/(phone|code|user-register|token)\/?$/, (route) => {
      otpRequested = true;
      return route.abort();
    });
    await page.goto(`${USER_URL}/pages/profile?company=${COMPANY_ID}&lang=uz`);
    await page.getByRole("button", { name: "Tizimga kiring" }).click();
    await page.getByRole("button", { name: "Telefon raqam orqali kirish" }).click();
    await expect(page.locator("input.PhoneInputInput")).toBeVisible();
    await expect(page.getByRole("button", { name: "Kodni olish" })).toBeVisible();
    expect(otpRequested).toBe(false);
  });

  test("admin can log in and open statistics, managers and settings", async ({ page }) => {
    const errors = watchServerErrors(page);
    await staffLogin(page, "admin");
    await expect(page).toHaveURL(/\/admin\/statistics$/);
    await expect(page.getByText("Buyurtmalar jami")).toBeVisible(); // loads /user/orders/
    await page.getByRole("link", { name: /Managers/ }).click();
    await expect(page).toHaveURL(/\/admin\/managers$/);
    await expect(page.getByRole("heading", { name: "Manajerlar" })).toBeVisible();
    await page.getByRole("link", { name: /Settings/ }).click();
    await expect(page.getByText("Company information")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("manager can log in and open orders and customers", async ({ page }) => {
    const errors = watchServerErrors(page);
    await staffLogin(page, "manager");
    await expect(page).toHaveURL(/\/manager\/dashboard$/);
    await page.getByRole("link", { name: /Orders/ }).click();
    await expect(page).toHaveURL(/\/manager\/orders/);
    await expect(page.locator(".ant-segmented-item").filter({ hasText: "Active" })).toBeVisible();
    await page.getByRole("link", { name: /Customers/ }).click();
    await expect(page).toHaveURL(/\/manager\/customers$/);
    await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
    await expect(page.getByPlaceholder("Search by name or phone number")).toBeVisible();
    expect(errors).toEqual([]);
  });
});
