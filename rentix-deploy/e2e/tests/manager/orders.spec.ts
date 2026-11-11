import { type Page } from "@playwright/test";
import { managerTest as test, expect } from "../support/fixtures";
import {
  Api,
  createCarApi,
  createOrderAsCustomer,
  getOrderApi,
  pngFile,
  rand,
  registerCustomerApi,
  setOrderStatusApi,
  uniqueSuffix,
} from "../support/api";
import { openDrawer, pickCalendarRange, toast } from "../support/ui";

const orderCard = (page: Page, text: string) => page.locator("article").filter({ hasText: text });

const openActiveSubTab = async (page: Page, sub: "Tasdiqlangan" | "Jarayonda" | "Yakunlangan" | "Bekor qilingan") => {
  await page.goto("/manager/orders");
  await page.locator(".ant-segmented-item").filter({ hasText: "Active" }).click();
  await page.getByRole("button", { name: new RegExp(`^${sub}`) }).click();
};

/** Step 1/3 — renter data form. */
const fillRenterForm = async (page: Page, renter: { name: string; phone9: string; passport: string }) => {
  await expect(page.getByRole("heading", { name: "Rasmiylashtirish" })).toBeVisible();
  await page.getByLabel(/^F\.I\.Sh/).fill(renter.name);
  const phone = page.getByLabel(/^Telefon raqam/);
  await phone.click();
  await phone.pressSequentially(renter.phone9);
  await page.getByLabel(/^Pasport yoki ID karta raqami/).pressSequentially(renter.passport);
  await page.getByLabel(/^Doimiy ro'yxatga olingan joyi/).fill("Toshkent sh., Chilonzor 1");
  await page.getByLabel(/^Yashash joyi/).fill("Toshkent sh., Yunusobod 2");
  await page.locator('input[type="file"]').setInputFiles(pngFile("passport.png"));
  await page.getByRole("button", { name: "Davom etish" }).click();
};

const uploadFourSides = async (page: Page) => {
  const inputs = page.locator('input[type="file"]');
  await expect(inputs).toHaveCount(4);
  for (let i = 0; i < 4; i++) await inputs.nth(i).setInputFiles(pngFile(`side-${i}.png`));
};

test.describe("manager order status flow", () => {
  test("pending online order: view details and accept (confirm)", async ({ page }) => {
    const customer = await registerCustomerApi();
    const car = await createCarApi();
    const order = await createOrderAsCustomer(customer, car.id);

    await page.goto("/manager/orders");
    const card = orderCard(page, customer.fullName);
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("Chevrolet Gentra");
    await expect(card).toContainText(String(order.id));
    await card.getByRole("button", { name: /Details/ }).click();
    await expect(page).toHaveURL(new RegExp(`/manager/orders/${order.id}$`));
    await expect(page.getByText(customer.fullName)).toBeVisible();
    await expect(page.getByText("Umumiy summa:")).toBeVisible();

    await page.getByRole("button", { name: /Qabul qilish/ }).click();
    await expect(page.getByText("Buyurtmani tasdiqlash")).toBeVisible();
    await page.getByRole("button", { name: "Tasdiqlash", exact: true }).click();
    await expect(toast(page, "Buyurtma tasdiqlandi")).toBeVisible();
    await expect.poll(async () => (await getOrderApi(order.id)).status).toBe("confirmed");

    await openActiveSubTab(page, "Tasdiqlangan");
    await expect(orderCard(page, customer.fullName)).toContainText("Mashinani mijozga topshirish");
  });

  test("pending online order: reject", async ({ page }) => {
    const customer = await registerCustomerApi();
    const car = await createCarApi();
    const order = await createOrderAsCustomer(customer, car.id);

    await page.goto("/manager/orders");
    await orderCard(page, customer.fullName).getByRole("button", { name: /Details/ }).click();
    await expect(page).toHaveURL(new RegExp(`/manager/orders/${order.id}$`));
    await page.getByRole("button", { name: /Rad etish/ }).click();
    await page.getByRole("button", { name: "Ha, rad etaman" }).click();
    await expect(toast(page, "Buyurtma bekor qilindi")).toBeVisible();
    await expect.poll(async () => (await getOrderApi(order.id)).status).toMatch(/rejected|cancelled/);

    await openActiveSubTab(page, "Bekor qilingan");
    await expect(orderCard(page, customer.fullName)).toHaveCount(1);
  });

  test("confirmed order: cancel from the orders list", async ({ page }) => {
    const customer = await registerCustomerApi();
    const car = await createCarApi();
    const order = await createOrderAsCustomer(customer, car.id);
    await setOrderStatusApi(order.id, "confirmed");

    await openActiveSubTab(page, "Tasdiqlangan");
    const card = orderCard(page, customer.fullName);
    await card.getByRole("button", { name: /Buyurtmani bekor qilish/ }).click();
    await page.getByRole("button", { name: "Ha, bekor qilaman" }).click();
    await expect(toast(page, "Buyurtma bekor qilindi")).toBeVisible();
    await expect.poll(async () => (await getOrderApi(order.id)).status).toBe("cancelled");
  });

  test("confirmed online order: complete renter data → hand over car → return car → completed", async ({ page }) => {
    const bugs: string[] = [];
    const customer = await registerCustomerApi();
    const car = await createCarApi();
    const order = await createOrderAsCustomer(customer, car.id);
    await setOrderStatusApi(order.id, "confirmed");

    await openActiveSubTab(page, "Tasdiqlangan");
    await orderCard(page, customer.fullName).getByRole("button", { name: /Mashinani mijozga topshirish/ }).click();

    // Online orders have no passport data yet → "complete the order" cycle (step 1/3)
    await expect(page).toHaveURL(new RegExp(`/manager/orders/form/${car.id}$`));
    await fillRenterForm(page, { name: customer.fullName, phone9: customer.phone.slice(3), passport: `AB${rand(7)}` });

    // Step 2/3 is pre-filled from the order
    await expect(page).toHaveURL(/\/manager\/orders\/payment$/);
    await page.getByRole("button", { name: "Continue" }).click();
    // Step 3/3
    await expect(page).toHaveURL(/\/manager\/orders\/checkout$/);
    const patch = page.waitForResponse((r) => r.url().includes(`/user/order/${order.id}/`) && r.request().method() === "PATCH");
    await page.getByRole("button", { name: "Tasdiqlash va topshirish" }).click();
    expect((await patch).status()).toBeLessThan(300);

    // BUG: after the PATCH the app navigates to the handover page, but the
    // checkout page's `if (!draft) navigate(MANAGER_ORDERS)` effect fires after
    // clearOrderPaymentDraft() and bounces the manager to the orders list.
    // The manager has to press "Mashinani mijozga topshirish" a second time.
    // rentix-admin/src/pages/Manager/ui/Orders/ManagerOrderCheckout/ui/ManagerOrderCheckout.tsx (draft guard useEffect + finalize)
    await page.waitForURL(/\/manager\/orders(\/\d+\/handover)?$/);
    await page.waitForTimeout(1_000);
    if (!/\/handover$/.test(page.url())) {
      bugs.push("checkout → handover redirect bounced to /manager/orders");
      await openActiveSubTab(page, "Tasdiqlangan");
      await orderCard(page, customer.fullName).getByRole("button", { name: /Mashinani mijozga topshirish/ }).click();
    }

    // Handover photos
    await expect(page).toHaveURL(new RegExp(`/manager/orders/${order.id}/handover$`));
    await page.getByRole("button", { name: "Mashinani topshirish" }).click();
    await expect(page.getByText("Rasm yuklash majburiy").first()).toBeVisible();
    await uploadFourSides(page);
    await page.getByRole("button", { name: "Mashinani topshirish" }).click();
    await expect(toast(page, "Mashina muvaffaqiyatli topshirildi")).toBeVisible();
    await expect(page).toHaveURL(/\/manager\/orders/);
    await expect.poll(async () => (await getOrderApi(order.id)).status).toBe("in_progress");
    const afterHandover = await getOrderApi(order.id);
    expect(afterHandover.renter_passport_no).toMatch(/^AB\d{7}$/);

    // Return
    await openActiveSubTab(page, "Jarayonda");
    await orderCard(page, customer.fullName).getByRole("button", { name: /Buyurtmani yakunlash/ }).click();
    await expect(page).toHaveURL(new RegExp(`/manager/orders/${order.id}/return$`));
    await uploadFourSides(page);
    await page.getByRole("button", { name: "Mashinani qabul qilish" }).click();
    await expect(toast(page, "Mashina muvaffaqiyatli qabul qilindi")).toBeVisible();
    await expect.poll(async () => (await getOrderApi(order.id)).status).toBe("completed");

    await openActiveSubTab(page, "Yakunlangan");
    await expect(orderCard(page, customer.fullName)).toHaveCount(1);

    // Whole flow works, but the step-3 → handover navigation is broken (see above).
    if (bugs.length) test.fail();
    expect(bugs).toEqual([]);
  });
});

test.describe("manager creates an order for a walk-in customer", () => {
  test("dashboard → renter form → dates/region/payment → checkout → success", async ({ page }) => {
    const car = await createCarApi();
    const name = `Walk-in Mijoz ${uniqueSuffix()}`;
    const phone9 = `90${rand(7)}`;

    await page.goto("/manager/dashboard");
    await page.getByPlaceholder("Search by car name or plate").fill(car.plate.slice(2));
    await page.getByRole("button", { name: "Complete car setup" }).click();
    await expect(page).toHaveURL(new RegExp(`/manager/orders/form/${car.id}$`));

    // validation on an empty form
    await page.getByRole("button", { name: "Davom etish" }).click();
    await expect(page.getByText("F.I.Sh ni kiriting")).toBeVisible();
    await expect(page.getByText("Pasport yoki ID karta raqamini kiriting")).toBeVisible();

    await fillRenterForm(page, { name, phone9, passport: `AC${rand(7)}` });

    // Step 2/3
    await expect(page).toHaveURL(/\/manager\/orders\/payment$/);
    // With a single branch it is pre-selected; otherwise pick "Default filial" for pick-up and return.
    for (let i = 0; i < 2 && (await page.getByText("Filial tanlang").first().isVisible()); i++) {
      await page.getByText("Filial tanlang").first().click();
      await openDrawer(page, "Filial tanlang").getByText("Default filial").click();
    }
    await page.getByPlaceholder("Boshlanish sanasi").click();
    const dateDrawer = openDrawer(page, "Sana va vaqtni tanlang");
    const start = new Date();
    start.setDate(start.getDate() + 3);
    const end = new Date();
    end.setDate(end.getDate() + 5);
    await pickCalendarRange(dateDrawer, start, end);
    await dateDrawer.getByRole("button", { name: "Tasdiqlash" }).click();
    await page.locator(".ant-select").filter({ hasText: "Viloyatni tanlang" }).click();
    await openDrawer(page, "Viloyatni tanlang").getByRole("button", { name: "Toshkent shahri" }).click();
    await page.getByText("Naqd", { exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 3/3
    await expect(page).toHaveURL(/\/manager\/orders\/checkout$/);
    await expect(page.getByText(name)).toBeVisible();
    const create = page.waitForResponse((r) => r.url().includes("/user/create-order/"));
    await page.getByRole("button", { name: "Complete" }).click();
    const createResp = await create;
    // BUG: in normal (walk-in) mode finalize() POSTs /user/create-order/ without
    // `filial` (it is only sent in completion mode), and the backend requires it:
    // 400 {"filial":["Ushbu maydon to'ldirilishi shart."]}. A manager cannot create
    // any order for a walk-in customer.
    // rentix-admin/src/pages/Manager/ui/Orders/ManagerOrderCheckout/ui/ManagerOrderCheckout.tsx (finalize, else-branch)
    if (createResp.status() === 400 && (await createResp.text()).includes("filial")) test.fail();
    expect(createResp.status(), await createResp.text()).toBeLessThan(300);
    await expect(page).toHaveURL(/\/manager\/orders\/success$/);
    await expect(page.getByText("Order completed successfully")).toBeVisible();

    // backend: order exists with renter data; customer was created
    const api = await Api.staff("manager");
    const orders = (await api.get("/user/orders/")).body as Array<{ id: number; renter_full_name: string; status: string; car_info: { id: number } }>;
    const users = (await api.get("/user/all-users/")).body?.users ?? [];
    await api.dispose();
    const mine = orders.find((o) => o.renter_full_name === name);
    expect(mine, "order created").toBeTruthy();
    expect(mine!.car_info.id).toBe(car.id);
    expect(users.some((u: { full_name: string }) => u.full_name === name)).toBe(true);
  });
});
