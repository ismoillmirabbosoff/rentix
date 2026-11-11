import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Both apps use the same scrollable 12-month range Calendar (first month = current month).
 * Clicks start and end days. `scope` should be the open drawer.
 */
export const pickCalendarRange = async (scope: Locator | Page, start: Date, end: Date) => {
  const now = new Date();
  const clickDay = async (d: Date) => {
    const monthIndex = (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth();
    const month = scope.locator('[class*="monthWrapper"]').nth(monthIndex);
    const day = month.getByRole("button", { name: String(d.getDate()), exact: true });
    await day.scrollIntoViewIfNeeded();
    await day.click();
  };
  await clickDay(start);
  await clickDay(end);
};

/** The currently open antd drawer (last one wins when nested). */
export const openDrawer = (page: Page, title?: string | RegExp) => {
  const drawers = page.locator(".ant-drawer-content-wrapper:visible");
  return title
    ? drawers.filter({ has: page.locator(".ant-drawer-title", { hasText: title }) }).last()
    : drawers.last();
};

/**
 * antd <Select>: open it and pick an option by visible text. The option list is
 * virtualised (and these selects have no search), so scroll until it renders.
 */
export const chooseAntdOption = async (page: Page, select: Locator, optionText: string | RegExp) => {
  await select.click();
  const dropdown = page.locator(".ant-select-dropdown:visible");
  await expect(dropdown).toBeVisible();
  const option = dropdown.locator(".ant-select-item-option").filter({ hasText: optionText }).first();
  const holder = dropdown.locator(".rc-virtual-list-holder");
  for (let i = 0; i < 200 && !(await option.isVisible()); i++) {
    await holder.evaluate((el) => el.scrollBy(0, 150));
    await page.waitForTimeout(30);
  }
  await expect(option).toBeVisible();
  await option.click();
};

/** antd message/toast text. */
export const toast = (page: Page, text: string | RegExp) =>
  page.locator(".ant-message-notice").filter({ hasText: text });

/**
 * Lists inside the tab-bar layouts lack bottom padding: at maximum scroll the
 * last card's buttons stay mostly covered by the fixed bottom tab bar. Scroll
 * to the bottom and tap the visible top edge of the button, like a user would.
 */
export const tapBehindTabbar = async (page: Page, button: Locator) => {
  await button.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await button.click({ position: { x: 30, y: 4 } });
};
