import { type Page } from "@playwright/test";
import { adminTest as test, expect } from "../support/fixtures";
import { Api, createCarApi, pngFile, uniquePlate } from "../support/api";
import { openDrawer, pickCalendarRange } from "../support/ui";

/** Field wrapper (div._field_) that holds the given label text in the car form. */
const carField = (page: Page, label: string) =>
  page
    .getByText(new RegExp(`^${label}\\*?$`))
    .first()
    .locator('xpath=ancestor::div[contains(@class,"_field_")][1]');

const pickFromDrawer = async (page: Page, drawerTitle: string, item: string) => {
  const drawer = openDrawer(page, drawerTitle);
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: item }).first().click();
  await drawer.getByRole("button", { name: "Select" }).click();
  await expect(drawer).toBeHidden();
};

const chooseSelect = async (page: Page, label: string, option: string) => {
  await carField(page, label).locator(".ant-select").click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: option }).first().click();
};

const carCard = (page: Page, plateFragment: string) =>
  page.locator("li").filter({ hasText: plateFragment }).filter({ has: page.getByRole("button", { name: /^Edit/ }) });

const searchCars = async (page: Page, term: string) => {
  await page.getByPlaceholder("Search...").fill(term);
};

const getCar = async (id: number) => {
  const api = await Api.staff("admin");
  const res = await api.get(`/user/car/${id}/`);
  await api.dispose();
  return res.body?.data ?? res.body?.car ?? res.body;
};

test.describe("admin cars", () => {
  test("create a car with an image upload through the form", async ({ page }) => {
    const plate = uniquePlate(); // e.g. A123BC
    await page.goto("/admin/settings");
    await page.getByText("Cars", { exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/cars$/);
    await expect(page.getByRole("heading", { name: "Cars" }).first()).toBeVisible();

    await page.getByRole("button", { name: "Add car" }).click();
    await expect(page).toHaveURL(/\/admin\/cars\/create$/);

    // Image
    await page.locator('input[type="file"]').setInputFiles(pngFile("front.png"));
    await expect(page.getByRole("img", { name: "front.png" })).toBeVisible();

    // Brand / model pickers
    // R-56: brand = "marka", model = "model" (N-04: admin car form is translated, en-US here)
    await page.getByRole("button", { name: /Car make/ }).click();
    await pickFromDrawer(page, "Car make", "Chevrolet");
    await page.getByRole("button", { name: /Car model/ }).click();
    await pickFromDrawer(page, "Car model", "Malibu");
    await expect(page.getByRole("button", { name: /Car model.*Malibu/ })).toBeVisible();

    await chooseSelect(page, "Car color", "Black");
    await chooseSelect(page, "Fuel type", "Petrol");
    await chooseSelect(page, "Region code", "01");
    await page.locator("#car-form-car_number").fill(plate);
    await expect(page.locator("#car-form-car_number")).toHaveValue(
      `${plate[0]} ${plate.slice(1, 4)} ${plate.slice(4)}`,
    );
    await carField(page, "Car status").getByText("Available", { exact: true }).click();
    await page.locator("#car-form-sit_number").fill("5");
    await page.locator("#car-form-day_limit_city").fill("250");
    await page.locator("#car-form-cashbeck").fill("3");
    await page.locator("#car-form-cost_day_tash").fill("450000");
    await page.locator("#car-form-cost_hour_tash").fill("30000");
    await page.locator("#car-form-depozit").fill("1500000");
    await page.locator("#car-form-commit").fill("E2E test car");
    // Y-09: description per language
    await page.locator("#car-form-commit_ru").fill("E2E тестовая машина");
    await page.locator("#car-form-commit_en").fill("E2E test car EN");

    const created = page.waitForResponse((r) => r.url().includes("/user/create-car/") && r.request().method() === "POST");
    const imageUpload = page.waitForResponse((r) => r.url().endsWith("/user/car-images/") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Add car" }).click();
    const createdBody = await (await created).json();
    expect((await imageUpload).status()).toBeLessThan(300);
    await expect(page.getByText("Car added")).toBeVisible();
    await page.getByRole("button", { name: "Back to cars" }).click();
    await expect(page).toHaveURL(/\/admin\/cars$/);

    await searchCars(page, plate);
    const card = carCard(page, plate.slice(1, 4));
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("Chevrolet Malibu");

    // Backend state
    const carId = createdBody?.data?.id ?? createdBody?.id;
    const car = await getCar(carId);
    expect(car.car_number).toBe(`01${plate}`);
    expect(Number(car.cost_day_tash)).toBe(450000);
    expect(car.car_images?.length ?? 0).toBe(1);
    expect([car.commit, car.commit_ru, car.commit_en]).toEqual([
      "E2E test car",
      "E2E тестовая машина",
      "E2E test car EN",
    ]);
  });

  test("form validation blocks submitting an empty car", async ({ page }) => {
    await page.goto("/admin/cars/create");
    await page.getByRole("button", { name: "Add car" }).click();
    const fieldError = (text: string) => page.locator(".ant-form-item-explain-error", { hasText: text });
    await expect(fieldError("Select a color")).toBeVisible();
    await expect(fieldError("Enter the plate number")).toBeVisible();
    await expect(fieldError("Enter the daily price")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/cars\/create$/);
  });

  test("edit a car (price + image) and see the change persisted", async ({ page }) => {
    const car = await createCarApi();
    await page.goto("/admin/cars");
    await searchCars(page, car.plate.slice(2));
    const card = carCard(page, car.plate.slice(3, 6));
    await expect(card).toHaveCount(1);
    await card.getByRole("button", { name: /^Edit/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/cars/${car.id}$`));

    await expect(page.locator("#car-form-cost_day_tash")).toHaveValue("300 000");
    await page.locator("#car-form-cost_day_tash").fill("355000");
    await page.locator('input[type="file"]').setInputFiles(pngFile("side.png"));
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved")).toBeVisible();
    await page.getByRole("button", { name: "Back to cars" }).click();

    const updated = await getCar(car.id);
    expect(Number(updated.cost_day_tash)).toBe(355000);
    expect(updated.car_images?.length ?? 0).toBe(1);
  });

  test("N-30: leaving the edit form with unsaved changes asks in an app modal", async ({ page }) => {
    const car = await createCarApi();
    await page.goto("/admin/cars");
    await searchCars(page, car.plate.slice(2));
    await carCard(page, car.plate.slice(3, 6)).getByRole("button", { name: /^Edit/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/cars/${car.id}$`));
    await expect(page.locator("#car-form-cost_day_tash")).toHaveValue("300 000");
    const back = page.getByRole("button", { name: "arrow left icon" }).first();

    // no changes: back just leaves
    await back.click();
    await expect(page).toHaveURL(/\/admin\/cars$/);

    await searchCars(page, car.plate.slice(2));
    await carCard(page, car.plate.slice(3, 6)).getByRole("button", { name: /^Edit/ }).click();
    await expect(page.locator("#car-form-cost_day_tash")).toHaveValue("300 000");
    await page.locator("#car-form-cost_day_tash").fill("355000");
    let browserDialog = false;
    page.on("dialog", (d) => {
      browserDialog = true;
      void d.dismiss();
    });
    await back.click();
    await expect(page.getByText("Unsaved changes", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Stay" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/cars/${car.id}$`));
    await expect(page.locator("#car-form-cost_day_tash")).toHaveValue(/355/);
    await back.click();
    await page.getByRole("button", { name: "Leave" }).click();
    await expect(page).toHaveURL(/\/admin\/cars$/);
    expect(browserDialog).toBe(false);
    expect(Number((await getCar(car.id)).cost_day_tash)).toBe(300000);
  });

  test("car list search filters by plate", async ({ page }) => {
    const a = await createCarApi();
    const b = await createCarApi({ model: "2" });
    await page.goto("/admin/cars");
    await searchCars(page, a.plate.slice(2));
    await expect(carCard(page, a.plate.slice(3, 6))).toHaveCount(1);
    await expect(carCard(page, b.plate.slice(3, 6))).toHaveCount(0);
    await searchCars(page, "zzzz-no-such-car");
    // R-47: a search with no hits says so instead of "no cars added yet"
    await expect(page.getByText("No results found")).toBeVisible();
    await expect(page.getByText("No cars yet.")).toHaveCount(0);
  });

  test("status switch on the car card changes availability", async ({ page }) => {
    const car = await createCarApi();
    await page.goto("/admin/cars");
    await searchCars(page, car.plate.slice(2));
    const card = carCard(page, car.plate.slice(3, 6));
    const sw = card.getByRole("switch");
    await expect(sw).toBeChecked();
    // N-15/N-35 fixed: the switch PATCHes the car's on/off status.
    await sw.click();
    await expect.poll(async () => (await getCar(car.id)).status, { timeout: 5_000 }).toBe("unavailable");
    await expect(sw).not.toBeChecked();
  });

  test("car card shows the car's real rating, not placeholder data", async ({ page }) => {
    const car = await createCarApi();
    await page.goto("/admin/cars");
    await searchCars(page, car.plate.slice(2));
    const card = carCard(page, car.plate.slice(3, 6));
    await expect(card).toBeVisible();
    // R-24: rating used to be hard-coded "4.9 (13 sharhlar)" for every car;
    // a brand-new car has 0 reviews, so no rating is shown.
    await expect(card).not.toContainText("13 sharhlar");
    await expect(card).not.toContainText(/\d+ (reviews|sharh)/);
  });

  test("admin can delete a car", async ({ page }) => {
    const car = await createCarApi();
    await page.goto(`/admin/cars/${car.id}`);
    await expect(page.locator("#car-form-cost_day_tash")).toHaveValue("300 000");
    // BUG / missing feature: there is no delete action for a car anywhere in the
    // admin UI (list card or edit form), although the API (DELETE /user/car/<id>/)
    // and the "Delete car" translations exist.
    // rentix-admin/src/pages/Admin/ui/AdminCars/ui/AdminCars.tsx, AdminCarsForm/ui/CarForm.tsx
    test.fail();
    await expect(
      page.getByRole("button", { name: /o['’]chirish|delete|удалить/i }),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("promotion: create an upcoming promo and cancel it", async ({ page }) => {
    const car = await createCarApi();
    await page.goto("/admin/cars");
    await searchCars(page, car.plate.slice(2));
    await carCard(page, car.plate.slice(3, 6)).getByRole("button", { name: /^Promotion/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/cars/${car.id}/promo$`));

    // validation (form is pre-filled with 10% / next 7 days)
    const percent = page.getByPlaceholder("Enter the discount percentage");
    await percent.fill("");
    await page.getByRole("button", { name: "Start promotion" }).click();
    await expect(page.locator('[class*="fieldErrorText"]', { hasText: "Enter the discount percentage" })).toBeVisible();
    await percent.fill("150");
    await expect(page.locator('[class*="fieldErrorText"]', { hasText: "Percentage must be between 1 and 100" })).toBeVisible();

    await percent.fill("15");
    await page.locator('button[class*="rangeCard"]').click();
    const drawer = openDrawer(page, "Promotion period");
    const start = new Date();
    start.setDate(start.getDate() + 2);
    const end = new Date();
    end.setDate(end.getDate() + 5);
    await pickCalendarRange(drawer, start, end);
    await drawer.getByRole("button", { name: "Select" }).click();
    await expect(drawer).toBeHidden();

    const post = page.waitForResponse((r) => r.url().includes(`/user/car/${car.id}/promos/`) && r.request().method() === "POST");
    await page.getByRole("button", { name: "Start promotion" }).click();
    expect((await post).status()).toBeLessThan(300);

    const history = page.locator('article[class*="historyCard"]').filter({ hasText: "15%" });
    await expect(history).toHaveCount(1);
    await expect(history).toContainText("Upcoming");

    const cancel = page.waitForResponse((r) => r.url().includes("/cancel/"));
    await history.getByRole("button", { name: /Cancel promotion/ }).click();
    await page.getByRole("button", { name: "Yes, cancel" }).click();
    expect((await cancel).status()).toBeLessThan(300);
    await expect(history).toContainText("Cancelled");

    const api = await Api.staff("admin");
    const promos = await api.get(`/user/car/${car.id}/promos/`);
    await api.dispose();
    const list = Array.isArray(promos.body) ? promos.body : promos.body?.results ?? promos.body?.promos ?? [];
    const mine = list.find((p: { discount: number }) => Number(p.discount) === 15);
    expect(mine, JSON.stringify(list)).toBeTruthy();
    expect(String(mine.status ?? (mine.is_cancelled ? "cancelled" : ""))).toMatch(/cancel/i);
  });
});
