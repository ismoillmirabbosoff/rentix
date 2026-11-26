/**
 * QA re-check 22.11 (part 2, manager panel):
 * - #10: a confirmed order whose pickup time passed (not handed over) is tagged
 *   "Not picked up" in the orders list, in busy cars and on the order page;
 * - #12: the deposit refund and fine amounts have a thousands separator;
 * - #16: after the return a final settlement is shown, then the order opens;
 *   the customer's order page shows the same totals;
 * - #13: the hand-over confirmation shows a formatted phone;
 * - #3/#4: a broadcast sent to several customers can be edited and deleted as a
 *   whole (recipients stay read-only).
 */
import { devices, type Page } from "@playwright/test";
import { managerTest as test, expect, customerStorageState, stubTelegram } from "../support/fixtures";
import {
  Api,
  CAR_DEPOSIT,
  createCarApi,
  createOrderAsCustomer,
  displayPhone,
  forceOrderStatusLocal,
  futureRange,
  getOrderApi,
  pngFile,
  registerCustomerApi,
  setOrderStatusApi,
  setOrderTimesLocal,
  uniqueSuffix,
} from "../support/api";
import { tapBehindTabbar, toast } from "../support/ui";
import { USER_URL } from "../support/env";
import { moneyRe } from "../support/customer";

const DAY = 300_000; // createCarApi: cost_day_tash

const uploadCarPhotos = async (page: Page) => {
  const inputs = page.locator('input[type="file"]');
  await expect(inputs).toHaveCount(4);
  await inputs.nth(0).setInputFiles(pngFile("front.png"));
  await inputs.nth(1).setInputFiles([pngFile("side-left.png"), pngFile("side-right.png")]);
  await inputs.nth(2).setInputFiles(pngFile("back.png"));
  await inputs.nth(3).setInputFiles(pngFile("interior.png"));
};

const customerNotifications = async (access: string) => {
  const api = await Api.as(access);
  try {
    const res = await api.get("/user/notifications/");
    return (Array.isArray(res.body) ? res.body : res.body?.results ?? []) as Array<Record<string, any>>;
  } finally {
    await api.dispose();
  }
};

test.describe("QA 22.11 part 2: manager panel", () => {
  test("#10: a confirmed order past its pickup time is tagged 'Not picked up'", async ({ page }) => {
    const car = await createCarApi();
    const renter = await registerCustomerApi();
    const order = await createOrderAsCustomer(renter, car.id);
    await setOrderStatusApi(order.id, "confirmed");
    setOrderTimesLocal(order.id, -2, 20); // pickup 2 h ago, not handed over

    await page.goto("/manager/orders?tab=active&sub=confirmed");
    const orderCard = page.locator("article").filter({ hasText: renter.fullName });
    await expect(orderCard).toHaveCount(1);
    await expect(orderCard).toContainText("Not picked up");
    await expect(orderCard).not.toContainText("Overdue");

    await page.goto("/manager/dashboard");
    await page.locator(".ant-segmented-item").filter({ hasText: "Busy cars" }).click();
    await page.getByPlaceholder("Search by car name or plate").fill(car.plate.slice(2));
    const busyCard = page.locator('[class*="_paper_"]').filter({ hasText: `#${order.id}` });
    await expect(busyCard).toHaveCount(1);
    await expect(busyCard).toContainText("Not picked up");

    await page.goto(`/manager/orders/${order.id}`);
    await expect(page.getByText("Not picked up").first()).toBeVisible();
    // not cancelled automatically
    expect((await getOrderApi(order.id)).status).toBe("confirmed");
  });

  test("#12/#16: deposit with separators, final settlement after the return, customer sees the totals", async ({ page, browser }) => {
    const customer = await registerCustomerApi();
    const REGION = 200_000;
    const car = await createCarApi({ region_costs: JSON.stringify({ tashkentCity: 0, samarkand: REGION }) });
    const order = await createOrderAsCustomer(customer, car.id, futureRange(2), { region: "samarkand" });
    await setOrderStatusApi(order.id, "confirmed");
    forceOrderStatusLocal(order.id, "in_progress");
    const before = await getOrderApi(order.id);
    expect(Number(before.pricing_breakdown.region_cost)).toBe(REGION);

    await page.goto(`/manager/orders/${order.id}/return`);
    await uploadCarPhotos(page);
    await page.getByLabel(/^Mileage at return/).fill("12350");
    await page.getByTestId("return-fuel").getByText("Full").click();
    // #12: thousands separator in the deposit refund and fine amount
    const refund = page.getByLabel(/^Deposit refund/);
    await expect(refund).toHaveValue("1 000 000");
    await page.getByRole("button", { name: /Add a fine/ }).click();
    await page.getByLabel("Reason", { exact: true }).fill("Bumper");
    const fine = page.getByLabel("Amount", { exact: true });
    await fine.fill("150000");
    await fine.blur();
    await expect(fine).toHaveValue("150 000");
    await expect(refund).toHaveValue("850 000");
    await refund.fill("800000");
    await refund.blur();
    await expect(refund).toHaveValue("800 000");
    await page.getByRole("radio", { name: "Cash" }).check();

    const upload = page.waitForResponse((r) => r.url().includes("/upload-checkout-images/"));
    await page.getByTestId("return-submit").click();
    expect((await upload).status()).toBe(201);
    await expect(toast(page, "The car has been accepted")).toBeVisible();

    // #16: final settlement
    const result = page.getByRole("dialog").filter({ hasText: "The car has been accepted" });
    await expect(result).toBeVisible();
    const settlement = result.getByTestId("return-settlement");
    await expect(settlement).toBeVisible();
    await expect(settlement.getByTestId("settlement-rental")).toContainText("300 000");
    await expect(settlement.getByTestId("settlement-service-region")).toBeVisible();
    await expect(settlement.getByTestId("settlement-total")).toContainText(moneyRe(DAY + REGION));
    await expect(settlement.getByTestId("settlement-refund")).toContainText("800 000");
    await expect(settlement).toContainText("Cash");
    await expect(settlement).toContainText("Cashback earned");

    const saved = await getOrderApi(order.id);
    expect(saved.status).toBe("completed");
    expect(saved.return_details.deposit_refund_amount).toBe(800000);
    expect(saved.return_details.settlement).toMatchObject({
      rental: DAY,
      total_paid: DAY + REGION,
      deposit: CAR_DEPOSIT,
      fines_total: 150000,
      deposit_refund_amount: 800000,
      deposit_refund_method: "cash",
    });

    await result.getByTestId("return-result-open-order").click();
    await expect(page).toHaveURL(new RegExp(`/manager/orders/${order.id}$`));
    await expect(page.getByTestId("return-settlement")).toBeVisible();

    // the customer's order page shows the same totals
    const ctx = await browser.newContext({
      ...devices["Pixel 7"],
      baseURL: USER_URL,
      locale: "uz-UZ",
      storageState: customerStorageState(customer),
    });
    await stubTelegram(ctx, null);
    const customerPage = await ctx.newPage();
    await customerPage.goto(`/pages/order/${order.id}`);
    const mine = customerPage.getByTestId("return-settlement");
    await expect(mine).toBeVisible();
    await expect(mine).toContainText("Ijara");
    await expect(mine).toContainText("Viloyatga chiqish");
    await expect(mine).toContainText("Jami to'langan (zalogsiz)");
    await expect(mine).toContainText("Yozilgan keshbek");
    await expect(customerPage.getByTestId("return-summary")).toContainText("800 000");
    await ctx.close();
  });

  test("#13: the hand-over confirmation shows a formatted phone", async ({ page }) => {
    const customer = await registerCustomerApi();
    const first = await createOrderAsCustomer(customer, (await createCarApi()).id);
    forceOrderStatusLocal(first.id, "completed"); // -> regular customer
    const order = await createOrderAsCustomer(customer, (await createCarApi()).id, futureRange(3), {
      renter_full_name: customer.fullName,
      renter_passport_no: "AA1234567",
    });
    await setOrderStatusApi(order.id, "confirmed");

    await page.goto(`/manager/orders/${order.id}`);
    await tapBehindTabbar(page, page.getByRole("button", { name: "Hand over the car", exact: true }));
    await expect(page.getByText("Regular customer details")).toBeVisible();
    await expect(page.getByText(displayPhone(customer.phone), { exact: true }).last()).toBeVisible();
    await expect(page.getByText(customer.phone, { exact: true })).toHaveCount(0);
  });

  test("#3/#4: a broadcast to several customers is edited and deleted as a whole", async ({ page }) => {
    const a = await registerCustomerApi();
    const b = await registerCustomerApi();
    const car = await createCarApi();
    await createOrderAsCustomer(a, car.id);
    await createOrderAsCustomer(b, car.id, futureRange(9));
    const title = `E2E batch ${uniqueSuffix()}`;
    const api = await Api.staff("manager");
    const sent = await api.post("/user/notifications/", {
      users: [a.id, b.id], title_uz: title, message_uz: "Ikki mijozga",
    });
    await api.dispose();
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.count).toBe(2);

    await page.goto("/manager/notifications");
    const card = page.locator('[class*="_paper_"]').filter({ hasText: title });
    await expect(card).toHaveCount(1);
    await expect(card.getByRole("button", { name: /Edit/ })).toBeVisible();
    await expect(card.getByRole("button", { name: /Delete/ })).toBeVisible();

    await tapBehindTabbar(page, card.getByRole("button", { name: /Edit/ }));
    await expect(page).toHaveURL(/\/manager\/notifications\/\d+$/);
    const recipient = page.getByTestId("notification-recipient");
    await expect(recipient).toBeDisabled();
    await expect(recipient).toHaveValue(/2 customers/);
    await expect(page.getByText("Changes apply to all 2 customers.", { exact: false })).toBeVisible();
    const titleInput = page.locator(".ant-form-item").filter({ hasText: "Title (UZ)" }).locator("input");
    await titleInput.fill(`${title} tahrir`);
    const patch = page.waitForResponse(
      (r) => r.url().includes(`/user/notifications/broadcasts/${sent.body.batch}/`) && r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Save" }).click();
    expect((await patch).status()).toBe(200);
    await expect(page.getByText("Notification updated.")).toBeVisible();
    for (const c of [a, b]) {
      const titles = (await customerNotifications(c.access)).map((n) => n.title);
      expect(titles).toContain(`${title} tahrir`);
    }

    await page.goto("/manager/notifications");
    const edited = page.locator('[class*="_paper_"]').filter({ hasText: `${title} tahrir` });
    await tapBehindTabbar(page, edited.getByRole("button", { name: /Delete/ }));
    await expect(page.getByText("This broadcast will be deleted for all 2 customers")).toBeVisible();
    const del = page.waitForResponse(
      (r) => r.url().includes(`/user/notifications/broadcasts/${sent.body.batch}/`) && r.request().method() === "DELETE",
    );
    await page.getByRole("button", { name: "Yes, delete" }).click();
    expect((await del).status()).toBe(204);
    for (const c of [a, b]) {
      const titles = (await customerNotifications(c.access)).map((n) => n.title);
      expect(titles).not.toContain(`${title} tahrir`);
    }
  });
});
