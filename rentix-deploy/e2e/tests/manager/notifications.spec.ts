import { type Page } from "@playwright/test";
import { managerTest as test, expect } from "../support/fixtures";
import { Api, createCarApi, createOrderAsCustomer, registerCustomerApi, uniqueSuffix } from "../support/api";
import { chooseAntdOption, tapBehindTabbar } from "../support/ui";

const notificationCard = (page: Page, text: string) =>
  page.locator('[class*="_paper_"]').filter({ hasText: text }).filter({ has: page.getByRole("button", { name: /Edit/ }) });

const createNotificationViaUI = async (page: Page, customerName: string, title: string, message: string) => {
  await page.goto("/manager/profile");
  await page.getByText(/^Notifications( count)?$/).click();
  await expect(page).toHaveURL(/\/manager\/notifications$/);
  await page.getByRole("heading", { name: "Notifications" }).locator("xpath=following-sibling::button[1]").click();
  await expect(page).toHaveURL(/\/manager\/notifications\/create$/);
  await chooseAntdOption(page, page.locator(".ant-form-item").filter({ hasText: "User (role: user)" }).locator(".ant-select"), customerName);
  await page.locator(".ant-form-item").filter({ hasText: "Title" }).locator("input").fill(title);
  await page.locator(".ant-form-item").filter({ hasText: "Message" }).locator("textarea").fill(message);
  const post = page.waitForResponse((r) => r.url().endsWith("/user/notifications/") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Submit" }).click();
  expect((await post).status()).toBeLessThan(300);
  await expect(page).toHaveURL(/\/manager\/notifications$/);
};

test.describe("manager notifications CRUD", () => {
  test("create a notification for a customer", async ({ page }) => {
    const customer = await registerCustomerApi();
    const title = `E2E xabar ${uniqueSuffix()}`;
    await createNotificationViaUI(page, customer.fullName, title, "Salom! Bu test xabari.");

    // BUG: the form "succeeds" and returns to the list, but nothing is created.
    // NotificationViewSet.perform_create raises PermissionDenied for admin/manager
    // ("Bildirishnoma yaratib bo'lmaydi"), and because views.py imports the
    // Payme-style user.exceptions.PermissionDenied (status_code = 200) the API
    // answers HTTP 200, so the frontend shows no error either.
    // rentix-backend/user/views.py:76 + NotificationViewSet.perform_create; user/exceptions.py
    test.fail();
    await expect(notificationCard(page, title)).toHaveCount(1, { timeout: 5_000 });
    const asCustomer = await Api.as(customer.access);
    const mine = await asCustomer.get("/user/notifications/");
    await asCustomer.dispose();
    const items = Array.isArray(mine.body) ? mine.body : mine.body?.results ?? [];
    expect(items.map((n: { title: string }) => n.title)).toContain(title);
  });

  /** Managers cannot create notifications (see above); use the one the backend generates for a new online order. */
  const generatedNotification = async () => {
    const customer = await registerCustomerApi();
    const car = await createCarApi();
    const order = await createOrderAsCustomer(customer, car.id);
    return `Yangi onlayn buyurtma №${order.id}`;
  };

  test("edit a notification's title", async ({ page }) => {
    const generatedTitle = await generatedNotification();
    await page.goto("/manager/notifications");
    const card = notificationCard(page, generatedTitle);
    await expect(card).toHaveCount(1);

    await tapBehindTabbar(page, card.getByRole("button", { name: /Edit/ }));
    await expect(page).toHaveURL(/\/manager\/notifications\/\d+$/);
    const titleInput = page.locator(".ant-form-item").filter({ hasText: "Title" }).locator("input");
    await expect(titleInput).toHaveValue(generatedTitle);
    const newTitle = `${generatedTitle} (tahrir ${uniqueSuffix()})`;
    await titleInput.fill(newTitle);
    await page.getByRole("button", { name: "Save" }).click();
    // BUG: every notification a manager can see is a system notification with
    // user = null, but the edit form requires "User (role: user)" — so saving
    // only shows "Select user" and nothing can ever be edited.
    // rentix-admin/src/pages/Manager/ui/Notifications/ManagerNotificationsEdit/ui/ManagerNotificationsEdit.tsx (validationSchema)
    test.fail();
    await expect(page.getByText("Notification updated.")).toBeVisible({ timeout: 5_000 });
  });

  test("delete a notification", async ({ page }) => {
    const generatedTitle = await generatedNotification();
    await page.goto("/manager/notifications");
    await expect(notificationCard(page, generatedTitle)).toHaveCount(1);
    await tapBehindTabbar(page, notificationCard(page, generatedTitle).getByRole("button", { name: /Delete/ }));
    await expect(page.getByText("Delete notification")).toBeVisible();
    const del = page.waitForResponse((r) => r.url().includes("/user/notifications/") && r.request().method() === "DELETE");
    await page.getByRole("button", { name: "Yes, delete" }).click();
    expect((await del).status()).toBeLessThan(300);
    await expect(page.getByText("Notification deleted successfully.")).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(notificationCard(page, generatedTitle)).toHaveCount(0);
  });

  test("create form validation", async ({ page }) => {
    await page.goto("/manager/notifications/create");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Select user")).toBeVisible();
    await expect(page.getByText("Enter title")).toBeVisible();
    await expect(page.getByText("Enter message")).toBeVisible();
  });
});
