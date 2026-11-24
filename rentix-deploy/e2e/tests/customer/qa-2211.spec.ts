/**
 * QA re-check 22.11 (part 1, customer app):
 * - #1: a notification banner is shown in the notifications list;
 * - #8: the list refreshes on in-app navigation and when the app becomes
 *   visible again (no full reload needed).
 */
import { customerTest as test, expect, seedCustomerSession } from "../support/fixtures";
import {
  Api,
  createCarApi,
  createOrderAsCustomer,
  pngFile,
  registerCustomerApi,
  uniqueSuffix,
  type Customer,
} from "../support/api";

const sendToCustomer = async (customer: Customer, title: string, withBanner = false) => {
  const api = await Api.staff("manager");
  try {
    const res = withBanner
      ? await api.postMultipart("/user/notifications/", {
          user: String(customer.id),
          title_uz: title,
          message_uz: "E2E xabar",
          banner_uz: pngFile("banner.png"),
        })
      : await api.post("/user/notifications/", { user: customer.id, title_uz: title, message_uz: "E2E xabar" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  } finally {
    await api.dispose();
  }
};

test.describe("QA 22.11: customer notifications", () => {
  test("#1: the banner is shown in the notifications list", async ({ page }) => {
    const customer = await registerCustomerApi();
    await createOrderAsCustomer(customer, (await createCarApi()).id);
    const title = `E2E banner ${uniqueSuffix()}`;
    await sendToCustomer(customer, title, true);

    await seedCustomerSession(page, customer);
    await page.goto("/pages/notes");
    const card = page.locator("li.notes__card").filter({ hasText: title });
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId("note-banner")).toHaveAttribute("src", /notification-banners\/.+\.png$/);
    // a notification without a banner has no image
    await expect(page.locator("li.notes__card").filter({ hasNotText: title }).getByTestId("note-banner")).toHaveCount(0);
  });

  test("#8: the list refreshes on in-app navigation and when the app is visible again", async ({ page }) => {
    const customer = await registerCustomerApi();
    await createOrderAsCustomer(customer, (await createCarApi()).id);
    const first = `E2E birinchi ${uniqueSuffix()}`;
    await sendToCustomer(customer, first);

    await seedCustomerSession(page, customer);
    await page.goto("/pages/notes");
    await expect(page.locator("li.notes__card").filter({ hasText: first })).toHaveCount(1);

    // leave the page inside the app, a new notification arrives, come back
    await page.getByRole("link", { name: "Profil" }).click();
    await expect(page).toHaveURL(/\/pages\/profile/);
    const second = `E2E ikkinchi ${uniqueSuffix()}`;
    await sendToCustomer(customer, second);
    await page.getByRole("link", { name: "Bildirishnomalar" }).click();
    await expect(page).toHaveURL(/\/pages\/notes/);
    // well under the 30 s polling interval: refetched on page visit
    await expect(page.locator("li.notes__card").filter({ hasText: second })).toHaveCount(1, { timeout: 5_000 });

    // the app comes back to the foreground (visibilitychange)
    const third = `E2E uchinchi ${uniqueSuffix()}`;
    await sendToCustomer(customer, third);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.locator("li.notes__card").filter({ hasText: third })).toHaveCount(1, { timeout: 5_000 });
  });
});
