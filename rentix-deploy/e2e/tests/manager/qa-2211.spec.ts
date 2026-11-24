/**
 * QA re-check 22.11 (part 1, notifications):
 * - #2: sending to all / several customers shows a confirmation modal with the
 *   recipient count and a per-language preview; Cancel sends nothing;
 * - #5: a warning when RU or EN is empty (customers get the UZ text);
 * - #1: a banner per language: preview with UZ fallback, shown in the history,
 *   in the edit form and returned to the customer;
 * - #3: the edit form has UZ/RU/EN tabs and the recipient is read-only.
 */
import { type Page } from "@playwright/test";
import { managerTest as test, expect } from "../support/fixtures";
import {
  Api,
  createCarApi,
  createOrderAsCustomer,
  pngFile,
  registerCustomerApi,
  uniqueSuffix,
} from "../support/api";
import { chooseAntdOption, tapBehindTabbar, toast } from "../support/ui";

const formItem = (page: Page, label: string) => page.locator(".ant-form-item").filter({ hasText: label });
const langTab = (page: Page, lang: "UZ" | "RU" | "EN") =>
  page.locator(".ant-segmented-item").filter({ hasText: new RegExp(`^${lang}( \\*)?$`) });

const customerNotifications = async (access: string) => {
  const api = await Api.as(access);
  try {
    const res = await api.get("/user/notifications/");
    return (Array.isArray(res.body) ? res.body : res.body?.results ?? []) as Array<Record<string, any>>;
  } finally {
    await api.dispose();
  }
};

test.describe("QA 22.11: notifications", () => {
  test("#2/#5: 'All customers' asks for confirmation with count and preview; Cancel sends nothing", async ({ page }) => {
    const customer = await registerCustomerApi();
    await createOrderAsCustomer(customer, (await createCarApi()).id);
    const api = await Api.staff("manager");
    const dry = await api.post("/user/notifications/", {
      target: "all", title_uz: "x", message_uz: "y", dry_run: true,
    });
    await api.dispose();
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    const total = Number(dry.body.count);
    expect(total).toBeGreaterThan(0);

    const sends: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/user/notifications/") && r.method() === "POST") sends.push(r.postData() ?? "");
    });

    await page.goto("/manager/notifications/create");
    await page.locator(".ant-segmented-item").filter({ hasText: "All customers" }).click();
    const title = `E2E hammaga ${uniqueSuffix()}`;
    await formItem(page, "Title (UZ)").locator("input").fill(title);
    await formItem(page, "Message (UZ)").locator("textarea").fill("Salom hammaga!");

    // #5: RU and EN are empty -> warning; it follows what is filled
    const warning = page.getByTestId("empty-langs-warning");
    await expect(warning).toHaveText("RU and EN are empty: customers will get the UZ text");
    await langTab(page, "RU").click();
    await formItem(page, "Title (RU)").locator("input").fill(`${title} RU`);
    await formItem(page, "Message (RU)").locator("textarea").fill("Привет всем!");
    await expect(warning).toHaveText("EN is empty: customers will get the UZ text");

    await page.getByRole("button", { name: "Submit" }).click();
    const modal = page.getByRole("dialog").filter({ hasText: "Confirm sending" });
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId("confirm-count")).toHaveText(
      `The message will be sent to all customers: ${total}.`,
    );
    await expect(modal.getByTestId("confirm-preview-uz")).toContainText(title);
    await expect(modal.getByTestId("confirm-preview-ru")).toContainText(`${title} RU`);
    await expect(modal.getByTestId("confirm-preview-ru")).toContainText("Привет всем!");
    // EN falls back to the UZ text, marked in the preview
    await expect(modal.getByTestId("confirm-preview-en")).toContainText("UZ text");
    await expect(modal.getByTestId("confirm-preview-en")).toContainText(title);
    await expect(modal.getByTestId("empty-langs-warning")).toHaveText(
      "EN is empty: customers will get the UZ text",
    );

    await modal.getByRole("button", { name: "Cancel" }).click();
    await expect(modal).toBeHidden();
    await expect(page).toHaveURL(/\/manager\/notifications\/create$/);
    // only the dry run went out, nothing was sent
    expect(sends.length).toBe(1);
    expect(sends.every((body) => body.includes('"dry_run":true'))).toBe(true);
    expect((await customerNotifications(customer.access)).map((n) => n.title)).not.toContain(title);
  });

  test("#1/#3: banner per language, history, edit form with RU/EN and a read-only recipient", async ({ page }) => {
    const customer = await registerCustomerApi();
    await createOrderAsCustomer(customer, (await createCarApi()).id);

    await page.goto("/manager/notifications/create");
    await chooseAntdOption(page, formItem(page, "Customer").locator(".ant-select"), customer.fullName);
    const title = `E2E banner ${uniqueSuffix()}`;
    await formItem(page, "Title (UZ)").locator("input").fill(title);
    await formItem(page, "Message (UZ)").locator("textarea").fill("Yangi aksiya!");

    await page.getByTestId("banner-input-uz").setInputFiles(pngFile("banner.png"));
    await expect(page.getByTestId("banner-preview-uz")).toBeVisible();
    // RU has no own banner: the UZ banner is used
    await langTab(page, "RU").click();
    await expect(page.getByTestId("banner-field-ru")).toContainText("The UZ banner is used");
    await expect(page.getByTestId("banner-preview-ru")).toHaveCount(0);

    // one customer: no confirmation modal
    const post = page.waitForResponse((r) => r.url().endsWith("/user/notifications/") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Submit" }).click();
    const res = await post;
    expect(res.status()).toBe(201);
    expect(res.request().headers()["content-type"]).toContain("multipart/form-data");
    await expect(toast(page, "Sent")).toBeVisible();
    await expect(page.getByRole("dialog").filter({ hasText: "Confirm sending" })).toHaveCount(0);

    // history shows the banner
    await expect(page).toHaveURL(/\/manager\/notifications$/);
    const card = page.locator('[class*="_paper_"]').filter({ hasText: title });
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId("history-banner-uz")).toHaveAttribute("src", /notification-banners\//);

    // the customer gets the banner for every language
    const mine = (await customerNotifications(customer.access)).find((n) => n.title === title);
    expect(mine).toBeTruthy();
    expect(mine!.banner_url).toMatch(/notification-banners\/.+\.png$/);
    expect(mine!.banners.ru).toBe(mine!.banner_url);
    expect(mine!.banners.en).toBe(mine!.banner_url);

    // #3: edit form — RU/EN tabs, banner shown, recipient read-only
    await tapBehindTabbar(page, card.getByRole("button", { name: /Edit/ }));
    await expect(page).toHaveURL(/\/manager\/notifications\/\d+$/);
    const recipient = page.getByTestId("notification-recipient");
    await expect(recipient).toBeDisabled();
    await expect(recipient).toHaveValue(new RegExp(customer.fullName));
    // the saved banner is shown (src from the API; the e2e media host may not serve it)
    await expect(page.getByTestId("banner-preview-uz")).toHaveAttribute("src", mine!.banner_url);
    await expect(formItem(page, "Title (UZ)").locator("input")).toHaveValue(title);
    await langTab(page, "RU").click();
    await formItem(page, "Title (RU)").locator("input").fill(`${title} RU`);
    await formItem(page, "Message (RU)").locator("textarea").fill("Новая акция!");
    await langTab(page, "EN").click();
    await formItem(page, "Title (EN)").locator("input").fill(`${title} EN`);
    await formItem(page, "Message (EN)").locator("textarea").fill("New promo!");
    await expect(page.getByTestId("empty-langs-warning")).toHaveCount(0);
    const patch = page.waitForResponse((r) => r.url().includes("/user/notifications/") && r.request().method() === "PATCH");
    await page.getByRole("button", { name: "Save" }).click();
    expect((await patch).status()).toBe(200);
    await expect(page.getByText("Notification updated.")).toBeVisible();

    const updated = (await customerNotifications(customer.access)).find((n) => n.id === mine!.id);
    expect(updated!.title_ru).toBe(`${title} RU`);
    expect(updated!.message_en).toBe("New promo!");
    expect(updated!.user).toBe(customer.id);
    expect(updated!.banner_url).toBe(mine!.banner_url);
  });
});
