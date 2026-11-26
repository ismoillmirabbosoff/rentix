/**
 * QA re-check 24.11 (customer app):
 * - N0b: an order page opened directly (bot button, no in-app history) — "←"
 *   goes to the orders list instead of doing nothing;
 * - N2: the 404 page follows the app language (RU);
 * - N9: on a desktop screen the app is a centred 480 px column with the
 *   background around it; the fixed bottom menu stays inside the column.
 */
import { customerTest as test, expect, seedCustomerSession } from "../support/fixtures";
import { createCarApi, createOrderAsCustomer, registerCustomerApi } from "../support/api";

test.describe("QA 24.11: customer app", () => {
  test("N0b: '←' on a directly opened order page goes to the orders list", async ({ page }) => {
    const customer = await registerCustomerApi();
    const car = await createCarApi();
    const order = await createOrderAsCustomer(customer, car.id);
    await seedCustomerSession(page, customer);

    // Opened from the bot: a fresh document right on the order page
    await page.goto(`/pages/order/${order.id}`);
    await page.getByRole("button", { name: "Orqaga" }).click();
    await expect(page).toHaveURL(/\/pages\/orders$/);
  });

  test("N0b: '←' still goes back inside the app when there is history", async ({ page }) => {
    const customer = await registerCustomerApi();
    const car = await createCarApi();
    const order = await createOrderAsCustomer(customer, car.id);
    await seedCustomerSession(page, customer);
    await page.goto("/pages/notes");
    // in-app navigation to the order page
    await page.evaluate((id) => {
      window.history.pushState({ usr: null, key: "e2e", idx: 1 }, "", `/pages/order/${id}`);
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    }, order.id);
    await expect(page.getByRole("button", { name: "Orqaga" })).toBeVisible();
    await page.getByRole("button", { name: "Orqaga" }).click();
    await expect(page).toHaveURL(/\/pages\/notes$/);
  });

  test("N2: the 404 page is in the app language", async ({ page }) => {
    await page.goto("/?company=1");
    await page.evaluate(() => localStorage.setItem("rentix_lang", "ru"));
    await page.goto("/pages/no-such-page-e2e");
    await expect(page.getByText("Упс… ошибка!")).toBeVisible();
    await expect(page.getByText("Ups… xatolik!")).toHaveCount(0);
  });

  test.describe("N9: desktop", () => {
    test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

    test("the app is a centred 480 px column", async ({ page }) => {
      await page.goto("/?company=1");
      const root = await page.locator("#root").boundingBox();
      expect(root).not.toBeNull();
      expect(root!.width).toBeLessThanOrEqual(480);
      const viewport = page.viewportSize()!;
      expect(Math.abs(root!.x - (viewport.width - root!.width) / 2)).toBeLessThan(12);

      // background around the column differs from the app background
      const colors = await page.evaluate(() => {
        const html = getComputedStyle(document.documentElement).backgroundImage;
        return html;
      });
      expect(colors).toContain("linear-gradient");

      // fixed bottom menu content stays inside the column (Y14: background is full width)
      const tab = page.getByTestId("app-bottom-nav-inner");
      await expect(tab).toBeVisible();
      const tabBox = await tab.boundingBox();
      expect(tabBox!.width).toBeLessThanOrEqual(480);
      expect(tabBox!.x).toBeGreaterThan(400);
    });
  });
});
