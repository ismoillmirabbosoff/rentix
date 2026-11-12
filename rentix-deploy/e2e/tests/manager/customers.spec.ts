import { type Page } from "@playwright/test";
import { managerTest as test, expect } from "../support/fixtures";
import { Api, createCarApi, createOrderAsCustomer, displayPhone, registerCustomerApi } from "../support/api";

const customerCard = (page: Page, text: string) =>
  page.locator("article").filter({ hasText: text }).filter({ has: page.getByRole("button", { name: /View customer profile/ }) });

test.describe("manager customers", () => {
  test("a customer who booked in the customer app is listed", async ({ page }) => {
    // Menejer kompaniyada buyurtmasi bor mijozlarni ko'radi (UsersAllGetView)
    const customer = await registerCustomerApi();
    await createOrderAsCustomer(customer, (await createCarApi()).id);
    await page.goto("/manager/customers");
    await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
    const card = customerCard(page, customer.fullName);
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(displayPhone(customer.phone));
    await expect(card).toContainText("Active");
  });

  test("customer card shows the registration date", async ({ page }) => {
    const customer = await registerCustomerApi();
    await createOrderAsCustomer(customer, (await createCarApi()).id);
    await page.goto("/manager/customers");
    const card = customerCard(page, customer.fullName);
    await expect(card).toHaveCount(1);
    // BUG: "Joined" is always "—": /user/all-users/ returns no registration
    // timestamp, so the card can never show when the client joined.
    // rentix-backend/user/views.py (UsersAllGetView) / rentix-admin ManagerCustomers.tsx (registeredAt)
    test.fail();
    await expect(card).not.toContainText(/Joined:\s*—/, { timeout: 3_000 });
  });

  test("search by name and by phone", async ({ page }) => {
    const a = await registerCustomerApi();
    const b = await registerCustomerApi();
    await createOrderAsCustomer(a, (await createCarApi()).id);
    await createOrderAsCustomer(b, (await createCarApi()).id);
    await page.goto("/manager/customers");
    const search = page.getByPlaceholder("Search by name or phone number");
    await search.fill(a.fullName);
    await expect(customerCard(page, a.fullName)).toHaveCount(1);
    await expect(customerCard(page, b.fullName)).toHaveCount(0);
    await search.fill(b.phone.slice(-7));
    await expect(customerCard(page, b.fullName)).toHaveCount(1);
    await expect(customerCard(page, a.fullName)).toHaveCount(0);
    await search.fill("no-such-customer-zzz");
    await expect(page.getByText("No matches for your search")).toBeVisible();
  });

  test("customer profile shows details and the customer's orders", async ({ page }) => {
    const customer = await registerCustomerApi();
    const car = await createCarApi();
    const order = await createOrderAsCustomer(customer, car.id);

    await page.goto("/manager/customers");
    await page.getByPlaceholder("Search by name or phone number").fill(customer.phone);
    await customerCard(page, customer.fullName).getByRole("button", { name: /View customer profile/ }).click();
    await expect(page).toHaveURL(new RegExp(`/manager/customers/${customer.id}$`));
    await expect(page.getByText(customer.fullName).first()).toBeVisible();
    await expect(page.getByText(displayPhone(customer.phone)).first()).toBeVisible();
    await expect(page.getByText("Customer details")).toBeVisible();

    // pending order is listed in the profile's orders section
    await page.locator("button, [role=tab], .ant-segmented-item").filter({ hasText: /^Pending/ }).first().click();
    await expect(page.getByText(/Chevrolet/).first()).toBeVisible();
    await page.getByRole("button", { name: /Details/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/manager/orders/${order.id}$`));
  });

  test("block and unblock a customer (blacklist)", async ({ page }) => {
    const customer = await registerCustomerApi();
    await createOrderAsCustomer(customer, (await createCarApi()).id);
    await page.goto(`/manager/customers/${customer.id}`);
    await expect(page.getByText(customer.fullName).first()).toBeVisible();

    await page.getByRole("button", { name: "Block customer" }).click();
    await expect(page.getByText("Customer has been blocked")).toBeVisible();
    await expect(page.getByRole("button", { name: "Unblock customer" })).toBeVisible();

    // A blocked customer cannot request an OTP any more
    const anon = await Api.as(null);
    const otp = await anon.post("/user/phone/", { phone: customer.phone });
    await anon.dispose();
    expect(otp.body?.code ?? otp.body?.detail).toMatch(/account_blocked|bloklangansiz/);

    await page.goto("/manager/customers");
    await expect(customerCard(page, customer.fullName)).toHaveCount(0);
    await page.locator(".ant-segmented-item").filter({ hasText: "Blacklist" }).click();
    await expect(customerCard(page, customer.fullName)).toContainText("Blocked");

    await customerCard(page, customer.fullName).getByRole("button", { name: /View customer profile/ }).click();
    await page.getByRole("button", { name: "Unblock customer" }).click();
    await expect(page.getByText("Customer has been unblocked")).toBeVisible();
    await page.goto("/manager/customers");
    await expect(customerCard(page, customer.fullName)).toHaveCount(1);
  });
});
