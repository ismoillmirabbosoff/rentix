import { expect, type Page } from "@playwright/test";
import { rand } from "./api";
import { openDrawer, pickCalendarRange } from "./ui";

/** Unique, round daily price so promo prices stay integers: 400 000 … 1 399 900. */
export const uniquePrice = () => 400000 + Number(rand(4)) * 100;

/** "312345" → regex matching the ru-RU formatted amount "312 345" (NBSP-tolerant). */
export const moneyRe = (n: number) =>
  new RegExp(Math.round(n).toLocaleString("en-US").replace(/,/g, "[\\s\\u00a0\\u202f]"));

/**
 * Billed days for a search made now: the form defaults both pick-up and return
 * time to "now" rounded up to :00/:30, and 24h = 1 day, so N picked days bill as N.
 */
export const expectedDays = (_startInDays: number, lengthDays: number) => Math.max(1, lengthDays);

/** Home → pick-up branch → dates → "Natijalarni ko'rish". */
export const searchCars = async (page: Page, startInDays = 2, lengthDays = 2) => {
  await page.goto("/?company=1");
  await page.locator(".ant-select").filter({ hasText: "Olib ketish joyini tanlang" }).click();
  const loc = openDrawer(page, "Olib ketish joyi");
  await loc.locator('label[for="pickupLocation-1"]').click();
  await expect(loc).toBeHidden();

  await page.getByPlaceholder("Boshlanish sanasi").click();
  const dates = openDrawer(page, "Sana va vaqtni tanlang");
  const start = new Date();
  start.setDate(start.getDate() + startInDays);
  const end = new Date(start);
  end.setDate(end.getDate() + lengthDays);
  await pickCalendarRange(dates, start, end);
  await dates.getByRole("button", { name: "Tasdiqlash" }).click();
  await expect(dates).toBeHidden();

  await page.getByRole("button", { name: "Natijalarni ko'rish" }).click();
  await expect(page).toHaveURL(/\/pages\/result$/);
  await expect(page.getByText(/ta natija topildi/)).toBeVisible();
};

