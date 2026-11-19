/**
 * QA re-check 18.11 (part B): R-42 — the reason a customer gave when
 * cancelling is shown to the manager on the order page.
 */
import { managerTest as test, expect } from "../support/fixtures";
import { Api, createCarApi, createOrderAsCustomer, registerCustomerApi, uniqueSuffix } from "../support/api";

test.describe("QA 18.11 part B: manager", () => {
  test("R-42: customer's cancel reason is visible in the manager panel", async ({ page }) => {
    const customer = await registerCustomerApi();
    const order = await createOrderAsCustomer(customer, (await createCarApi()).id);
    const reason = `E2E sabab ${uniqueSuffix()}`;
    const api = await Api.as(customer.access);
    const res = await api.patch(`/user/order/${order.id}/set-status/`, {
      status: "cancelled",
      cancel_reason: reason,
    });
    await api.dispose();
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);

    await page.goto(`/manager/orders/${order.id}`);
    await expect(page.getByText(customer.fullName).first()).toBeVisible();
    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByText(/Cancellation reason \(customer\)/)).toBeVisible();
  });
});
