import { test as base, type Page } from "@playwright/test";
import { managerTest as test, expect } from "../support/fixtures";
import { Api, createCarApi } from "../support/api";
import { creds } from "../support/env";

const carCards = (page: Page) =>
  page.locator('[class*="_paper_"]').filter({ has: page.getByRole("button", { name: "Complete car setup" }) });

base("manager can log out from the More tab", async ({ page }) => {
  const { login, password } = creds.manager();
  await page.goto("/login");
  await page.getByPlaceholder("Enter the username").fill(login);
  await page.getByPlaceholder("Enter the password").fill(password);
  await page.getByRole("button", { name: "Log In" }).click();
  await expect(page).toHaveURL(/\/manager\/dashboard$/);

  await page.getByRole("link", { name: /More/ }).click();
  await expect(page).toHaveURL(/\/manager\/profile$/);
  await page.getByRole("button", { name: "logout icon" }).click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/manager/orders");
  await expect(page).toHaveURL(/\/login$/);
});

test.describe("manager dashboard", () => {
  test("available / busy tabs and search by plate", async ({ page }) => {
    const free = await createCarApi();
    const busy = await createCarApi({ status: "unavailable" });

    await page.goto("/manager");
    await expect(page).toHaveURL(/\/manager\/dashboard$/);
    const search = page.getByPlaceholder("Search by car name or plate");

    await search.fill(free.plate.slice(2));
    await expect(carCards(page)).toHaveCount(1);
    await expect(carCards(page)).toContainText("Chevrolet");
    await expect(carCards(page)).toContainText("Daily rental");

    await search.fill(busy.plate.slice(2));
    await expect(carCards(page)).toHaveCount(0);
    await page.locator(".ant-segmented-item").filter({ hasText: "Busy cars" }).click();
    await expect(carCards(page)).toHaveCount(1);

    await search.fill(free.plate.slice(2));
    await expect(carCards(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "No busy cars" })).toBeVisible();
  });

  test("tab bar navigation", async ({ page }) => {
    await page.goto("/manager/dashboard");
    await page.getByRole("link", { name: /Orders/ }).click();
    await expect(page).toHaveURL(/\/manager\/orders/);
    await page.getByRole("link", { name: /Customers/ }).click();
    await expect(page).toHaveURL(/\/manager\/customers$/);
    await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
    await page.getByRole("link", { name: /More/ }).click();
    await expect(page).toHaveURL(/\/manager\/profile$/);
    await page.getByRole("link", { name: /Home/ }).click();
    await expect(page).toHaveURL(/\/manager\/dashboard$/);
  });
});

test.describe("manager profile (More)", () => {
  test("shows manager info, car and notification counters; opens cars list", async ({ page }) => {
    const car = await createCarApi();
    const api = await Api.staff("manager");
    const cars = (await api.get("/user/cars/")).body?.cars ?? [];
    await api.dispose();

    await page.goto("/manager/profile");
    await expect(page.getByText("Menejer").first()).toBeVisible();
    await expect(page.getByText("Cars count")).toBeVisible();
    await expect(page.getByText(/^Notifications( count)?$/)).toBeVisible();
    await expect(page.getByText(`${cars.length} pcs`)).toBeVisible();

    await page.getByText("Cars count").click();
    await expect(page).toHaveURL(/\/manager\/cars$/);
    await page.getByPlaceholder("Qidirish...").fill(car.plate.slice(2));
    await expect(page.locator("li").filter({ hasText: car.plate.slice(3, 6) })).toHaveCount(1);
  });

  test("app language can be changed", async ({ page }) => {
    await page.goto("/manager/profile");
    await page.getByText("App language").click();
    await page.getByRole("button", { name: "O'zbekcha" }).click();
    await expect(page.getByText("Ilova tili").first()).toBeVisible();
  });
});
