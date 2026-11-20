/**
 * QA re-check 18.11 (part C), customer app:
 * - T-01/T-02: the reminder link /pages/order/<id>?extend=1 opens the extend
 *   sheet; the customer sees the extra amount, sends the request and can
 *   withdraw it.
 * - N-37: a completed order shows the return summary (mileage, fines, deposit
 *   refund).
 */
import { customerTest as test, expect, seedCustomerSession } from "../support/fixtures";
import {
  Api,
  CAR_DEPOSIT,
  createCarApi,
  createOrderAsCustomer,
  forceOrderStatusLocal,
  getOrderApi,
  pngFile,
  registerCustomerApi,
  setOrderStatusApi,
} from "../support/api";
import { moneyRe } from "../support/customer";

const DAY = 300_000; // createCarApi: cost_day_tash

const activeRental = async () => {
  const customer = await registerCustomerApi();
  const car = await createCarApi();
  const order = await createOrderAsCustomer(customer, car.id);
  await setOrderStatusApi(order.id, "confirmed");
  forceOrderStatusLocal(order.id, "in_progress");
  return { customer, car, order };
};

test.describe("QA 18.11 part C: customer", () => {
  test("T-01: the reminder link opens the extend sheet; the request goes to the manager", async ({ page }) => {
    const { customer, order } = await activeRental();
    await seedCustomerSession(page, customer);

    await page.goto(`/pages/order/${order.id}?extend=1&company=1`);
    const sheet = page.getByTestId("extend-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "Ijarani uzaytirish" })).toBeVisible();
    await expect(page.getByTestId("extend-quote")).toContainText(moneyRe(DAY)); // +1 kun
    await sheet.getByRole("button", { name: "+2 kun" }).click();
    await expect(page.getByTestId("extend-quote")).toContainText(moneyRe(2 * DAY));

    const sent = page.waitForResponse((r) => r.url().includes(`/user/order/${order.id}/extend/`));
    await sheet.getByRole("button", { name: "So'rov yuborish" }).click();
    expect((await sent).status()).toBe(201);
    await expect(sheet).toBeHidden();
    const notice = page.getByTestId("extension-pending");
    await expect(notice).toContainText("Uzaytirish so'rovi menejerga yuborildi");
    await expect(notice).toContainText(moneyRe(2 * DAY));
    await expect(page.getByTestId("extend-open")).toHaveCount(0);

    const pending = (await getOrderApi(order.id)).pending_extension;
    expect(pending).toMatchObject({ status: "pending", requested_by: "customer", extra_amount: 2 * DAY });

    // the customer withdraws the request
    await notice.getByRole("button", { name: "So'rovni bekor qilish" }).click();
    await expect(notice).toHaveCount(0);
    await expect(page.getByTestId("extend-open")).toBeVisible();
    expect((await getOrderApi(order.id)).pending_extension).toBeNull();
  });

  test("N-37: a completed order shows the return summary", async ({ page }) => {
    const { customer, order } = await activeRental();
    const manager = await Api.staff("manager");
    const checks = await manager.get(`/user/checkings/?order=${order.id}`);
    expect(checks.status).toBe(200);
    const res = await manager.postMultipart(`/user/checkings/${checks.body[0].id}/upload-checkout-images/`, {
      images: pngFile("front.png"),
      return_mileage: "20500",
      return_fuel_level: "50",
      return_notes: "Old eshikda tirnalgan",
      fines: JSON.stringify([{ reason: "Yoqilg'i yetishmadi", amount: 100000 }]),
      deposit_refund_amount: String(CAR_DEPOSIT - 100000),
      deposit_refund_method: "card",
    });
    await manager.dispose();
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    await seedCustomerSession(page, customer);
    await page.goto(`/order/${order.id}`);
    const summary = page.getByTestId("return-summary");
    await expect(summary).toContainText("Qaytarish");
    await expect(summary).toContainText("20 500 km");
    await expect(summary).toContainText("Yoqilg'i yetishmadi");
    await expect(summary).toContainText("Qaytarilgan zalog");
    await expect(summary).toContainText(moneyRe(CAR_DEPOSIT - 100000));
    await expect(summary).toContainText("Kartaga");
  });
});
