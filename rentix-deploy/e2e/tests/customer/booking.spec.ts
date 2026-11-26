import { type Page } from "@playwright/test";
import { customerTest as test, expect, seedCustomerSession } from "../support/fixtures";
import { Api, CAR_DEPOSIT, createCarApi, futureRange, getOrderApi, isoLocal, registerCustomerApi } from "../support/api";
import { expectedDays, moneyRe, searchCars, uniquePrice } from "../support/customer";

const resultCard = (page: Page, price: number) =>
  page.locator("article").filter({ hasText: moneyRe(price) });

test.describe("customer: browse and filter cars", () => {
  test("search form validation", async ({ page }) => {
    await page.goto("/?company=1");
    await page.getByRole("button", { name: "Natijalarni ko'rish" }).click();
    await expect(page.getByText("Boshlanish vaqtini tanlang")).toBeVisible();
    await expect(page.locator(".ant-form-item-has-error").first()).toBeVisible();
    await expect(page).toHaveURL(/\/(\?company=1)?$/);
  });

  test("search shows available cars with price for the rental period; promo and brand filters", async ({ page }) => {
    const gentraPrice = uniquePrice();
    const mercPrice = gentraPrice + 1;
    const gentra = await createCarApi({ cost_day_tash: String(gentraPrice) });
    await createCarApi({ brand: "2", model: "4", cost_day_tash: String(mercPrice), fuel: "Electro" });

    // active 15% promo on the Gentra
    const admin = await Api.staff("admin");
    const now = new Date(Date.now() - 60_000);
    const promoEnd = new Date(Date.now() + 10 * 86400_000);
    const promo = await admin.post(`/user/car/${gentra.id}/promos/`, {
      discount: 15,
      start_date: isoLocal(now),
      end_date: isoLocal(promoEnd),
      reminders: [],
    });
    await admin.dispose();
    expect(promo.body?.status).toBe("active");
    const promoPrice = Number(promo.body.new_cost);
    expect(promoPrice).toBe(gentraPrice * 0.85);

    const days = expectedDays(2, 2);
    await searchCars(page, 2, 2);
    const gentraCard = resultCard(page, promoPrice);
    await expect(gentraCard).toHaveCount(1);
    await expect(gentraCard).toContainText("Chevrolet Gentra");
    await expect(gentraCard).toContainText("-15%");
    await expect(gentraCard).toContainText(moneyRe(promoPrice * days)); // "Jami: … (N kun uchun)"
    await expect(gentraCard).toContainText(`${days} kun uchun`);
    const mercCard = resultCard(page, mercPrice);
    await expect(mercCard).toHaveCount(1);
    await expect(mercCard).toContainText("Mercedes-Benz");

    // AKSIYADA (promo) chip
    await page.getByRole("button", { name: /AKSIYADA/ }).click();
    await expect(gentraCard).toHaveCount(1);
    await expect(mercCard).toHaveCount(0);
    await page.getByRole("button", { name: /AKSIYADA/ }).click(); // toggle off

    // ELEKTROMOBIL chip
    await page.getByRole("button", { name: /ELEKTROMOBIL/ }).click();
    await expect(mercCard).toHaveCount(1);
    await expect(gentraCard).toHaveCount(0);
    await page.getByRole("button", { name: /ELEKTROMOBIL/ }).click();

    // brand chip
    await page.getByRole("button", { name: /^MERCEDES/ }).click();
    await expect(mercCard).toHaveCount(1);
    await expect(gentraCard).toHaveCount(0);
    await page.getByRole("button", { name: /^MERCEDES/ }).click();

    // sort cheap → expensive: Gentra (promo price) before Mercedes
    await page.getByRole("button", { name: "Saralash" }).click();
    await page.getByRole("dialog").getByText("Arzondan qimmatgacha").click();
    await page.waitForTimeout(300);
    const prices = await page.locator("article strong").filter({ hasText: "so'm" }).allInnerTexts();
    const nums = prices
      .map((t) => Number(t.split(",")[0].replace(/[^\d]/g, "")))
      .filter((n) => n > 0);
    expect(nums, JSON.stringify(prices)).toEqual([...nums].sort((a, b) => a - b));
  });

  test("cars marked unavailable by the company are not offered", async ({ page }) => {
    const price = uniquePrice();
    const off = await createCarApi({ cost_day_tash: String(price), status: "unavailable" });
    await searchCars(page, 2, 1);
    await expect(page.locator("article").first()).toBeVisible();
    // N-15 fixed: /user/filter-car/ skips cars the admin set to "Mavjud emas"…
    await expect(resultCard(page, price)).toHaveCount(0);
    // …and the server refuses to book them.
    const customer = await registerCustomerApi();
    const api = await Api.as(customer.access);
    const range = futureRange(2);
    const res = await api.post("/user/create-order/", {
      car: off.id,
      filial: 1,
      start_time: range.startIso,
      end_time: range.endIso,
      location_from: "Default filial",
      location_to: "Default filial",
      region: "tashkentCity",
      airport_VIP: false,
      is_driver: false,
      use_cashback: false,
      payment_system: "cash",
    });
    await api.dispose();
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(JSON.stringify(res.body)).toContain("car");
  });

  test("car details page", async ({ page }) => {
    const price = uniquePrice();
    await createCarApi({ cost_day_tash: String(price), commit: "E2E izoh: Toshkent bo'ylab" });
    await searchCars(page, 2, 1);
    await resultCard(page, price).click();
    await expect(page).toHaveURL(/\/pages\/car\/\d+$/);
    await expect(page.getByRole("heading", { level: 1, name: "Chevrolet Gentra" })).toBeVisible();
    await expect(page.getByText("Xususiyatlari")).toBeVisible();
    await expect(page.getByText("Kunlik ijara narxi:")).toBeVisible();
    await expect(page.getByText(moneyRe(price)).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Buyurtmani rasmiylashtirish" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Qo'shimcha izoh" })).toBeVisible();
    // The "Qo'shimcha izoh" section shows the car's own comment (car.commit), not placeholder text.
    await expect(page.getByText("E2E izoh: Toshkent bo'ylab")).toBeVisible();
  });
});

test.describe("customer: booking and own orders", () => {
  test("book a car, see it in my orders, then cancel it", async ({ page }) => {
    const customer = await registerCustomerApi();
    const price = uniquePrice();
    const car = await createCarApi({ cost_day_tash: String(price) });
    await seedCustomerSession(page, customer);

    const days = expectedDays(3, 2);
    await searchCars(page, 3, 2);
    await resultCard(page, price).click();
    await page.getByRole("button", { name: "Buyurtmani rasmiylashtirish" }).click();
    await expect(page).toHaveURL(/\/order\/create$/);
    await expect(page.getByRole("heading", { name: "Buyurtmani rasmiylashtirish" })).toBeVisible();
    await expect(page.getByText("Oq, Chevrolet Gentra")).toBeVisible();
    // N-01/N-19: payable total = rental + deposit (zalog)
    const payable = price * days + CAR_DEPOSIT;
    await expect(page.locator("footer")).toContainText(moneyRe(payable));

    // R-22: driver documents — F.I.Sh prefilled from the profile, passport required
    await expect(page.getByRole("heading", { name: "Haydovchi hujjatlari" })).toBeVisible();
    await expect(page.getByPlaceholder("Familiya Ism Sharif")).toHaveValue(customer.fullName);
    // no payment method is preselected
    await expect(page.getByRole("button", { name: "To'lash" })).toBeDisabled();
    await page.getByRole("button", { name: "Naqd" }).click();
    await page.getByRole("button", { name: "To'lash" }).click();
    await expect(page.getByText("Pasport seriyasi va raqamini kiriting")).toBeVisible();
    await expect(page).toHaveURL(/\/order\/create$/);
    await page.getByPlaceholder("AA 1234567").fill("aa1234567");

    const create = page.waitForResponse((r) => r.url().includes("/user/create-order/"));
    await page.getByRole("button", { name: "To'lash" }).click();
    const createResp = await create;
    expect(createResp.status(), await createResp.text()).toBeLessThan(300);
    const orderId = (await createResp.json())?.data?.id;
    await expect(page).toHaveURL(new RegExp(`/order/${orderId}$`));
    await expect(page.getByText("Kutilmoqda").first()).toBeVisible();
    await expect(page.getByText(moneyRe(payable)).first()).toBeVisible();

    // backend state
    const api = await Api.as(customer.access);
    const order = (await api.get(`/user/order/${orderId}/`)).body;
    await api.dispose();
    expect(order.status).toBe("pending");
    expect(order.car).toBe(car.id);
    expect(order.payment_system).toBe("cash");
    expect(Number(order.cost)).toBe(payable);
    const staffView = await getOrderApi(orderId);
    expect(staffView.renter_full_name).toBe(customer.fullName);
    expect(staffView.renter_passport_no).toBe("AA 1234567");

    // My orders
    await page.goto("/pages/orders");
    await expect(page.getByRole("button", { name: "Faol buyurtmalar" })).toBeVisible();
    const card = page.locator("article").filter({ hasText: "Kutilmoqda" }).filter({ hasText: "Chevrolet Gentra" }).first();
    await expect(card).toBeVisible();

    await page.goto(`/order/${orderId}`);
    await page.getByRole("button", { name: "Bekor qilish" }).click();
    const sheet = page.getByTestId("cancel-order-sheet");
    await expect(sheet.getByText("Buyurtmani bekor qilish")).toBeVisible();
    // R-42 (customer): a reason is required before cancelling
    await expect(sheet.getByRole("button", { name: "Ha, bekor qilish" })).toBeDisabled();
    await sheet.getByRole("button", { name: "Rejalarim o'zgardi" }).click();
    const cancel = page.waitForResponse((r) => r.url().includes(`/user/order/${orderId}/set-status/`));
    await sheet.getByRole("button", { name: "Ha, bekor qilish" }).click();
    expect((await cancel).status()).toBeLessThan(300);
    await expect(page.getByText("Bekor qilingan").first()).toBeVisible();
    const cancelled = await getOrderApi(orderId);
    // QA 26.11 Y1: preset reason is stored as a code
    expect(cancelled.cancel_reason).toBe("plans_changed");
    expect(cancelled.cancelled_by).toBe("customer");

    await page.goto("/pages/orders");
    await page.getByRole("button", { name: "Buyurtmalar tarixi" }).click();
    await expect(page.locator("article").filter({ hasText: "Bekor qilingan" }).first()).toBeVisible();
  });
});
