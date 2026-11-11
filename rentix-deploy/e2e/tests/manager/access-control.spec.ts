import { test as base } from "@playwright/test";
import { managerTest as test, expect } from "../support/fixtures";
import { Api, rand } from "../support/api";

base.describe("unauthenticated access", () => {
  for (const path of ["/", "/admin/statistics", "/admin/managers", "/admin/company-info", "/manager/dashboard", "/manager/customers", "/manager/orders"]) {
    base(`${path} redirects to /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("button", { name: "Log In" })).toBeVisible();
    });
  }

  base("staff API requires authentication", async () => {
    const anon = await Api.as(null);
    for (const p of ["/user/all-users/", "/user/orders/", "/user/managers/", "/user/filials/"]) {
      const res = await anon.get(p);
      expect([401, 403], p).toContain(res.status);
    }
    await anon.dispose();
  });
});

test.describe("manager cannot reach admin-only features", () => {
  for (const path of ["/admin/statistics", "/admin/managers", "/admin/managers/create", "/admin/company-info", "/admin/settings", "/admin/cars"]) {
    test(`UI route ${path} is not available to a manager`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByText(/page you are looking for was not found/i)).toBeVisible();
      await expect(page.getByRole("heading", { name: "Manajerlar" })).toHaveCount(0);
      await expect(page.getByLabel("Company name")).toHaveCount(0);
    });
  }

  test("admin-only API calls are refused for a manager", async () => {
    const api = await Api.staff("manager");
    try {
      const denied = (r: { status: number; body: { status?: number; detail?: string } | null }) =>
        r.status === 401 || r.status === 403 || r.body?.status === 403;

      const createManager = await api.post("/user/create-manager/", {
        login: `hack_${rand(6)}`,
        password: "x12345678",
        company: 1,
        filial: 1,
        phone: "+998901112233",
        full_name: "Hack",
        work_time: "24/7",
      });
      expect(denied(createManager), JSON.stringify(createManager)).toBe(true);
      expect(denied(await api.patch("/user/companies/1/", { name: "Hacked" }))).toBe(true);
      expect(denied(await api.get("/user/managers/"))).toBe(true);
      expect(denied(await api.patch("/user/manager-crud/1/", { work_time: "00:00-00:01" }))).toBe(true);
    } finally {
      await api.dispose();
    }
  });

  test("permission errors are reported with an HTTP error status", async () => {
    const api = await Api.staff("manager");
    const res = await api.get("/user/managers/");
    await api.dispose();
    expect(res.body?.status).toBe(403);
    // BUG: many endpoints answer "forbidden" with HTTP 200 and {"status": 403} in
    // the body (and views.py's PermissionDenied is the Payme one, status_code=200),
    // so axios treats refusals as success — e.g. the manager notification form
    // reports success while nothing is saved.
    // rentix-backend/user/views.py (GetAllManagerView, CreateManagerView, ManagerCRUDView, …; import at line 76)
    test.fail();
    expect(res.status).toBe(403);
  });
});

test("customer token cannot use staff endpoints", async () => {
  const { registerCustomerApi } = await import("../support/api");
  const c = await registerCustomerApi();
  const api = await Api.as(c.access);
  try {
    const users = await api.get("/user/all-users/");
    expect(users.status === 403 || users.body?.status === 403, JSON.stringify(users).slice(0, 200)).toBe(true);
    const orders = await api.get("/user/orders/");
    const list = Array.isArray(orders.body) ? orders.body : [];
    // must not leak other customers' orders
    expect(list.every((o: { user: number }) => o.user === c.id)).toBe(true);
  } finally {
    await api.dispose();
  }
});
