/**
 * QA re-check 18.11 (part A):
 * - N-03: the broadcast customer picker lists customers (incl. regular ones),
 *   "Several" mode sends to each, and the send shows up in the history (Y-01);
 * - Y-02: an overdue rental (in_progress, return time passed) keeps the car
 *   busy: no new booking, shown in "Busy cars" with an "Overdue" tag (Y-03).
 */
import { managerTest as test, expect } from "../support/fixtures";
import {
  Api,
  createCarApi,
  createOrderAsCustomer,
  forceOrderStatusLocal,
  futureRange,
  registerCustomerApi,
  setOrderTimesLocal,
  uniqueSuffix,
} from "../support/api";
import { toast } from "../support/ui";

const customerTitles = async (access: string) => {
  const api = await Api.as(access);
  try {
    const res = await api.get("/user/notifications/");
    const items = Array.isArray(res.body) ? res.body : res.body?.results ?? [];
    return items.map((n: { title: string }) => n.title);
  } finally {
    await api.dispose();
  }
};

test.describe("QA 18.11: broadcast and overdue rental", () => {
  test("N-03/Y-01: send to several customers incl. a regular one, see it in history", async ({ page }) => {
    const regular = await registerCustomerApi();
    const done = await createOrderAsCustomer(regular, (await createCarApi()).id);
    forceOrderStatusLocal(done.id, "completed"); // -> "regular customer"
    const fresh = await registerCustomerApi();
    await createOrderAsCustomer(fresh, (await createCarApi()).id);

    await page.goto("/manager/notifications/create");
    await page.locator(".ant-segmented-item").filter({ hasText: "Several" }).click();
    const picker = page.locator(".ant-form-item").filter({ hasText: "Customers" }).locator(".ant-select");
    // N-03: search by name finds the customer (multi-select stays open between picks)
    for (const c of [regular, fresh]) {
      await picker.locator("input").fill(c.fullName);
      const option = page
        .locator(".ant-select-dropdown:visible .ant-select-item-option")
        .filter({ hasText: c.fullName });
      await expect(option).toHaveCount(1);
      await option.click();
    }
    await page.keyboard.press("Escape");
    await expect(picker).toContainText(regular.fullName);
    await expect(picker).toContainText(fresh.fullName);

    const title = `E2E rassilka ${uniqueSuffix()}`;
    await page.locator(".ant-form-item").filter({ hasText: "Title (UZ)" }).locator("input").fill(title);
    await page.locator(".ant-form-item").filter({ hasText: "Message (UZ)" }).locator("textarea").fill("Salom!");
    const post = page.waitForResponse((r) => r.url().endsWith("/user/notifications/") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Submit" }).click();
    expect((await post).status()).toBe(201);
    await expect(toast(page, "Sent")).toBeVisible();

    expect(await customerTitles(regular.access)).toContain(title);
    expect(await customerTitles(fresh.access)).toContain(title);

    // Y-01: history card — sender, recipients, channel, delivery
    await expect(page).toHaveURL(/\/manager\/notifications$/);
    const card = page.locator('[class*="_paper_"]').filter({ hasText: title });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("2 customers");
    await expect(card).toContainText(regular.fullName);
    await expect(card).toContainText(fresh.fullName);
    await expect(card).toContainText("App");
    await expect(card).toContainText("App: 2/2");
    await expect(card).not.toContainText("Customer:");
  });

  test("Y-02/Y-03: an overdue rental keeps the car busy until it is returned", async ({ page }) => {
    const car = await createCarApi();
    const renter = await registerCustomerApi();
    const rental = await createOrderAsCustomer(renter, car.id);
    forceOrderStatusLocal(rental.id, "in_progress");
    setOrderTimesLocal(rental.id, -26, -2);

    // a new booking for next week is refused while the car is not returned
    const other = await registerCustomerApi();
    const api = await Api.as(other.access);
    const range = futureRange(7);
    const res = await api.post("/user/create-order/", {
      car: car.id, filial: 1, start_time: range.startIso, end_time: range.endIso,
      region: "tashkentCity", payment_system: "cash",
    });
    await api.dispose();
    expect(res.status, JSON.stringify(res.body)).toBe(400);

    await page.goto("/manager/dashboard");
    await page.locator(".ant-segmented-item").filter({ hasText: "Busy cars" }).click();
    await page.getByPlaceholder("Search by car name or plate").fill(car.plate.slice(2));
    const busyCard = page.locator('[class*="_paper_"]').filter({ hasText: `#${rental.id}` });
    await expect(busyCard).toHaveCount(1);
    await expect(busyCard).toContainText("Overdue");

    // Y-03: the orders list marks it too
    await page.goto("/manager/orders?tab=active&sub=in_progress");
    const orderCard = page.locator("article").filter({ hasText: renter.fullName });
    await expect(orderCard).toHaveCount(1);
    await expect(orderCard).toContainText("Overdue");
  });
});
