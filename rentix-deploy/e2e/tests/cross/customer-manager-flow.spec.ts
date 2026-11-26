import { devices } from "@playwright/test";
import { customerTest as test, expect, fillCustomerPhone } from "../support/fixtures";
import { CAR_DEPOSIT, createCarApi, freshAuthState, uniquePhone, uniqueSuffix } from "../support/api";
import { ADMIN_URL } from "../support/env";
import { expectedDays, moneyRe, searchCars, uniquePrice } from "../support/customer";

test("customer registers and books → manager sees customer + order → confirms → customer sees status", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const price = uniquePrice();
  await createCarApi({ cost_day_tash: String(price) });
  const phone = uniquePhone();
  const name = `Kross Mijoz ${uniqueSuffix()}`;

  /* ── customer (guest) searches and books; login happens at checkout ── */
  const days = expectedDays(4, 2);
  await searchCars(page, 4, 2);
  await page.locator("article").filter({ hasText: moneyRe(price) }).click();
  await page.getByRole("button", { name: "Buyurtmani rasmiylashtirish" }).click();
  await page.getByRole("button", { name: "Naqd" }).click();
  // R-22: driver documents are required before the order is sent
  await page.getByPlaceholder("Familiya Ism Sharif").fill(name);
  await page.getByPlaceholder("AA 1234567").fill("AB 7654321");
  await page.getByRole("button", { name: "To'lash" }).click();

  // not logged in → phone login drawer
  await expect(page.getByText("Telefon raqamingizni kiriting")).toBeVisible();
  await fillCustomerPhone(page, phone);
  await page.getByRole("button", { name: "Kodni olish" }).click();
  await page.getByPlaceholder("Ism va familiyangizni kiriting").fill(name);
  const create = page.waitForResponse((r) => r.url().includes("/user/create-order/"));
  await page.getByRole("button", { name: "Ro'yxatdan o'tish" }).click();
  const createResp = await create;
  expect(createResp.status(), await createResp.text()).toBeLessThan(300);
  const orderId: number = (await createResp.json()).data.id;
  await expect(page).toHaveURL(new RegExp(`/order/${orderId}$`));
  await expect(page.getByText("Kutilmoqda").first()).toBeVisible();
  // N-01: payable total includes the deposit
  const payable = price * days + CAR_DEPOSIT;
  await expect(page.getByText(moneyRe(payable)).first()).toBeVisible();

  /* ── manager ── */
  const managerCtx = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL: ADMIN_URL,
    locale: "en-US",
    storageState: await freshAuthState("manager"),
  });
  const m = await managerCtx.newPage();
  try {
    await m.goto("/manager/customers");
    const customerCard = m.locator("article").filter({ hasText: name });
    await expect(customerCard).toHaveCount(1);
    // ("Orders" on the card counts only completed orders — 0 for a pending one)

    await m.goto("/manager/orders");
    const orderCard = m.locator("article").filter({ hasText: name });
    await expect(orderCard).toHaveCount(1);
    await expect(orderCard).toContainText(String(orderId));
    await orderCard.getByRole("button", { name: /Details/ }).click();
    // R-05: manager sees the same total as the customer
    await expect(m.getByText("Total payable:").locator("xpath=..")).toContainText(moneyRe(payable));
    await m.getByRole("button", { name: /Accept/ }).click();
    await m.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(m.locator(".ant-message-notice").filter({ hasText: "Order confirmed" })).toBeVisible();
  } finally {
    await managerCtx.close();
  }

  /* ── customer sees the new status ── */
  await page.reload();
  await expect(page.getByText("Tasdiqlangan").first()).toBeVisible();
  await page.goto("/pages/orders");
  await expect(page.locator("article").filter({ hasText: "Tasdiqlangan" }).first()).toBeVisible();
});
