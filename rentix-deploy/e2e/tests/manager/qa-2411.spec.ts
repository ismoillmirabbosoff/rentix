/**
 * QA re-check 24.11 (manager panel):
 * - N5: an old order whose manager was later moved to another branch can be
 *   cancelled from the panel (was 500 "Manager ushbu filialga tegishli emas");
 * - N6: a 4xx from set-status shows the server's detail, not the generic text;
 * - N8: cashback spent on an order comes back when the order is cancelled
 *   (one "refund" transaction, balance restored);
 * - N9: on a desktop screen the manager panel is a centred column (≤ 768 px),
 *   its fixed footer and bottom drawers stay inside it.
 */
import { execSync } from "node:child_process";
import { managerTest as test, expect } from "../support/fixtures";
import {
  Api,
  createCarApi,
  createOrderAsCustomer,
  futureRange,
  getOrderApi,
  registerCustomerApi,
  setOrderStatusApi,
  uniqueSuffix,
} from "../support/api";
import { IS_LOCAL } from "../support/env";
import { toast } from "../support/ui";

/** Runs a Django shell snippet in the local backend container; returns stdout. */
const shell = (py: string) =>
  (
    execSync(`docker exec rentix-backend python manage.py shell -c ${JSON.stringify(py)}`, {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .pop() ?? ""
  ).trim();

const cancelFromOrderPage = async (page: import("@playwright/test").Page, orderId: number) => {
  await page.goto(`/manager/orders/${orderId}`);
  await page.getByRole("button", { name: /Cancel order/ }).click();
  await page.getByRole("radio", { name: "Customer request" }).check();
  await page.getByRole("button", { name: "Yes, cancel" }).click();
};

test.describe("QA 24.11: manager panel", () => {
  test.skip(!IS_LOCAL, "needs the local docker stack");

  test("N5: an order whose manager moved to another branch can be cancelled", async ({ page }) => {
    const car = await createCarApi();
    const renter = await registerCustomerApi();
    const order = await createOrderAsCustomer(renter, car.id);
    await setOrderStatusApi(order.id, "confirmed");
    // Another manager accepted it, then was moved to a new branch (prod #143/#147)
    const tag = uniqueSuffix();
    const filialId = Number(
      shell(
        "from user.models import Filial, Manager, Order; " +
          "o = Order.objects.get(id=" + Number(order.id) + "); " +
          `f2 = Filial.objects.create(name='E2E N5 ${tag}', company_id=o.company_id, address='x', phone='+998900000005', is_24_7=True); ` +
          `m = Manager.objects.create(phone='+998900000003', full_name='E2E N5 ${tag}', company_id=o.company_id, filial_id=o.filial_id, work_time='9-18', login='e2e-n5-${tag}', status='active'); ` +
          "Order.objects.filter(id=o.id).update(manager=m); " +
          "Manager.objects.filter(id=m.id).update(filial=f2); " +
          "print(f2.id)",
      ),
    );
    try {
      await cancelFromOrderPage(page, order.id);
      await expect(toast(page, "Order cancelled")).toBeVisible();
      await expect.poll(async () => (await getOrderApi(order.id)).status).toBe("cancelled");
    } finally {
      shell(`from user.models import Filial; Filial.objects.filter(id=${filialId}).delete()`);
    }
  });

  test("N6: a rejected status change shows the server's reason", async ({ page }) => {
    const car = await createCarApi();
    const renter = await registerCustomerApi();
    const order = await createOrderAsCustomer(renter, car.id);
    await setOrderStatusApi(order.id, "confirmed");
    await page.goto(`/manager/orders/${order.id}`);
    await page.getByRole("button", { name: /Cancel order/ }).click();
    // Meanwhile the order was cancelled elsewhere (e.g. from the bot)
    const api = await Api.staff("manager");
    try {
      const res = await api.patch(`/user/order/${order.id}/set-status/`, {
        status: "cancelled",
        cancel_reason: "E2E",
      });
      expect(res.status).toBe(200);
    } finally {
      await api.dispose();
    }
    await page.getByRole("radio", { name: "Customer request" }).check();
    await page.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(toast(page, 'The order status cannot be changed from "Cancelled" to "Cancelled"')).toBeVisible();
  });

  test("N8: cashback spent on a cancelled order is refunded", async ({ page }) => {
    const car = await createCarApi();
    const renter = await registerCustomerApi();
    // 50 000 cashback earned on an earlier (completed) order of the company
    const earlier = await createOrderAsCustomer(renter, car.id, futureRange(10));
    shell(
      "from user.models import CashbackTransaction, Order; " +
        `Order.objects.filter(id=${Number(earlier.id)}).update(status='completed'); ` +
        `CashbackTransaction.objects.create(user_id=${renter.id}, order_id=${Number(earlier.id)}, type='earn', amount=50000)`,
    );
    const order = await createOrderAsCustomer(renter, car.id, futureRange(2), { use_cashback: true });
    await setOrderStatusApi(order.id, "confirmed");

    const cashback = async () => {
      const api = await Api.as(renter.access);
      try {
        return (await api.get("/user/cashback/")).body as Record<string, any>;
      } finally {
        await api.dispose();
      }
    };
    expect((await cashback()).balance).toBe(0);

    await cancelFromOrderPage(page, order.id);
    await expect(toast(page, "Order cancelled")).toBeVisible();
    await expect.poll(async () => (await cashback()).balance).toBe(50000);
    const data = await cashback();
    const refunds = (data.transactions as Array<Record<string, any>>).filter(
      (t) => t.type === "refund" && t.order_id === order.id,
    );
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBe(50000);
    expect(data.refunded).toBe(50000);
  });

  test.describe("N9: desktop", () => {
    test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

    test("the manager panel is a centred column, footer and drawer inside it", async ({ page }) => {
      const car = await createCarApi();
      const renter = await registerCustomerApi();
      const order = await createOrderAsCustomer(renter, car.id);
      await setOrderStatusApi(order.id, "confirmed");
      await page.goto(`/manager/orders/${order.id}`);
      await expect(page.getByRole("button", { name: /Cancel order/ })).toBeVisible();

      const root = await page.locator("#root").boundingBox();
      expect(root).not.toBeNull();
      expect(root!.width).toBeLessThanOrEqual(768);
      const viewport = page.viewportSize()!;
      expect(Math.abs(root!.x - (viewport.width - root!.width) / 2)).toBeLessThan(12);

      // Fixed bottom menu (tab bar) of the dashboard stays in the column
      await page.goto("/manager/dashboard");
      const tab = page.locator('[class*="_tab_"]').first();
      await expect(tab).toBeVisible();
      const tabBox = await tab.boundingBox();
      expect(tabBox!.width).toBeLessThanOrEqual(768);
      expect(tabBox!.x).toBeGreaterThan(300);

      // Bottom drawer (cancel reason) is as wide as the column
      await page.goto(`/manager/orders/${order.id}`);
      await page.getByRole("button", { name: /Cancel order/ }).click();
      const drawer = page.locator(".ant-drawer-bottom .ant-drawer-content-wrapper").last();
      await expect(drawer).toBeVisible();
      const drawerBox = await drawer.boundingBox();
      expect(drawerBox!.width).toBeLessThanOrEqual(768);
      expect(drawerBox!.x).toBeGreaterThan(300);
    });
  });
});
