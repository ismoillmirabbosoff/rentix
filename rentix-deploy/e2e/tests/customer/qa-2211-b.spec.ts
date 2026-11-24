/**
 * QA re-check 22.11 (part 2, customer app):
 * - #6: after signing in again the "Sessiya tugadi" sheet closes without a
 *   page reload (auth status is reset);
 * - #7: the SMS code field is focused when the code screen opens, has
 *   autocomplete="one-time-code", inputmode="numeric", pattern [0-9]*; a
 *   pasted / autofilled code fills every box and is submitted automatically;
 * - #9: the car page re-checks availability for the current dates instead of
 *   trusting the (possibly stale) car from the results list.
 */
import { type Page } from "@playwright/test";
import {
  customerTest as test,
  customerStorageState,
  expect,
  fillCustomerPhone,
} from "../support/fixtures";
import {
  createCarApi,
  createOrderAsCustomer,
  futureRange,
  registerCustomerApi,
  setOrderStatusApi,
  uniquePhone,
} from "../support/api";
import { moneyRe, searchCars, uniquePrice } from "../support/customer";

/** Makes the backend not reveal the dev code, so the test types/pastes it. */
const hideDevCode = async (page: Page) => {
  await page.route(/\/user\/phone\/$/, async (route) => {
    const resp = await route.fetch();
    const body = await resp.json();
    delete body.code;
    await route.fulfill({ response: resp, json: body });
  });
};

test.describe("QA 22.11 part 2: customer app", () => {
  test("#6: signing in again closes the 'session expired' sheet without a reload", async ({ page }) => {
    const stale = await registerCustomerApi();
    await page.goto("/?company=1");
    // a session whose access and refresh tokens are both rejected
    const state = customerStorageState({ ...stale, access: "bad.token.value", refresh: "bad" }).origins[0]
      .localStorage;
    await page.evaluate((items) => {
      for (const { name, value } of items) localStorage.setItem(name, value);
    }, state);
    await page.goto("/pages/orders");
    const expired = page.getByText("Sessiya tugadi");
    await expect(expired).toBeVisible();

    await page.getByRole("button", { name: "Qayta kirish" }).click();
    await fillCustomerPhone(page, uniquePhone());
    await page.getByRole("button", { name: "Kodni olish" }).click();
    const name = page.getByPlaceholder("Ism va familiyangizni kiriting");
    await expect(name).toBeVisible();
    await name.fill("Qayta Kirgan Mijoz");
    await page.getByRole("button", { name: "Ro'yxatdan o'tish" }).click();
    await expect(name).toBeHidden();

    // new session: the 401 status is reset and the sheet stays closed
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("state") || "{}")?.auth?.status))
      .toBeNull();
    await expect(expired).toBeHidden();
    // stays closed while the app keeps working with the new session
    await page.waitForTimeout(1500);
    await expect(expired).toBeHidden();
  });

  test("#7: the SMS code field is focused, one-time-code, numeric, paste fills every box and submits", async ({ page }) => {
    await page.goto("/pages/profile?company=1");
    await page.getByRole("button", { name: "Tizimga kiring" }).click();
    await page.getByRole("button", { name: "Telefon raqam orqali kirish" }).click();
    await fillCustomerPhone(page, uniquePhone());
    await hideDevCode(page);
    await page.getByRole("button", { name: "Kodni olish" }).click();

    const otp = page.locator("input.profile__otp-code-input");
    await expect(otp).toHaveCount(1);
    await expect(otp).toBeFocused();
    await expect(otp).toHaveAttribute("autocomplete", "one-time-code");
    await expect(otp).toHaveAttribute("inputmode", "numeric");
    await expect(otp).toHaveAttribute("pattern", "[0-9]*");

    const verify = page.waitForRequest((r) => r.url().includes("/user/code/") && r.method() === "POST");
    // SMS text pasted / autofilled at once: only the digits are taken
    await otp.evaluate((el, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, "Kod: 1111");
    const boxes = page.locator(".profile__otp-code-box");
    await expect(boxes).toHaveCount(4);
    await expect(boxes).toHaveText(["1", "1", "1", "1"]);
    expect(JSON.parse((await verify).postData() ?? "{}").code).toBe("1111");
    // new phone → verified → registration form
    await expect(page.getByPlaceholder("Ism va familiyangizni kiriting")).toBeVisible();
  });

  test("#7: typing the code submits it automatically once 4 digits are entered", async ({ page }) => {
    await page.goto("/pages/profile?company=1");
    await page.getByRole("button", { name: "Tizimga kiring" }).click();
    await page.getByRole("button", { name: "Telefon raqam orqali kirish" }).click();
    await fillCustomerPhone(page, uniquePhone());
    await hideDevCode(page);
    await page.getByRole("button", { name: "Kodni olish" }).click();
    const otp = page.locator("input.profile__otp-code-input");
    await expect(otp).toBeFocused();
    let posts = 0;
    page.on("request", (r) => {
      if (r.url().includes("/user/code/") && r.method() === "POST") posts += 1;
    });
    await page.keyboard.type("111");
    await page.waitForTimeout(500);
    expect(posts).toBe(0);
    await page.keyboard.type("1");
    await expect(page.getByPlaceholder("Ism va familiyangizni kiriting")).toBeVisible();
    expect(posts).toBe(1);
  });

  test("#9: the car page re-checks availability for the searched dates", async ({ page }) => {
    const price = uniquePrice();
    const car = await createCarApi({ cost_day_tash: String(price) });
    await searchCars(page, 2, 1);
    const card = page.locator("article").filter({ hasText: moneyRe(price) });
    await expect(card).toHaveCount(1);

    // meanwhile someone books the car for these dates
    const other = await registerCustomerApi();
    const order = await createOrderAsCustomer(other, car.id, futureRange(1, 3));
    await setOrderStatusApi(order.id, "confirmed");

    const check = page.waitForResponse((r) => r.url().includes("/user/filter-car/") && r.request().method() === "POST");
    await card.click(); // SPA navigation with the car from the (stale) results list
    await expect(page).toHaveURL(new RegExp(`/pages/car/${car.id}$`));
    expect((await check).status()).toBe(200);
    await expect(
      page.getByText("Bu mashina tanlangan sanalarda bo'sh emas. Boshqa sana yoki mashina tanlang."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Buyurtmani rasmiylashtirish" })).toHaveCount(0);
  });
});
