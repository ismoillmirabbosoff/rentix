import { customerTest as test, expect, fillCustomerPhone, registerCustomerViaUI, seedCustomerSession } from "../support/fixtures";
import { Api, registerCustomerApi, uniquePhone, uniqueSuffix } from "../support/api";

// Registered up-front so the backend's 1-minute OTP re-send window has passed
// by the time the "returning customer" test (last in this file) runs.
let existing: Awaited<ReturnType<typeof registerCustomerApi>>;
let existingRegisteredAt = 0;
test.beforeAll(async () => {
  existing = await registerCustomerApi();
  existingRegisteredAt = Date.now();
});

test.describe("customer app: phone + OTP login", () => {
  test("new customer registers with phone + OTP (inside Telegram Mini App)", async ({ page }) => {
    const phone = uniquePhone();
    const name = `UI Mijoz ${uniqueSuffix()}`;
    await registerCustomerViaUI(page, phone, name);

    // Logged in: profile header shows the customer
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.locator(".profile-top__content-phone-number")).toHaveText(phone);
    await expect(page.getByText("Mening keshbeklarim")).toBeVisible();
    await expect(page.getByText("Akkauntdan chiqish")).toBeVisible();
  });

  test("wrong OTP code is rejected", async ({ page }) => {
    await page.goto("/pages/profile?company=1");
    await page.getByRole("button", { name: "Tizimga kiring" }).click();
    await page.getByRole("button", { name: "Telefon raqam orqali kirish" }).click();
    await fillCustomerPhone(page, uniquePhone());
    // Make the backend not reveal the dev code so we can type a wrong one.
    await page.route(/\/user\/phone\/$/, async (route) => {
      const resp = await route.fetch();
      const body = await resp.json();
      delete body.code;
      await route.fulfill({ response: resp, json: body });
    });
    await page.getByRole("button", { name: "Kodni olish" }).click();
    const otp = page.locator("input.profile__otp-code-input");
    await expect(otp.first()).toBeVisible();
    await otp.first().click();
    await page.keyboard.type("9999");
    await expect(page.getByText("Kod xato kiritilgan")).toBeVisible();
    await expect(page.getByPlaceholder("Ism va familiyangizni kiriting")).toBeHidden();
  });
});

test.describe("customer app in a plain browser (no Telegram)", () => {
  test.use({ telegramUser: null });

  test("new customer can register by phone + OTP", async ({ page }) => {
    const phone = uniquePhone();
    await page.goto("/pages/profile?company=1");
    await page.getByRole("button", { name: "Tizimga kiring" }).click();
    await page.getByRole("button", { name: "Telefon raqam orqali kirish" }).click();
    await fillCustomerPhone(page, phone);
    await page.getByRole("button", { name: "Kodni olish" }).click();
    const nameInput = page.getByPlaceholder("Ism va familiyangizni kiriting");
    await expect(nameInput).toBeVisible();
    await nameInput.fill("Brauzer Mijoz");
    const reg = page.waitForResponse((r) => r.url().includes("/user/user-register/"));
    await page.getByRole("button", { name: "Ro'yxatdan o'tish" }).click();
    const res = await reg;
    // BUG: outside Telegram the register form sends telegram_id: 0 (the field is
    // disabled), and RegisterView rejects it: 400 "Telegram ID noto'g'ri." — a
    // customer opening the app in a normal browser can never sign up.
    // rentix-backend/user/views.py (RegisterView: parse_telegram_id required),
    // rentix-user/src/shared/ui/Login/Login.tsx (registerUser)
    test.fail();
    expect(res.status(), await res.text()).toBeLessThan(300);
    await expect(page.getByRole("heading", { name: "Brauzer Mijoz" })).toBeVisible();
  });
});

test.describe("customer profile", () => {
  test("edit profile name", async ({ page }) => {
    const c = await registerCustomerApi();
    await seedCustomerSession(page, c);
    await page.goto("/pages/profile");
    await expect(page.getByRole("heading", { name: c.fullName })).toBeVisible();
    await page.locator("button.profile-top__edit").click();
    await expect(page).toHaveURL(/\/pages\/profile-edit$/);
    const nameInput = page.getByLabel("To’liq ism-familiya");
    await expect(nameInput).toHaveValue(c.fullName);
    const newName = `Yangi Ism ${uniqueSuffix()}`;
    await nameInput.fill(newName);
    await page.getByRole("button", { name: "O’zgarishlarni saqlash" }).click();
    await expect(page.getByText("Muvaffaqiyatli").first()).toBeVisible();
    await page.getByRole("button", { name: "Yopish" }).click();
    await expect(page).toHaveURL(/\/pages\/profile/);
    await expect(page.getByRole("heading", { name: newName })).toBeVisible();

    const api = await Api.as(c.access);
    const me = (await api.get(`/user/user-profile/${c.id}/`)).body;
    await api.dispose();
    expect(me.full_name ?? me.user?.full_name).toBe(newName);
  });

  test("cashback, fines, FAQ and lease terms pages", async ({ page }) => {
    const c = await registerCustomerApi();
    await seedCustomerSession(page, c);
    await page.goto("/pages/profile");
    await page.getByText("Mening keshbeklarim").click();
    await expect(page).toHaveURL(/\/pages\/profile\/cashback$/);
    await expect(page.getByRole("heading", { name: "Mening keshbeklarim" })).toBeVisible();
    await expect(page.getByText("Hozircha keshbek yo‘q")).toBeVisible();

    await page.goto("/pages/profile");
    await page.getByText("Jarimalar").click();
    await expect(page).toHaveURL(/\/pages\/profile\/fines$/);
    await expect(page.getByText("Jarima yo‘q")).toBeVisible();

    await page.goto("/pages/profile");
    await page.getByText("Ko’p so’raladigan savollar").click();
    await expect(page).toHaveURL(/\/pages\/faq-question$/);
    await expect(page.getByRole("heading", { name: "Ko’p so’raladigan savollar" })).toBeVisible();

    await page.goto("/pages/profile");
    await page.getByText("Ijara shartlari").click();
    await expect(page).toHaveURL(/\/pages\/terms-of-lease$/);
    await expect(page.getByRole("heading", { name: "Ijara shartlari" })).toBeVisible();
  });

  test("logout", async ({ page }) => {
    const c = await registerCustomerApi();
    await seedCustomerSession(page, c);
    await page.goto("/pages/profile");
    await expect(page.getByRole("heading", { name: c.fullName })).toBeVisible();
    await page.getByText("Akkauntdan chiqish").click();
    await page.getByRole("button", { name: "Chiqish", exact: true }).click();
    await expect(page.getByRole("button", { name: "Tizimga kiring" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Tizimga kiring" })).toBeVisible();
    await page.goto("/pages/orders");
    await expect(page.getByText(c.fullName)).toHaveCount(0);
  });

  test("guest sees no fake reminders on the Notes tab", async ({ page }) => {
    await page.goto("/pages/notes?company=1");
    await expect(page.getByRole("heading", { name: /Eslatmalar|Hozircha eslatmalar yo‘q/ }).first()).toBeVisible();
    // BUG: when not logged in, Notes renders hard-coded demo reminders
    // ("Sizning buyurtmangiz boshlanishiga 2 soat qoldi." etc.) as if they were real.
    // rentix-user/src/pages/Notes/ui/Notes.tsx (`isAuth ? [] : notesData`), Notes/model/notesData.ts
    test.fail();
    await expect(page.getByText("Sizning buyurtmangiz boshlanishiga 2 soat qoldi.")).toHaveCount(0, { timeout: 3_000 });
  });
});

test.describe("customer app: returning customer", () => {
  test.setTimeout(150_000);
  test("returning customer logs in again with phone + OTP", async ({ page }) => {
    // The backend refuses to re-send an OTP to the same phone within 1 minute.
    const wait = existingRegisteredAt + 62_000 - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    await page.goto("/pages/profile?company=1");
    await page.getByRole("button", { name: "Tizimga kiring" }).click();
    await page.getByRole("button", { name: "Telefon raqam orqali kirish" }).click();
    await fillCustomerPhone(page, existing.phone);
    await page.getByRole("button", { name: "Kodni olish" }).click();
    // dev OTP is auto-filled → verified → is_registered → token issued
    await expect(page.getByRole("heading", { name: existing.fullName })).toBeVisible();
    await expect(page.getByPlaceholder("Ism va familiyangizni kiriting")).toBeHidden();
  });

});
