import { type Page } from "@playwright/test";
import { managerTest as test, expect } from "../support/fixtures";
import {
  Api,
  createCarApi,
  createOrderAsCustomer,
  registerCustomerApi,
  uniqueSuffix,
} from "../support/api";
import { chooseAntdOption, tapBehindTabbar, toast } from "../support/ui";

const anyNotificationCard = (page: Page, text: string) => page.locator('[class*="_paper_"]').filter({ hasText: text });
const notificationCard = (page: Page, text: string) =>
  anyNotificationCard(page, text).filter({ has: page.getByRole("button", { name: /Edit/ }) });

const createNotificationViaUI = async (page: Page, customerName: string, title: string, message: string) => {
  await page.goto("/manager/profile");
  await page.getByText(/^Notifications( count)?$/).click();
  await expect(page).toHaveURL(/\/manager\/notifications$/);
  await page.getByRole("heading", { name: "Notifications" }).locator("xpath=following-sibling::button[1]").click();
  await expect(page).toHaveURL(/\/manager\/notifications\/create$/);
  await chooseAntdOption(page, page.locator(".ant-form-item").filter({ hasText: "Customer" }).locator(".ant-select"), customerName);
  // N-03: UZ/RU/EN tabs; UZ is required, the others fall back to it
  await page.locator(".ant-form-item").filter({ hasText: "Title (UZ)" }).locator("input").fill(title);
  await page.locator(".ant-form-item").filter({ hasText: "Message (UZ)" }).locator("textarea").fill(message);
  const post = page.waitForResponse((r) => r.url().endsWith("/user/notifications/") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Submit" }).click();
  expect((await post).status()).toBe(201);
  await expect(toast(page, "Sent")).toBeVisible();
  await expect(page).toHaveURL(/\/manager\/notifications$/);
};

test.describe("manager notifications CRUD", () => {
  test("create a notification for a customer", async ({ page }) => {
    const customer = await registerCustomerApi();
    // Menejer faqat buyurtmasi bor mijozlarni ko'radi (asl logika)
    await createOrderAsCustomer(customer, (await createCarApi()).id);
    const title = `E2E xabar ${uniqueSuffix()}`;
    await createNotificationViaUI(page, customer.fullName, title, "Salom! Bu test xabari.");

    // N-03/N-13 fixed: managers can send notifications to their customers.
    await expect(notificationCard(page, title)).toHaveCount(1);
    const asCustomer = await Api.as(customer.access);
    const mine = await asCustomer.get("/user/notifications/");
    await asCustomer.dispose();
    const items = Array.isArray(mine.body) ? mine.body : mine.body?.results ?? [];
    expect(items.map((n: { title: string }) => n.title)).toContain(title);
  });

  /** The notification the backend generates for a new online order (a system notification). */
  const generatedNotification = async () => {
    const customer = await registerCustomerApi();
    const car = await createCarApi();
    const order = await createOrderAsCustomer(customer, car.id);
    return `Yangi onlayn buyurtma №${order.id}`;
  };

  /** A manual notification sent by the manager through the API (POST /user/notifications/). */
  const manualNotification = async () => {
    const customer = await registerCustomerApi();
    await createOrderAsCustomer(customer, (await createCarApi()).id);
    const title = `E2E qo'lda ${uniqueSuffix()}`;
    const api = await Api.staff("manager");
    const res = await api.post("/user/notifications/", { user: customer.id, title_uz: title, message_uz: "E2E manual xabar" });
    await api.dispose();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { customer, title };
  };

  test("system notifications are read-only (no Edit / Delete)", async ({ page }) => {
    // R-33: notifications generated for order events can't be edited or deleted
    const generatedTitle = await generatedNotification();
    // Y-01: order events live in the "System" tab ("Sent" = broadcast history)
    await page.goto("/manager/notifications?tab=system");
    const card = anyNotificationCard(page, generatedTitle);
    await expect(card).toHaveCount(1);
    await expect(card.getByRole("button", { name: /Edit/ })).toHaveCount(0);
    await expect(card.getByRole("button", { name: /Delete/ })).toHaveCount(0);
  });

  test("edit a notification's title", async ({ page }) => {
    const { title } = await manualNotification();
    await page.goto("/manager/notifications");
    const card = notificationCard(page, title);
    await expect(card).toHaveCount(1);

    await tapBehindTabbar(page, card.getByRole("button", { name: /Edit/ }));
    await expect(page).toHaveURL(/\/manager\/notifications\/\d+$/);
    const titleInput = page.locator(".ant-form-item").filter({ hasText: "Title" }).locator("input");
    await expect(titleInput).toHaveValue(title);
    const newTitle = `${title} (tahrir ${uniqueSuffix()})`;
    await titleInput.fill(newTitle);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Notification updated.")).toBeVisible();
    await page.goto("/manager/notifications");
    await expect(notificationCard(page, newTitle)).toHaveCount(1);
  });

  test("delete a notification", async ({ page }) => {
    const { title } = await manualNotification();
    await page.goto("/manager/notifications");
    await expect(notificationCard(page, title)).toHaveCount(1);
    await tapBehindTabbar(page, notificationCard(page, title).getByRole("button", { name: /Delete/ }));
    await expect(page.getByText("Delete notification")).toBeVisible();
    const del = page.waitForResponse((r) => r.url().includes("/user/notifications/") && r.request().method() === "DELETE");
    await page.getByRole("button", { name: "Yes, delete" }).click();
    expect((await del).status()).toBeLessThan(300);
    await expect(page.getByText("Notification deleted successfully.")).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(anyNotificationCard(page, title)).toHaveCount(0);
  });

  test("create form validation", async ({ page }) => {
    await page.goto("/manager/notifications/create");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Select user")).toBeVisible();
    await expect(page.getByText("Enter title")).toBeVisible();
    await expect(page.getByText("Enter message")).toBeVisible();
  });
});
