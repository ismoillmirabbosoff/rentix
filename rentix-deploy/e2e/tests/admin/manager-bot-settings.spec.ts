import { adminTest as test, expect } from "../support/fixtures";
import { Api } from "../support/api";

// N-38: admin sozlamalarida menejer boti bildirishnoma turlari
test.describe("manager bot notification settings (N-38)", () => {
  test("admin toggles a notification type and it is saved", async ({ page }) => {
    await page.goto("/admin/settings");
    await page.getByText("Manager Telegram bot").click();
    const drawer = page.getByTestId("manager-bot-settings");
    await expect(drawer.getByText("New order", { exact: true })).toBeVisible();
    const toggle = page.getByTestId("manager-bot-toggle-new_review");
    await expect(toggle).toBeChecked();

    const patch = page.waitForResponse(
      (r) => r.url().includes("/user/manager-bot/settings/") && r.request().method() === "PATCH",
    );
    await toggle.click();
    expect((await patch).status()).toBe(200);
    await expect(toggle).not.toBeChecked();

    const api = await Api.staff("admin");
    expect((await api.get("/user/manager-bot/settings/")).body.notifications.new_review).toBe(false);

    // holatni qaytarish
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect
      .poll(async () => (await api.get("/user/manager-bot/settings/")).body.notifications.new_review)
      .toBe(true);
    await api.dispose();
  });
});
