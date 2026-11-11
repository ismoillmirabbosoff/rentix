import fs from "node:fs";
import { execSync } from "node:child_process";
import { request, expect, type APIRequestContext } from "@playwright/test";
import { ADMIN_URL, API_URL, AUTH_DIR, IS_LOCAL, authFile, creds } from "./env";

export type StaffRole = "admin" | "manager";

/* ───────────────────────────── helpers ───────────────────────────── */

export const rand = (digits: number) =>
  Array.from({ length: digits }, () => Math.floor(Math.random() * 10)).join("");

const LETTERS = "ABCDEFGHJKLMNPRSTUVXYZ";
const letter = () => LETTERS[Math.floor(Math.random() * LETTERS.length)];

/** 998 90 xxxxxxx — unique per call (backend refuses re-sending OTP to a phone within 1 min). */
export const uniquePhone = () => `99890${rand(7)}`;
export const uniqueTelegramId = () => Number(`7${rand(8)}`);
export const uniqueSuffix = () => `${Date.now().toString(36)}${rand(3)}`;

/** Uzbek plate without region code, e.g. "A123BC". Region code is sent separately. */
export const uniquePlate = () => `${letter()}${rand(3)}${letter()}${letter()}`;

/** Local naive datetime string "YYYY-MM-DDTHH:mm:ss" like the frontends send. */
export const isoLocal = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
};

/** A future [start, end] window at 10:00 local time. */
export const futureRange = (startInDays: number, lengthDays = 1) => {
  const start = new Date();
  start.setDate(start.getDate() + startInDays);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + lengthDays);
  return { start, end, startIso: isoLocal(start), endIso: isoLocal(end) };
};

/**
 * Reset DRF throttle counters (login 10/min, otp + otp-verify 30/hour per IP).
 * A full run requests far more than 30 OTPs, so this is called before every
 * OTP/login burst. Only throttle keys are removed. Local docker stack only.
 */
export const flushThrottle = () => {
  if (!IS_LOCAL) return;
  try {
    execSync(
      `docker exec rentix-redis sh -c "for db in 0 1; do redis-cli -n \\$db --scan --pattern '*throttle_*' | xargs -r redis-cli -n \\$db del >/dev/null; done"`,
      { stdio: "ignore" },
    );
  } catch {
    // docker not reachable — tests will run against the throttle as-is
  }
};

/**
 * The API has no way to delete a branch (DELETE /user/filials/<id>/ → 405), so
 * test-created branches are removed straight from the DB. Local stack only.
 */
export const deleteFilialLocal = (id: number) => {
  if (!IS_LOCAL || !Number.isInteger(id)) return;
  try {
    execSync(
      `docker exec rentix-backend python manage.py shell -c "from user.models import Filial; Filial.objects.filter(id=${id}).delete()"`,
      { stdio: "ignore" },
    );
  } catch {
    /* best effort */
  }
};

/** 1x1 PNG used for every upload. */
export const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);
export const pngFile = (name = "car.png") => ({ name, mimeType: "image/png", buffer: PNG_1PX });

const jwtExp = (token: string): number => {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return Number(payload.exp) * 1000;
  } catch {
    return 0;
  }
};

/* ───────────────────────────── staff auth ───────────────────────────── */

interface StaffSession {
  access: string;
  refresh: string;
  user: { id: number | string; role: string };
}

export const staffLoginApi = async (role: StaffRole): Promise<StaffSession> => {
  const ctx = await request.newContext();
  try {
    let res = await ctx.post(`${API_URL}/user/login/`, { data: creds[role]() });
    if (res.status() === 429) {
      flushThrottle();
      res = await ctx.post(`${API_URL}/user/login/`, { data: creds[role]() });
    }
    expect(res.status(), `API login as ${role}`).toBe(200);
    const body = await res.json();
    return { access: body.access, refresh: body.refresh, user: body.user };
  } finally {
    await ctx.dispose();
  }
};

/** storageState JSON exactly as the admin app persists it (localStorage "rentix:auth"). */
export const buildStaffStorageState = (s: StaffSession) => ({
  cookies: [],
  origins: [
    {
      origin: ADMIN_URL,
      localStorage: [
        {
          name: "rentix:auth",
          value: JSON.stringify({
            user: {
              id: String(s.user.id),
              role: String(s.user.role).toUpperCase(),
              token: Buffer.from(s.access).toString("base64"),
              refresh: s.refresh ? Buffer.from(s.refresh).toString("base64") : "",
            },
            companyId: null,
          }),
        },
      ],
    },
  ],
});

const readStoredAccess = (file: string): string | null => {
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const origin of state.origins ?? []) {
      for (const item of origin.localStorage ?? []) {
        if (item.name === "rentix:auth") {
          const token = JSON.parse(item.value)?.user?.token;
          return token ? Buffer.from(token, "base64").toString("utf8") : null;
        }
      }
    }
  } catch {
    /* missing / corrupt */
  }
  return null;
};

/**
 * Path to a storageState file whose access token is valid for >5 more minutes.
 * The setup project writes it via the real login form; if the suite runs
 * longer than the 30-min access lifetime we transparently re-login via API.
 */
export const freshAuthState = async (role: StaffRole): Promise<string> => {
  const file = authFile(role);
  const access = readStoredAccess(file);
  if (access && jwtExp(access) - Date.now() > 5 * 60_000) return file;
  const session = await staffLoginApi(role);
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(buildStaffStorageState(session), null, 2));
  return file;
};

const tokenCache: Partial<Record<StaffRole, string>> = {};

export const staffToken = async (role: StaffRole): Promise<string> => {
  const cached = tokenCache[role];
  if (cached && jwtExp(cached) - Date.now() > 5 * 60_000) return cached;
  const fromFile = readStoredAccess(authFile(role));
  if (fromFile && jwtExp(fromFile) - Date.now() > 5 * 60_000) {
    tokenCache[role] = fromFile;
    return fromFile;
  }
  await freshAuthState(role);
  const t = readStoredAccess(authFile(role))!;
  tokenCache[role] = t;
  return t;
};

/* ───────────────────────────── API client ───────────────────────────── */

export class Api {
  private constructor(private ctx: APIRequestContext) {}

  static async as(token: string | null) {
    const ctx = await request.newContext({
      baseURL: `${API_URL}/`,
      extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return new Api(ctx);
  }

  static async staff(role: StaffRole) {
    return Api.as(await staffToken(role));
  }

  private path(p: string) {
    return p.replace(/^\//, "");
  }

  async get(p: string) {
    const res = await this.ctx.get(this.path(p));
    return { status: res.status(), body: await res.json().catch(() => null) };
  }

  async post(p: string, data?: unknown) {
    const res = await this.ctx.post(this.path(p), { data });
    return { status: res.status(), body: await res.json().catch(() => null) };
  }

  async postMultipart(p: string, multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>) {
    const res = await this.ctx.post(this.path(p), { multipart });
    return { status: res.status(), body: await res.json().catch(() => null) };
  }

  async patch(p: string, data?: unknown) {
    const res = await this.ctx.patch(this.path(p), { data });
    return { status: res.status(), body: await res.json().catch(() => null) };
  }

  async delete(p: string) {
    const res = await this.ctx.delete(this.path(p));
    return { status: res.status(), body: await res.json().catch(() => null) };
  }

  async dispose() {
    await this.ctx.dispose();
  }
}

/* ───────────────────────────── domain helpers ───────────────────────────── */

export interface CreatedCar {
  id: number;
  plate: string; // full plate incl. region code, e.g. 01A123BC
  brandName: string;
  modelName: string;
  costDay: number;
}

/** Creates an available Chevrolet Gentra (brand 1 / model 1) owned by the admin's company. */
export const createCarApi = async (
  overrides: Record<string, string> = {},
): Promise<CreatedCar> => {
  const api = await Api.staff("admin");
  try {
    const plate = `01${uniquePlate()}`;
    const res = await api.postMultipart("/user/create-car/", {
      brand: "1",
      model: "1",
      car_color: "white",
      fuel: "Benzin",
      status: "available",
      car_code: "01",
      car_number: plate,
      cost_day_tash: "300000",
      cost_hour_tash: "20000",
      depozit: "1000000",
      day_limit_city: "200",
      is_auto: "true",
      transmission: "false",
      conditioner: "true",
      insurance: "true",
      is_discount: "false",
      sit_number: "5",
      region_costs: JSON.stringify({ tashkentCity: 0 }),
      ...overrides,
    });
    expect(res.status, `create car: ${JSON.stringify(res.body)}`).toBe(201);
    const car = res.body.data;
    return {
      id: car.id,
      plate: car.car_number,
      brandName: car.brand_name,
      modelName: car.model_name,
      costDay: Number(car.cost_day_tash),
    };
  } finally {
    await api.dispose();
  }
};

export interface Customer {
  id: number;
  phone: string;
  fullName: string;
  telegramId: number;
  access: string;
  refresh: string;
}

/** Full OTP registration through the API (SMS_MODE=dev → code 1111). */
export const registerCustomerApi = async (fullName = `E2E Mijoz ${uniqueSuffix()}`): Promise<Customer> => {
  const api = await Api.as(null);
  try {
    const phone = uniquePhone();
    const telegramId = uniqueTelegramId();
    flushThrottle();
    let r = await api.post("/user/phone/", { phone });
    if (r.status === 429) {
      flushThrottle();
      r = await api.post("/user/phone/", { phone });
    }
    expect(r.body?.status, `OTP request: ${JSON.stringify(r.body)}`).toBe(true);
    const code = String(r.body.code ?? "1111");
    r = await api.post("/user/code/", { phone, code });
    expect(r.body?.status, `OTP verify: ${JSON.stringify(r.body)}`).toBe(true);
    r = await api.post("/user/user-register/", {
      phone,
      code,
      full_name: fullName,
      tg_nick: "",
      telegram_id: telegramId,
      company_id: "1",
    });
    expect(r.body?.status, `register: ${JSON.stringify(r.body)}`).toBe(true);
    return {
      id: Number(r.body.user.id),
      phone,
      fullName,
      telegramId,
      access: r.body.access,
      refresh: r.body.refresh,
    };
  } finally {
    await api.dispose();
  }
};

export const createOrderAsCustomer = async (
  customer: Customer,
  carId: number,
  range = futureRange(2),
  extra: Record<string, unknown> = {},
) => {
  const api = await Api.as(customer.access);
  try {
    const res = await api.post("/user/create-order/", {
      car: carId,
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
      ...extra,
    });
    expect([200, 201], `create order: ${JSON.stringify(res.body)}`).toContain(res.status);
    return res.body.data ?? res.body;
  } finally {
    await api.dispose();
  }
};

export const setOrderStatusApi = async (orderId: number, status: string) => {
  const api = await Api.staff("manager");
  try {
    const res = await api.patch(`/user/order/${orderId}/set-status/`, { status });
    expect(res.status, `set-status ${status}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
    return res.body;
  } finally {
    await api.dispose();
  }
};

export const getOrderApi = async (orderId: number, role: StaffRole = "manager") => {
  const api = await Api.staff(role);
  try {
    const res = await api.get(`/user/order/${orderId}/`);
    return res.body;
  } finally {
    await api.dispose();
  }
};

/** "998901234567" → "+998 (90) 123 45 67" (format used by the admin app). */
export const displayPhone = (phone: string) =>
  `+${phone.slice(0, 3)} (${phone.slice(3, 5)}) ${phone.slice(5, 8)} ${phone.slice(8, 10)} ${phone.slice(10, 12)}`;
