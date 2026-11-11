import { expect, type Page } from "@playwright/test";
import { rand } from "./api";
import { openDrawer, pickCalendarRange } from "./ui";

/** Unique, round daily price so promo prices stay integers: 400 000 … 1 399 900. */
export const uniquePrice = () => 400000 + Number(rand(4)) * 100;

/** "312345" → regex matching the ru-RU formatted amount "312 345" (NBSP-tolerant). */
export const moneyRe = (n: number) =>
  new RegExp(Math.round(n).toLocaleString("en-US").replace(/,/g, "[\\s\\u00a0\\u202f]"));

/**
 * Billed days for a search made now: the form defaults pick-up time to "now"
 * and return time to "now + 10h", so N picked days usually bill as N+1.
 */
export const expectedDays = (startInDays: number, lengthDays: number) => {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() + startInDays);
  const endClock = new Date(now.getTime() + 10 * 3600_000);
  const end = new Date(start);
  end.setDate(end.getDate() + lengthDays);
  end.setHours(endClock.getHours(), endClock.getMinutes(), 0, 0);
  start.setSeconds(0, 0);
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 3600_000 / 24));
};

/** Home → pick-up branch → dates → "Natijalarni ko’rish". */
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

  await page.getByRole("button", { name: "Natijalarni ko’rish" }).click();
  await expect(page).toHaveURL(/\/pages\/result$/);
  await expect(page.getByText(/ta natija topildi/)).toBeVisible();
};

