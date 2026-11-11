import { test as base, expect } from "@playwright/test";
import { adminTest } from "../support/fixtures";
import { Api } from "../support/api";
import { creds } from "../support/env";

base.describe("admin login / logout (fresh session)", () => {
  base("admin can log out from Settings and is sent back to the login page", async ({ page }) => {
    // Fresh UI login: logging out blacklists the refresh token server-side, so
    // it must not use the shared storageState.
    const { login, password } = creds.admin();
    await page.goto("/login");
    await page.getByPlaceholder("Enter the username").fill(login);
    await page.getByPlaceholder("Enter the password").fill(password);
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page).toHaveURL(/\/admin\/statistics$/);

    await page.getByRole("link", { name: /Settings/ }).click();
    await expect(page).toHaveURL(/\/admin\/settings$/);
    await page.getByRole("button", { name: "logout icon" }).click();
    await expect(page.getByText("Log out?")).toBeVisible();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Session really is gone
    await page.goto("/admin/managers");
    await expect(page).toHaveURL(/\/login$/);
  });

  base("login form validates empty fields", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page.locator(".ant-form-item-explain-error").filter({ hasText: "Enter the username" })).toBeVisible();
    await expect(page.locator(".ant-form-item-explain-error").filter({ hasText: "Enter the password" })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  base("wrong password shows an error and does not log in", async ({ page }) => {
    // BUG: LoginForm passes `onError: () => {}` to usePost, so a 401
    // ("Login yoki parol noto'g'ri") is swallowed and the user gets no feedback at all.
    // rentix-admin/src/features/AuthByUsername/ui/LoginForm/LoginForm.tsx
    await page.goto("/login");
    await page.getByPlaceholder("Enter the username").fill(creds.admin().login);
    await page.getByPlaceholder("Enter the password").fill("definitely-wrong-password");
    const resp = page.waitForResponse((r) => r.url().includes("/user/login/"));
    await page.getByRole("button", { name: "Log In" }).click();
    expect((await resp).status()).toBe(401);
    await expect(page).toHaveURL(/\/login$/);
    base.fail(); // see BUG note above — everything before this line must pass
    await expect(page.getByText(/noto'g'ri|incorrect|invalid|wrong|xato/i)).toBeVisible({ timeout: 5_000 });
  });
});

adminTest.describe("admin dashboard", () => {
  adminTest("statistics page shows live order and car counters", async ({ page }) => {
    const api = await Api.staff("admin");
    const orders = await api.get("/user/orders/");
    const cars = await api.get("/user/cars/");
    await api.dispose();
    const orderList: Array<{ status: string }> = Array.isArray(orders.body)
      ? orders.body
      : orders.body?.orders ?? orders.body?.results ?? orders.body?.data ?? [];
    const carList: Array<{ status: string }> = cars.body?.cars ?? [];

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/statistics$/);
    await expect(page.getByRole("heading", { name: "Statistics" })).toBeVisible();
    const card = (label: string) => page.locator("li").filter({ hasText: label });
    await expect(card("Buyurtmalar jami")).toContainText(String(orderList.length));
    await expect(card("Mashinalar jami")).toContainText(String(carList.length));
    await expect(card("Bo'sh mashinalar")).toContainText(
      String(carList.filter((c) => c.status === "available").length),
    );

    // Tab bar navigation
    await page.getByRole("link", { name: /Managers/ }).click();
    await expect(page).toHaveURL(/\/admin\/managers$/);
    await page.getByRole("link", { name: /Settings/ }).click();
    await expect(page).toHaveURL(/\/admin\/settings$/);
    await expect(page.getByText("Company information")).toBeVisible();
    await expect(page.getByText("App language")).toBeVisible();
    await expect(page.getByText("Cars", { exact: true })).toBeVisible();
  });

  adminTest("app language can be switched from Settings", async ({ page }) => {
    await page.goto("/admin/settings");
    await page.getByText("App language").click();
    await page.getByRole("button", { name: "Русский" }).click();
    await expect(page.getByRole("heading", { name: "Язык приложения" })).toBeVisible();
    await expect(page.getByText("Данные компании")).toBeVisible();
  });
});
