import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { flushThrottle, freshAuthState, type Customer, uniqueTelegramId } from "./api";
import { USER_URL } from "./env";

/* ───────────────────────────── staff ───────────────────────────── */

/** Page already logged in as the company admin (storageState from the setup project). */
export const adminTest = base.extend({
  storageState: async ({}, use) => {
    await use(await freshAuthState("admin"));
  },
});

/** Page already logged in as the manager. */
export const managerTest = base.extend({
  storageState: async ({}, use) => {
    await use(await freshAuthState("manager"));
  },
});

/* ───────────────────────────── customer app ───────────────────────────── */

export interface TelegramUserStub {
  id: number;
  first_name: string;
  username?: string;
}

/**
 * The customer app loads https://telegram.org/js/telegram-web-app.js. We
 * fulfil it locally so tests don't depend on the internet:
 *  - with a user  → behaves like the Mini App opened from a chat (initDataUnsafe.user
 *    is filled; initData stays empty so no server-side HMAC session is attempted)
 *  - with null    → plain browser, no window.Telegram at all.
 */
export const stubTelegram = async (context: BrowserContext, user: TelegramUserStub | null) => {
  const body = user
    ? `(function(){var u=${JSON.stringify(user)};var noop=function(){};
        window.Telegram={WebApp:{initData:"",initDataUnsafe:{user:u},colorScheme:"light",themeParams:{},
        isExpanded:true,viewportHeight:window.innerHeight,viewportStableHeight:window.innerHeight,
        ready:noop,expand:noop,close:noop,onEvent:noop,offEvent:noop,setHeaderColor:noop,setBackgroundColor:noop,
        enableClosingConfirmation:noop,disableVerticalSwipes:noop,
        MainButton:{show:noop,hide:noop,setText:noop,onClick:noop,offClick:noop,enable:noop,disable:noop,showProgress:noop,hideProgress:noop},
        BackButton:{show:noop,hide:noop,onClick:noop,offClick:noop},
        HapticFeedback:{impactOccurred:noop,notificationOccurred:noop,selectionChanged:noop}}};})();`
    : "/* plain browser: no Telegram WebApp */";
  await context.route(/telegram\.org\/js\/telegram-web-app\.js/, (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body }),
  );
};

/** localStorage "state" exactly as the customer app's redux store persists it. */
export const customerStorageState = (c: Customer) => ({
  cookies: [],
  origins: [
    {
      origin: USER_URL,
      localStorage: [
        { name: "rentix_company_id", value: "1" },
        { name: "i18nextLng", value: "uz" },
        {
          name: "state",
          value: JSON.stringify({
            auth: {
              user: {
                id: String(c.id),
                role: "cutomer",
                token: Buffer.from(c.access).toString("base64"),
                refresh: c.refresh,
                phone: c.phone,
                telegram_id: c.telegramId,
                full_name: c.fullName,
                tg_nick: "",
                is_phone_verified: true,
                company_id: "1",
              },
              status: null,
            },
            employee: { users: {} },
          }),
        },
      ],
    },
  ],
});

type CustomerFixtures = {
  /** Telegram user injected into the Mini App stub; null = plain browser. */
  telegramUser: TelegramUserStub | null;
};

export const customerTest = base.extend<CustomerFixtures>({
  telegramUser: [
    async ({}, use) => {
      await use({ id: uniqueTelegramId(), first_name: "E2E", username: "e2e_user" });
    },
    { option: true },
  ],
  context: async ({ context, telegramUser }, use) => {
    flushThrottle(); // OTP endpoints allow 30 requests/hour per IP
    await stubTelegram(context, telegramUser);
    await context.addInitScript(() => {
      try {
        if (!localStorage.getItem("i18nextLng")) localStorage.setItem("i18nextLng", "uz");
      } catch {
        /* ignore */
      }
    });
    await use(context);
  },
});

/**
 * Logs a brand-new customer in through the real UI:
 * Profil → Tizimga kiring → Telefon raqam orqali kirish → Kodni olish
 * → (dev OTP is auto-filled and verified) → Ro'yxatdan o'tish.
 */
export const registerCustomerViaUI = async (page: Page, phone: string, fullName: string) => {
  await page.goto("/pages/profile?company=1");
  await page.getByRole("button", { name: "Tizimga kiring" }).click();
  await page.getByRole("button", { name: "Telefon raqam orqali kirish" }).click();
  await fillCustomerPhone(page, phone);
  await page.getByRole("button", { name: "Kodni olish" }).click();
  // SMS_MODE=dev returns the code in the API response and the app pre-fills
  // the OTP inputs, which triggers verification automatically. Type it in
  // case it was not pre-filled.
  const otp = page.locator("input.profile__otp-code-input");
  await expect(otp.first()).toBeVisible();
  const registerName = page.getByPlaceholder("Ism va familiyangizni kiriting");
  if (!(await registerName.isVisible().catch(() => false))) {
    const value = await otp.first().inputValue();
    if (!value) {
      await otp.first().click();
      await page.keyboard.type("1111");
    }
  }
  await expect(registerName).toBeVisible();
  await registerName.fill(fullName);
  await page.getByRole("button", { name: "Ro'yxatdan o'tish" }).click();
};

/** Puts an API-registered customer's session into the app's localStorage (no OTP round-trip). */
export const seedCustomerSession = async (page: Page, c: Customer) => {
  await page.goto("/?company=1");
  const state = customerStorageState(c).origins[0].localStorage;
  await page.evaluate((items) => {
    for (const { name, value } of items) localStorage.setItem(name, value);
  }, state);
  await page.reload();
};

export const fillCustomerPhone = async (page: Page, phone: string) => {
  // react-phone-number-input, international format with +998 default
  const input = page.locator("input.PhoneInputInput");
  await input.click();
  await input.fill(`+${phone}`);
};

export { expect };
