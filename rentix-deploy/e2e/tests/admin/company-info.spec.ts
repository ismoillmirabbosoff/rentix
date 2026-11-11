import { type Page } from "@playwright/test";
import { adminTest as test, expect } from "../support/fixtures";
import { Api, deleteFilialLocal, rand, uniqueSuffix } from "../support/api";

const openCompanyInfo = async (page: Page) => {
  await page.goto("/admin/settings");
  await page.getByText("Company information").click();
  await expect(page).toHaveURL(/\/admin\/company-info$/);
  await expect(page.getByLabel("Company name")).not.toHaveValue("", { timeout: 15_000 });
  // The seeded "Default filial" has no address; the form requires one.
  const firstAddress = page.getByLabel("Branch address").first();
  if (!(await firstAddress.inputValue())) await firstAddress.fill("Toshkent, Amir Temur 1");
};

const save = async (page: Page) => {
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Company details saved")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).last().click();
};

const filials = async () => {
  const api = await Api.staff("admin");
  const res = await api.get("/user/filials/");
  await api.dispose();
  return res.body as Array<{ id: number; name: string; is_24_7: boolean; workdays: Array<{ weekday: number; is_working: boolean }> }>;
};

const deleteFilialApi = async (id: number) => deleteFilialLocal(id);

test.describe("admin company information", () => {
  test("edit company name and phone", async ({ page }) => {
    const api = await Api.staff("admin");
    const before = (await api.get("/user/companies/1/")).body;
    try {
      await openCompanyInfo(page);
      const newName = `Rentix E2E ${rand(3)}`;
      await page.getByLabel("Company name").fill(newName);
      const phone = page.getByLabel("Phone number").first();
      await phone.fill("");
      await phone.pressSequentially("901112233");
      await expect(phone).toHaveValue(/\+998 \(90\) 111 22 33/);
      await save(page);

      const after = (await api.get("/user/companies/1/")).body;
      expect(after.name ?? after.data?.name).toBe(newName);
      expect(String(after.phone1 ?? after.data?.phone1)).toContain("901112233");

      await page.reload();
      await expect(page.getByLabel("Company name")).toHaveValue(newName);
    } finally {
      await api.patch("/user/companies/1/", { name: before.name ?? "Rentix", phone1: before.phone1 ?? "+998900000000" });
      await api.dispose();
    }
  });

  test("add a branch with custom working hours", async ({ page }) => {
    const name = `E2E filial ${uniqueSuffix()}`;
    let createdId: number | undefined;
    try {
      await openCompanyInfo(page);
      await page.locator('[class*="branch__plus"]').click();
      await page.getByLabel("Branch name").last().fill(name);
      await page.getByLabel("Branch address").last().fill("Toshkent, Yunusobod 7");
      const ph = page.getByLabel("Phone number").last();
      await ph.pressSequentially("935554433");

      // Working hours of the new branch: not 24/7, Sunday off
      await page.getByRole("button", { name, exact: true }).click();
      const allDay = page.getByRole("checkbox", { name: "24/7" });
      if (await allDay.isChecked()) await allDay.uncheck();
      const sunday = page
        .getByText("Sunday", { exact: true })
        .locator('xpath=ancestor::div[.//button[@role="switch"]][1]')
        .getByRole("switch");
      if (await sunday.isChecked()) await sunday.click();
      await expect(sunday).not.toBeChecked();

      await save(page);

      const created = (await filials()).find((f) => f.name === name);
      expect(created, "new branch saved").toBeTruthy();
      createdId = created!.id;
      expect(created!.is_24_7).toBe(false);
      const sun = created!.workdays.find((w) => w.weekday === 6);
      expect(sun?.is_working).toBe(false);
      const mon = created!.workdays.find((w) => w.weekday === 0);
      expect(mon?.is_working).toBe(true);
    } finally {
      if (createdId) await deleteFilialApi(createdId);
    }
  });

  test("removing a branch in the form deletes it", async ({ page }) => {
    const name = `E2E filial del ${uniqueSuffix()}`;
    const api = await Api.staff("admin");
    const created = await api.post("/user/filials/", {
      name,
      address: "Toshkent, Chilonzor 3",
      phone: "+998935554433",
      company: 1,
      is_24_7: true,
    });
    await api.dispose();
    expect(created.status).toBeLessThan(300);
    const id = created.body?.id ?? created.body?.data?.id;
    try {
      await openCompanyInfo(page);
      await expect(page.locator(`input[value="${name}"]`)).toHaveCount(1);
      // delete button sits in the same branch block as the name input
      const block = page.locator("article").filter({ has: page.locator(`input[value="${name}"]`) });
      await block.getByRole("button", { name: "delete branch" }).click();
      await expect(page.locator(`input[value="${name}"]`)).toHaveCount(0);
      await save(page);

      // BUG: removeBranch() only hides the branch in form state and the save
      // handler only iterates visible branches — no delete request is sent, and
      // the backend has no delete for branches anyway (DELETE /user/filials/<id>/
      // → 405). The "deleted" branch comes back after reload.
      // rentix-admin/src/pages/Admin/ui/AdminCompanyInfo/ui/AdminCompanyInfo.tsx (removeBranch / updateCompanyMutation),
      // rentix-backend/user/views.py (FilialDetailView has no delete)
      test.fail();
      expect((await filials()).some((f) => f.name === name)).toBe(false);
    } finally {
      if (id) await deleteFilialApi(id);
    }
  });
});
