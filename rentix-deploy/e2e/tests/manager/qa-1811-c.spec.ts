/**
 * QA re-check 18.11 (part C), manager panel:
 * - T-01: the manager extends an active rental from the order page (extra
 *   amount shown before confirming); an overlap with the car's next booking is
 *   refused naming that order; a customer's extension request is approved in
 *   the panel.
 * - N-37: the return step takes the same 5 photos as the hand-over plus
 *   mileage, fuel, damage notes, fines and the deposit refund; the summary is
 *   shown on the completed order.
 */
import { type Page } from "@playwright/test";
import { managerTest as test, expect } from "../support/fixtures";
import {
  Api,
  CAR_DEPOSIT,
  createCarApi,
  createOrderAsCustomer,
  forceOrderStatusLocal,
  futureRange,
  getOrderApi,
  isoLocal,
  pngFile,
  registerCustomerApi,
  setOrderStatusApi,
} from "../support/api";
import { toast } from "../support/ui";
import { moneyRe } from "../support/customer";

const DAY = 300_000; // createCarApi: cost_day_tash

/** A rental in progress: starts in 2 days 10:00, returns a day later (car is created per test). */
const activeRental = async () => {
  const customer = await registerCustomerApi();
  const car = await createCarApi();
  const range = futureRange(2);
  const order = await createOrderAsCustomer(customer, car.id, range);
  await setOrderStatusApi(order.id, "confirmed");
  forceOrderStatusLocal(order.id, "in_progress");
  return { customer, car, order, range };
};

const uploadCarPhotos = async (page: Page) => {
  const inputs = page.locator('input[type="file"]');
  await expect(inputs).toHaveCount(4);
  await inputs.nth(0).setInputFiles(pngFile("front.png"));
  await inputs.nth(1).setInputFiles([pngFile("side-left.png"), pngFile("side-right.png")]);
  await inputs.nth(2).setInputFiles(pngFile("back.png"));
  await inputs.nth(3).setInputFiles(pngFile("interior.png"));
};

test.describe("QA 18.11 part C: rental extension (T-01)", () => {
  test("manager extends an active rental by a day and sees the extra amount first", async ({ page }) => {
    const { order, range } = await activeRental();

    await page.goto(`/manager/orders/${order.id}`);
    await page.getByTestId("extend-rental").click();
    const drawer = page.getByTestId("extend-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "+1 day" })).toBeVisible();
    // +1 day is pre-selected: one more day at the agreed daily price
    await expect(page.getByTestId("extend-extra")).toContainText(moneyRe(DAY));
    await expect(page.getByTestId("extend-quote")).toContainText(moneyRe(CAR_DEPOSIT));

    const extend = page.waitForResponse((r) => r.url().includes(`/user/order/${order.id}/extend/`));
    await page.getByTestId("extend-confirm").click();
    expect((await extend).status()).toBe(200);
    await expect(toast(page, "Rental extended")).toBeVisible();

    const saved = await getOrderApi(order.id);
    const newEnd = new Date(range.end);
    newEnd.setDate(newEnd.getDate() + 1);
    expect(new Date(saved.end_time).getTime()).toBe(newEnd.getTime());
    expect(Number(saved.cost)).toBe(2 * DAY + CAR_DEPOSIT); // deposit unchanged
    expect(saved.extensions[0]).toMatchObject({ status: "approved", requested_by: "manager", extra_amount: DAY });
    await expect(page.getByTestId("extension-history")).toContainText(moneyRe(DAY));
  });

  test("an overlap with the car's next booking is refused with the order number", async ({ page }) => {
    const { car, order, range } = await activeRental();
    // the next customer takes the same car a day after the current return time
    const nextStart = new Date(range.end.getTime() + 24 * 3600_000);
    const nextEnd = new Date(range.end.getTime() + 3 * 24 * 3600_000);
    const next = await createOrderAsCustomer(await registerCustomerApi(), car.id, {
      start: nextStart,
      end: nextEnd,
      startIso: isoLocal(nextStart),
      endIso: isoLocal(nextEnd),
    });

    await page.goto(`/manager/orders/${order.id}`);
    await page.getByTestId("extend-rental").click();
    // +1 day ends exactly when the next rental starts — allowed
    await expect(page.getByTestId("extend-extra")).toContainText(moneyRe(DAY));
    // +2 days overlaps it
    await page.getByTestId("extend-drawer").getByRole("button", { name: "+2 days" }).click();
    const error = page.getByTestId("extend-error");
    await expect(error).toContainText(`#${next.id}`);
    await expect(error).toContainText("booked for another order");
    await expect(page.getByTestId("extend-confirm")).toBeDisabled();
    expect(new Date((await getOrderApi(order.id)).end_time).getTime()).toBe(range.end.getTime());
  });

  test("customer's extension request is approved in the panel", async ({ page }) => {
    const { customer, order, range } = await activeRental();
    const newEnd = new Date(range.end);
    newEnd.setDate(newEnd.getDate() + 2);
    const api = await Api.as(customer.access);
    const res = await api.post(`/user/order/${order.id}/extend/`, { end_time: isoLocal(newEnd) });
    await api.dispose();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.extension.status).toBe("pending");
    expect(res.body.quote.extra_amount).toBe(2 * DAY);

    await page.goto(`/manager/orders/${order.id}`);
    const card = page.getByTestId("pending-extension");
    await expect(card).toContainText("The customer wants to extend the rental");
    await expect(card).toContainText(moneyRe(2 * DAY));
    await page.getByTestId("pending-extension-approve").click();
    await expect(toast(page, "Rental extended")).toBeVisible();
    await expect(card).toHaveCount(0);

    const saved = await getOrderApi(order.id);
    expect(new Date(saved.end_time).getTime()).toBe(newEnd.getTime());
    expect(saved.pending_extension).toBeNull();
    expect(saved.extensions[0]).toMatchObject({ status: "approved", requested_by: "customer" });
  });
});

test.describe("QA 18.11 part C: return form (N-37)", () => {
  test("hand-over mileage → return with fines and deposit refund → summary", async ({ page }) => {
    const customer = await registerCustomerApi();
    const car = await createCarApi();
    const order = await createOrderAsCustomer(customer, car.id);
    await setOrderStatusApi(order.id, "confirmed");

    // Hand-over: 5 photos + mileage and fuel
    await page.goto(`/manager/orders/${order.id}/handover`);
    await uploadCarPhotos(page);
    await page.getByLabel("Mileage (km)", { exact: true }).fill("12000");
    // QA 24.11/25.11 #12: mileage shows the thousands separator
    await expect(page.getByLabel("Mileage (km)", { exact: true })).toHaveValue("12 000");
    await page.getByTestId("handover-fuel").getByText("Full").click();
    await page.getByRole("button", { name: "Hand over the car", exact: true }).click();
    await expect(toast(page, "The car has been handed over")).toBeVisible();
    await expect.poll(async () => (await getOrderApi(order.id)).status).toBe("in_progress");

    // Return
    await page.goto(`/manager/orders/${order.id}/return`);
    await expect(page.getByTestId("return-early-notice")).toBeVisible(); // return time is in 3 days
    await expect(page.getByTestId("return-handover-mileage")).toContainText("At hand-over: 12 000 km");
    const submit = page.getByTestId("return-submit");
    await submit.click();
    await expect(page.getByText("Photo upload is required").first()).toBeVisible();
    await expect(page.getByText("Enter the mileage at return.")).toBeVisible();
    await expect(page.getByText("Select the fuel level.")).toBeVisible();

    // only one side photo is not enough
    const inputs = page.locator('input[type="file"]');
    await inputs.nth(1).setInputFiles(pngFile("side-left.png"));
    await submit.click();
    await expect(page.getByText("Upload photos of both sides (2)")).toBeVisible();
    await page.getByTestId("photos-sides").getByRole("button", { name: "×" }).click();
    await uploadCarPhotos(page);

    await page.getByLabel(/^Mileage at return/).fill("11000");
    await submit.click();
    await expect(page.getByText("Mileage cannot be lower than at hand-over (12 000 km).")).toBeVisible();
    await page.getByLabel(/^Mileage at return/).fill("12350");
    await expect(page.getByLabel(/^Mileage at return/)).toHaveValue("12 350");
    await expect(page.getByTestId("return-handover-mileage")).toContainText("Distance driven: 350 km");
    await page.getByTestId("return-fuel").getByText("3/4").click();
    await page.getByLabel("Damage and notes").fill("Scratch on the rear bumper");

    await page.getByRole("button", { name: /Add a fine/ }).click();
    await page.getByLabel("Reason", { exact: true }).fill("Bumper repair");
    await page.getByLabel("Amount", { exact: true }).fill("150000");
    // refund = deposit − fines, editable
    // QA 22.11 #12: thousands separator ("850 000")
    await expect(page.getByLabel(/^Deposit refund/)).toHaveValue(
      (CAR_DEPOSIT - 150000).toLocaleString("en-US").replace(/,/g, " "),
    );
    await submit.click();
    await expect(page.getByText("Select the deposit refund method.")).toBeVisible();
    await page.getByRole("radio", { name: "Cash" }).check();

    const upload = page.waitForResponse((r) => r.url().includes("/upload-checkout-images/"));
    await submit.click();
    expect((await upload).status()).toBe(201);
    await expect(toast(page, "The car has been accepted")).toBeVisible();

    const saved = await getOrderApi(order.id);
    expect(saved.status).toBe("completed");
    expect(saved.return_details).toMatchObject({
      mileage: 12350,
      fuel_level: 75,
      distance: 350,
      fines_total: 150000,
      deposit_amount: CAR_DEPOSIT,
      deposit_refund_amount: CAR_DEPOSIT - 150000,
      deposit_refund_method: "cash",
    });
    expect(saved.handover_details).toMatchObject({ mileage: 12000, fuel_level: 100 });

    await page.goto(`/manager/orders/${order.id}`);
    const summary = page.getByTestId("return-summary");
    await expect(summary).toContainText("Bumper repair");
    await expect(summary).toContainText("350 km");
    await expect(page.getByTestId("return-summary-refund")).toContainText(moneyRe(CAR_DEPOSIT - 150000));
  });
});
