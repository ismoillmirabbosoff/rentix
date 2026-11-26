/**
 * QA re-check 26.11 (manager panel):
 * - Y14: on a desktop screen the header and the bottom menu paint a full-width
 *   white background, their content stays in the 768 px column; the phone
 *   layout is unchanged;
 * - Y10: customers report `bot_connected`; the broadcast dry run / send
 *   explains how many customers the bot reaches; the customer profile shows
 *   "Telegram: connected";
 * - Y11: a broadcast to all customers with a banner goes through the same
 *   path as the other modes (every recipient gets a bot result).
 */
import { managerTest as test, expect } from "../support/fixtures";
import {
  Api,
  createCarApi,
  createOrderAsCustomer,
  pngFile,
  registerCustomerApi,
  uniqueSuffix,
} from "../support/api";

test.describe("QA 26.11: manager panel", () => {
  test.describe("Y14: desktop header/footer full width", () => {
    test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

    test("header and bottom menu backgrounds span the screen, content stays in the column", async ({ page }) => {
      await page.goto("/manager/dashboard");
      const viewport = page.viewportSize()!;

      const nav = page.getByTestId("app-bottom-nav");
      await expect(nav).toBeVisible();
      const navBox = (await nav.boundingBox())!;
      expect(navBox.x).toBeLessThan(1);
      expect(navBox.width).toBeGreaterThanOrEqual(viewport.width - 1);
      const navBg = await nav.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(navBg).toBe("rgb(255, 255, 255)");
      const inner = (await page.getByTestId("app-bottom-nav-inner").boundingBox())!;
      expect(inner.width).toBeLessThanOrEqual(768);
      expect(Math.abs(inner.x - (viewport.width - inner.width) / 2)).toBeLessThan(12);

      await page.goto("/manager/customers");
      const header = page.getByTestId("app-header").first();
      await expect(header).toBeVisible();
      // the white background is painted edge to edge (border-image outset)
      const bleed = await header.evaluate((el) => getComputedStyle(el).borderImageSource);
      expect(bleed).toContain("gradient");
      const headerInner = (await page.getByTestId("app-header-inner").first().boundingBox())!;
      expect(headerInner.width).toBeLessThanOrEqual(768);
      expect(Math.abs(headerInner.x + headerInner.width / 2 - viewport.width / 2)).toBeLessThan(12);
      // no horizontal page scroll
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scroll).toBeLessThanOrEqual(viewport.width);
    });
  });

  test("Y14: phone layout is unchanged", async ({ page }) => {
    await page.goto("/manager/dashboard");
    const viewport = page.viewportSize()!;
    const nav = (await page.getByTestId("app-bottom-nav").boundingBox())!;
    expect(Math.round(nav.width)).toBe(viewport.width);
    const inner = (await page.getByTestId("app-bottom-nav-inner").boundingBox())!;
    expect(Math.round(inner.width)).toBe(viewport.width);
    await page.goto("/manager/customers");
    const bleed = await page.getByTestId("app-header").first().evaluate((el) => getComputedStyle(el).borderImageSource);
    expect(bleed).toBe("none");
  });

  test("Y10: bot reach is reported for customers and broadcasts", async ({ page }) => {
    const linked = await registerCustomerApi(); // has a telegram_id
    await createOrderAsCustomer(linked, (await createCarApi()).id);

    const api = await Api.staff("manager");
    const users = (await api.get("/user/all-users/")).body.users as Array<{ id: number; bot_connected: boolean }>;
    expect(users.find((u) => u.id === linked.id)?.bot_connected).toBe(true);
    for (const u of users) expect(typeof u.bot_connected).toBe("boolean");

    const dry = await api.post("/user/notifications/", {
      user: linked.id, title_uz: "T", message_uz: "M", dry_run: 1,
    });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ count: 1, not_linked_count: 0 });
    expect(typeof dry.body.bot_enabled).toBe("boolean");
    expect(dry.body.bot_count).toBe(dry.body.bot_enabled ? 1 : 0);
    await api.dispose();

    await page.goto(`/manager/customers/${linked.id}`);
    await expect(page.getByTestId("customer-telegram-status")).toContainText(/Telegram\s*:?\s*connected/i);
    await expect(page.getByTestId("customer-telegram-status")).not.toContainText(/not connected/i);
  });

  test("Y11: broadcast to all customers with a banner records a bot result per recipient", async () => {
    const customer = await registerCustomerApi();
    await createOrderAsCustomer(customer, (await createCarApi()).id);
    const title = `E2E all ${uniqueSuffix()}`;
    const api = await Api.staff("manager");
    const res = await api.postMultipart("/user/notifications/", {
      target: "all", title_uz: title, message_uz: "Banner bilan", banner_uz: pngFile("banner.png"),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.count).toBeGreaterThan(0);
    expect(res.body.notification.banner_url).toBeTruthy();

    // every recipient ends up with a bot outcome (delivered, or a reason code)
    await expect
      .poll(async () => {
        const list = (await api.get("/user/notifications/broadcasts/")).body as Array<{
          title: string; recipients: Array<{ bot_delivered: boolean; bot_error: string | null }>;
        }>;
        const batch = list.find((b) => b.title === title);
        if (!batch) return "missing";
        return batch.recipients.every((r) => r.bot_delivered || r.bot_error) ? "ok" : "pending";
      })
      .toBe("ok");
    await api.dispose();
  });
});
