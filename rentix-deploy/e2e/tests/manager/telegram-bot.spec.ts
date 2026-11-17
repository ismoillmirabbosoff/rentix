import { managerTest as test, expect } from "../support/fixtures";
import { Api } from "../support/api";

// N-38: menejer Telegram boti — profil kartasi. E2E stackda bot tokeni yo'q,
// shuning uchun "ulash" o'chiq va "sozlanmagan" yozuvi ko'rinadi.
test.describe("manager Telegram bot card (N-38)", () => {
  test("profile shows Telegram card with status from the API", async ({ page }) => {
    const api = await Api.staff("manager");
    const status = (await api.get("/user/manager/telegram/")).body;
    await api.dispose();
    expect(status).toMatchObject({ linked: false, bot_username: "rentix_manager_bot" });

    await page.goto("/manager/profile");
    const card = page.getByTestId("manager-telegram-card");
    await expect(card).toBeVisible();
    await expect(card.getByText("Telegram notifications")).toBeVisible();
    await expect(page.getByTestId("manager-telegram-status")).toHaveText("Not connected");
    const connect = card.getByRole("button", { name: "Connect Telegram" });
    await expect(connect).toBeVisible();
    if (!status.configured) {
      await expect(connect).toBeDisabled();
      await expect(card.getByText(/not set up yet/)).toBeVisible();
    }
  });
});
