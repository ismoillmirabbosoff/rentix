/**
 * QA re-check 26.11 (customer app):
 * - Y14: on a desktop screen the top bars and the bottom menu have a
 *   full-width background, their content stays in the 480 px column; only
 *   page content is narrow; the phone layout (390 px) is unchanged;
 * - Y12: client errors are accepted by /user/client-errors/ without auth.
 */
import { customerTest as test, expect, seedCustomerSession } from "../support/fixtures";
import { Api, registerCustomerApi } from "../support/api";

const centred = (box: { x: number; width: number }, viewport: number) =>
  Math.abs(box.x + box.width / 2 - viewport / 2);

test.describe("QA 26.11: customer app", () => {
  test.describe("Y14: desktop", () => {
    test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

    test("bottom menu and top bar are full width, their content and the page stay at 480", async ({ page }) => {
      const customer = await registerCustomerApi();
      await seedCustomerSession(page, customer);
      await page.goto("/pages/orders");
      const viewport = page.viewportSize()!.width;

      const nav = page.getByTestId("app-bottom-nav");
      await expect(nav).toBeVisible();
      const navBox = (await nav.boundingBox())!;
      expect(navBox.x).toBeLessThan(1);
      expect(navBox.width).toBeGreaterThanOrEqual(viewport - 1);
      expect(await nav.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
      const inner = (await page.getByTestId("app-bottom-nav-inner").boundingBox())!;
      expect(inner.width).toBeLessThanOrEqual(480);
      expect(centred(inner, viewport)).toBeLessThan(12);

      // page top bar (orders tabs) spans the screen
      const bar = page.locator(".app-bar").first();
      await expect(bar).toBeVisible();
      const barBox = (await bar.boundingBox())!;
      expect(barBox.x).toBeLessThan(1);
      expect(barBox.width).toBeGreaterThanOrEqual(viewport - 20); // minus a possible scrollbar

      // the content column itself is still 480 and centred
      const root = (await page.locator("#root").boundingBox())!;
      expect(root.width).toBeLessThanOrEqual(480);
      expect(centred(root, viewport)).toBeLessThan(12);
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scroll).toBeLessThanOrEqual(viewport);
    });
  });

  test("Y14: phone layout is unchanged", async ({ page }) => {
    const customer = await registerCustomerApi();
    await seedCustomerSession(page, customer);
    await page.goto("/pages/orders");
    const viewport = page.viewportSize()!.width;
    const nav = (await page.getByTestId("app-bottom-nav").boundingBox())!;
    expect(Math.round(nav.width)).toBe(viewport);
    const bar = (await page.locator(".app-bar").first().boundingBox())!;
    expect(Math.round(bar.x)).toBe(0);
    expect(Math.round(bar.width)).toBe(viewport);
  });

  test("Y12: client error reports are accepted without auth", async () => {
    const api = await Api.as(null);
    const res = await api.post("/user/client-errors/", {
      message: "E2E: synthetic client error", source: "onerror", url: "/e2e",
    });
    await api.dispose();
    expect(res.status).toBe(204);
  });
});
