import { request, type Page } from "@playwright/test";
import { adminTest as test, expect } from "../support/fixtures";
import { Api, flushThrottle, rand, uniqueSuffix } from "../support/api";
import { API_URL } from "../support/env";

const managerCard = (page: Page, login: string) =>
  page.locator('[class*="_paper_"]').filter({ hasText: login }).filter({ has: page.getByRole("button", { name: /Edit/ }) });

/**
 * NOTE (layout bug): the list has too little bottom padding, so at maximum
 * scroll the last card's buttons stay ~2/3 covered by the fixed bottom tab bar.
 * Tap the visible top edge of the button, like a user would have to.
 */
const tapCardButton = async (page: Page, login: string, name: RegExp) => {
  const btn = managerCard(page, login).getByRole("button", { name });
  await btn.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await btn.click({ position: { x: 30, y: 4 } });
};

const tryLogin = async (login: string, password: string) => {
  flushThrottle();
  const ctx = await request.newContext();
  const res = await ctx.post(`${API_URL}/user/login/`, { data: { login, password } });
  const status = res.status();
  await ctx.dispose();
  return status;
};

const createManagerViaUI = async (page: Page, opts: { login: string; password: string; fullName: string }) => {
  await page.goto("/admin/managers");
  await expect(page.getByRole("heading", { name: "Managers" })).toBeVisible();
  await page.getByRole("button", { name: "Add manager" }).click();
  await expect(page).toHaveURL(/\/admin\/managers\/create$/);
  await page.getByPlaceholder("Enter full name").fill(opts.fullName);
  await page.locator(".ant-select").filter({ hasText: "Select a branch" }).click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "Default filial" }).click();
  await page.getByPlaceholder("+998 (__) ___ __ __").first().fill(`+99891${rand(7)}`);
  await page.getByPlaceholder("Enter login").fill(opts.login);
  await page.getByPlaceholder("Enter password").fill(opts.password);
  await page.getByPlaceholder("E.g.: 09:00-18:00 or 24/7").fill("09:00-18:00");
  const post = page.waitForResponse((r) => r.url().includes("/user/create-manager/"));
  await page.getByRole("button", { name: "Submit" }).click();
  expect((await post).status()).toBeLessThan(300);
  // on success the app navigates straight back to the list
  await expect(page).toHaveURL(/\/admin\/managers$/);
  await expect(managerCard(page, opts.login)).toHaveCount(1);
};

test.describe("admin managers", () => {
  test("create a manager; the new manager can log in", async ({ page }) => {
    const login = `e2e_mgr_${uniqueSuffix()}`;
    const password = `Pw-${rand(8)}`;
    await createManagerViaUI(page, { login, password, fullName: "E2E Menejer" });
    await page.goto("/admin/managers");
    const card = managerCard(page, login);
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("E2E Menejer");
    await expect(card).toContainText("Active");
    expect(await tryLogin(login, password)).toBe(200);
  });

  test("create form validation", async ({ page }) => {
    await page.goto("/admin/managers/create");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.locator(".ant-form-item-explain-error, [class*=error]").filter({ hasText: "Enter full name" }).first()).toBeVisible();
    await expect(page.locator(".ant-form-item-explain-error, [class*=error]").filter({ hasText: "Enter login" }).first()).toBeVisible();
    await expect(page.locator(".ant-form-item-explain-error, [class*=error]").filter({ hasText: "Select a branch" }).first()).toBeVisible();
    await expect(page.getByText("Enter working hours")).toBeVisible();
    await page.getByPlaceholder("+998 (__) ___ __ __").first().fill("12345");
    await page.getByPlaceholder("+998 (__) ___ __ __").first().blur();
    await expect(page.getByText("Invalid phone number")).toBeVisible();
    // N-20: password policy — at least 8 characters with a letter and a digit
    await page.getByPlaceholder("Enter password").fill("abcdefgh");
    await page.getByPlaceholder("Enter password").blur();
    await expect(page.getByText("Password must be at least 8 characters and contain letters and digits")).toBeVisible();
    // R-27: working hours are validated
    await page.getByPlaceholder("E.g.: 09:00-18:00 or 24/7").fill("ertalab");
    await page.getByPlaceholder("E.g.: 09:00-18:00 or 24/7").blur();
    await expect(page.getByText("Working hours format: 09:00-18:00 or 24/7")).toBeVisible();
  });

  test("edit a manager's name", async ({ page }) => {
    const login = `e2e_mgr_${uniqueSuffix()}`;
    await createManagerViaUI(page, { login, password: `Pw-${rand(8)}`, fullName: "Eski Ism" });
    await page.goto("/admin/managers");
    await tapCardButton(page, login, /Edit/);
    await expect(page).toHaveURL(/\/admin\/managers\/\d+$/);
    const name = page.getByPlaceholder("Enter full name");
    await expect(name).toHaveValue("Eski Ism");
    await name.fill("Yangi Ism");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Manager details updated.")).toBeVisible();
    await page.locator("button.ant-btn").filter({ hasText: /^Close$/ }).click();
    await expect(page).toHaveURL(/\/admin\/managers$/);
    await expect(managerCard(page, login)).toContainText("Yangi Ism");
  });

  test("deactivate a manager with the status switch; deactivated manager cannot log in", async ({ page }) => {
    const login = `e2e_mgr_${uniqueSuffix()}`;
    const password = `Pw-${rand(8)}`;
    await createManagerViaUI(page, { login, password, fullName: "Faolsizlanadigan" });
    await page.goto("/admin/managers");
    const card = managerCard(page, login);
    const patch = page.waitForResponse((r) => r.url().includes("/user/manager-crud/") && r.request().method() === "PATCH");
    await card.getByRole("switch").click();
    expect((await patch).status()).toBeLessThan(300);
    await expect(card).toContainText("Inactive");
    await expect(card.getByRole("switch")).not.toBeChecked();

    const api = await Api.staff("admin");
    const list = await api.get("/user/managers/");
    await api.dispose();
    const row = (list.body?.Managers ?? []).find((m: { login: string }) => m.login === login);
    expect(row?.status).toBe("deactive");

    expect(await tryLogin(login, password), "deactivated manager must not be able to log in").not.toBe(200);
  });

  test("delete a manager", async ({ page }) => {
    const login = `e2e_mgr_${uniqueSuffix()}`;
    await createManagerViaUI(page, { login, password: `Pw-${rand(8)}`, fullName: "O'chiriladigan" });
    await page.goto("/admin/managers");
    await tapCardButton(page, login, /Delete/);
    await expect(page.getByRole("heading", { name: "Delete manager" })).toBeVisible();
    await page.getByRole("button", { name: "Yes, delete" }).click();
    await expect(page.getByRole("heading", { name: "Deleted successfully." })).toBeVisible();
    await page.locator("button.ant-btn").filter({ hasText: /^Close$/ }).click();
    await expect(managerCard(page, login)).toHaveCount(0);
  });
});
