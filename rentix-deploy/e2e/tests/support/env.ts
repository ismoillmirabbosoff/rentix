import fs from "node:fs";
import path from "node:path";

// Load ../.env.e2e (written by run-local.sh) without overriding real env vars.
const envFile = path.resolve(__dirname, "../../.env.e2e");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const strip = (u: string) => u.replace(/\/+$/, "");

export const USER_URL = strip(process.env.USER_URL || "http://127.0.0.1:18031");
export const ADMIN_URL = strip(process.env.ADMIN_URL || "http://127.0.0.1:18032");
/** Both frontends proxy /api/* to the backend (nginx strips /api). */
export const API_URL = `${ADMIN_URL}/api`;

/** True when running against the local docker stack (enables redis flush etc). */
export const IS_LOCAL = /127\.0\.0\.1|localhost/.test(ADMIN_URL);

const required = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} (see rentix-deploy/e2e/.env.e2e)`);
  return v;
};

export const creds = {
  admin: () => ({ login: required("RENTIX_ADMIN_LOGIN"), password: required("RENTIX_ADMIN_PASSWORD") }),
  manager: () => ({ login: required("RENTIX_MANAGER_LOGIN"), password: required("RENTIX_MANAGER_PASSWORD") }),
};

export const AUTH_DIR = path.resolve(__dirname, "../../.auth");
export const authFile = (role: "admin" | "manager") => path.join(AUTH_DIR, `${role}.json`);
