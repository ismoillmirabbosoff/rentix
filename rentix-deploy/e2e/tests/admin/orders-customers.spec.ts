import { adminTest as test, expect } from "../support/fixtures";
import { createCarApi, createOrderAsCustomer, registerCustomerApi } from "../support/api";

test.describe("admin: orders and customers", () => {
  test("admin can open the company's order list and see an existing order", async ({ page }) => {
    const car = await createCarApi();
    const customer = await registerCustomerApi();
    const order = await createOrderAsCustomer(customer, car.id);

    await page.goto("/admin/orders");
    await expect(page.locator("body")).not.toContainText("Oops");
    // BUG: /admin/orders renders a hard-coded placeholder (<h1>Admin Orders</h1>),
    // the admin tab bar has no Orders entry, and nothing links to
    // /admin/orders/create or /admin/orders/:id — an admin cannot view orders at all.
    // rentix-admin/src/pages/Admin/ui/AdminOrders/ui/AdminOrders.tsx, shared/config/navigation/navigations.ts
    test.fail();
    await expect(page.getByText(customer.fullName)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(String(order.id))).toBeVisible();
  });

  test("admin can view registered customers", async ({ page }) => {
    const customer = await registerCustomerApi();
    await page.goto("/admin/statistics");
    await expect(page.getByRole("heading", { name: "Statistics" })).toBeVisible();
    // Missing feature: the admin role has no customers screen (no tab, the
    // /manager/customers route is restricted to MANAGER and renders 404 for admins).
    // rentix-admin/src/app/providers/RouterProvider/config/routerConfig.tsx
    test.fail();
    await page.goto("/manager/customers");
    await expect(page.getByText(customer.fullName)).toBeVisible({ timeout: 5_000 });
  });
});
