/**
 * QA re-check 18.11 (part B, customer side):
 * - Y-08: the order page shows the localized region ("Toshkent (shahar ichida)"),
 *   not the raw key "Tashkentcity";
 * - R-42 (customer): cancelling asks for a reason; a custom reason is stored
 *   with cancelled_by = "customer".
 */
import { customerTest as test, expect, seedCustomerSession } from "../support/fixtures";
import { createCarApi, createOrderAsCustomer, getOrderApi, registerCustomerApi } from "../support/api";

test.describe("QA 18.11 part B: customer", () => {
  test("Y-08: order page shows the localized region, not the raw key", async ({ page }) => {
    const customer = await registerCustomerApi();
    const car = await createCarApi();
    const order = await createOrderAsCustomer(customer, car.id); // region: "tashkentCity"
    await seedCustomerSession(page, customer);

    await page.goto(`/order/${order.id}`);
    await expect(page.getByText("Viloyat:")).toBeVisible();
    await expect(page.getByText("Toshkent (shahar ichida)")).toBeVisible();
    await expect(page.getByText(/Tashkentcity|tashkentCity/)).toHaveCount(0);
  });

  test("R-42: customer writes an own cancel reason", async ({ page }) => {
    const customer = await registerCustomerApi();
    const car = await createCarApi();
    const order = await createOrderAsCustomer(customer, car.id);
    await seedCustomerSession(page, customer);

    await page.goto(`/order/${order.id}`);
    await page.getByRole("button", { name: "Bekor qilish" }).click();
    const sheet = page.getByTestId("cancel-order-sheet");
    const confirm = sheet.getByRole("button", { name: "Ha, bekor qilish" });
    await expect(confirm).toBeDisabled();

    // "Boshqa sabab" clears the text; an empty reason shows the error
    await sheet.getByRole("button", { name: "Boshqa sabab" }).click();
    const textarea = sheet.getByRole("textbox", { name: "Bekor qilish sababi" });
    await textarea.focus();
    await textarea.blur();
    await expect(sheet.getByText("Sababni tanlang yoki yozing")).toBeVisible();
    await expect(confirm).toBeDisabled();

    const reason = "Reys kechiktirildi, keyinroq buyurtma beraman";
    await textarea.fill(reason);
    const cancel = page.waitForResponse((r) => r.url().includes(`/user/order/${order.id}/set-status/`));
    await confirm.click();
    expect((await cancel).status()).toBeLessThan(300);
    await expect(page.getByText("Bekor qilingan").first()).toBeVisible();
    await expect(page.getByText(reason)).toBeVisible(); // "Bekor qilish sababi:" row

    const saved = await getOrderApi(order.id);
    expect(saved.status).toBe("cancelled");
    expect(saved.cancel_reason).toBe(reason);
    expect(saved.cancelled_by).toBe("customer");
  });

  test("R-42: 'Yo'q, qoldirish' keeps the order", async ({ page }) => {
    const customer = await registerCustomerApi();
    const order = await createOrderAsCustomer(customer, (await createCarApi()).id);
    await seedCustomerSession(page, customer);
    await page.goto(`/order/${order.id}`);
    await page.getByRole("button", { name: "Bekor qilish" }).click();
    const sheet = page.getByTestId("cancel-order-sheet");
    await sheet.getByRole("button", { name: "Narx to'g'ri kelmadi" }).click();
    await sheet.getByRole("button", { name: "Yo'q, qoldirish" }).click();
    await expect(sheet).toHaveCount(0);
    expect((await getOrderApi(order.id)).status).toBe("pending");
  });
});
