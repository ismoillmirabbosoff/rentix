#!/usr/bin/env node
/*
 * i18n consistency check for rentix-admin and rentix-user.
 *
 *   node rentix-deploy/e2e/i18n-check.cjs            (from the monorepo root)
 *
 * Checks, per app:
 *   1. uz/ru/en have the same key set (plural suffixes _zero/_one/_two/_few/_many/_other
 *      are folded into the base key, so "x_one/x_other" (en) == "x_one/x_few/x_many" (ru)).
 *   2. no Cyrillic letters in uz/en values (language self-names such as "Русский" allowed);
 *   3. no Latin words in ru values except brand names / units / abbreviations (ALLOWED_LATIN);
 *   4. the {{placeholders}} are identical across uz/ru/en for every key.
 * Exit code 1 when any check fails.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const ts = require(path.join(ROOT, "rentix-admin/node_modules/typescript"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-check-"));
fs.writeFileSync(path.join(tmp, "package.json"), '{"type":"commonjs"}');

function load(srcRoot, files) {
  const outDir = path.join(tmp, path.basename(srcRoot) + "-" + Math.random().toString(36).slice(2));
  for (const rel of files) {
    const src = fs.readFileSync(path.join(srcRoot, rel), "utf8");
    const out = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const dest = path.join(outDir, rel.replace(/\.ts$/, ".js"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out);
  }
  return (rel) => require(path.join(outDir, rel.replace(/\.ts$/, ".js")));
}

function deepMerge(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object") deepMerge(a[k], v);
    else a[k] = v && typeof v === "object" ? deepMerge(Array.isArray(v) ? [] : {}, v) : v;
  }
  return a;
}

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}

// ---- load admin ----
function loadAdmin() {
  const base = path.join(ROOT, "rentix-admin/src/shared/lib/i18n/translations");
  const parts = ["commonGuest", "nav", "manager", "adminPack", "carPromo", "managerBot", "rentalOps"];
  const files = [];
  for (const l of ["uz", "ru", "en"]) for (const p of parts) files.push(`${l}/${p}.ts`);
  const req = load(base, files);
  const res = {};
  for (const l of ["uz", "ru", "en"]) {
    res[l] = {};
    for (const p of parts) {
      const mod = req(`${l}/${p}.ts`);
      const name = p + l[0].toUpperCase() + l[1];
      deepMerge(res[l], mod[name]);
    }
  }
  return res;
}

function loadUser() {
  const base = path.join(ROOT, "rentix-user/src/shared/config/i18n");
  const req = load(base, ["resources.ts", "locales/uz.ts", "locales/ru.ts", "locales/en.ts"]);
  const { resources } = req("resources.ts");
  return { uz: resources.uz.translation, ru: resources.ru.translation, en: resources.en.translation };
}

const PLURAL = /_(zero|one|two|few|many|other)$/;
const CYR = /[Ѐ-ӿ]/;
// Brand names, units and abbreviations allowed as Latin in RU.
const ALLOWED_LATIN = new Set(
  [
    "Rentix", "Telegram", "VIP", "ID", "SMS", "Payme", "Click", "Uzum", "USD", "EUR", "UZS",
    "Visa", "Mastercard", "Humo", "Uzcard", "Google", "Apple", "Android", "iOS", "PDF", "JPG",
    "JPEG", "PNG", "WEBP", "MB", "KB", "Wi", "Fi", "GPS", "URL", "API", "OK", "PINFL", "JSHSHIR",
    "Merchant", "Chevrolet", "Cobalt", "Malibu", "Tracker", "Gentra", "Spark", "Nexia", "Damas",
    "Captiva", "Equinox", "Tahoe", "Onix", "BYD", "Kia", "Hyundai", "Toyota", "Mercedes", "BMW",
    "Lacetti", "Monza", "CVC", "P2P", "P", "UZ", "RU", "EN", "Start", "Secret", "Key", "AAA", "Kaptiva", "AI", "kW", "km", "h", "x", "Bot", "bot", "WebApp", "Mini",
    "App", "rentixuz_bot", "AA", "A", "B", "C", "D", "E", "BE", "CE", "DE", "Ups", "Opps",
  ].map((s) => s.toLowerCase()),
);
// Values in uz/en that may legitimately contain Cyrillic (language self-names).
const CYR_OK = new Set(["Русский", "Ўзбекча"]);
// Values in ru that may legitimately be Latin (language self-names in the language picker).
const LATIN_OK = new Set(["O'zbekcha", "English"]);

function check(appName, res) {
  const problems = [];
  const flat = {};
  for (const l of ["uz", "ru", "en"]) flat[l] = flatten(res[l]);
  const baseSets = {};
  for (const l of ["uz", "ru", "en"]) baseSets[l] = new Set(Object.keys(flat[l]).map((k) => k.replace(PLURAL, "")));

  // 1. key sets
  const all = new Set([...baseSets.uz, ...baseSets.ru, ...baseSets.en]);
  for (const k of [...all].sort()) {
    const missing = ["uz", "ru", "en"].filter((l) => !baseSets[l].has(k));
    if (missing.length) problems.push(`[keys] ${k}: missing in ${missing.join(",")}`);
  }
  // plural completeness: en needs one+other, ru needs one+few+many when pluralised
  for (const k of [...all]) {
    for (const [l, need] of [["en", ["one", "other"]], ["ru", ["one", "few", "many"]], ["uz", ["one", "other"]]]) {
      const forms = Object.keys(flat[l]).filter((x) => x.replace(PLURAL, "") === k && PLURAL.test(x));
      if (!forms.length) continue;
      const got = forms.map((x) => x.match(PLURAL)[1]);
      const lack = need.filter((n) => !got.includes(n));
      if (lack.length) problems.push(`[plural] ${l} ${k}: missing _${lack.join(", _")}`);
    }
  }
  // 2. Cyrillic in uz/en
  for (const l of ["uz", "en"]) {
    for (const [k, v] of Object.entries(flat[l])) {
      if (CYR_OK.has(v.trim())) continue;
      if (CYR.test(v)) problems.push(`[cyrillic] ${l} ${k}: ${JSON.stringify(v)}`);
    }
  }
  // 3. Latin words in ru
  for (const [k, v] of Object.entries(flat.ru)) {
    if (LATIN_OK.has(v.trim())) continue;
    const stripped = v.replace(/\{\{[^}]*\}\}/g, " ").replace(/<\/?\d+>/g, " ");
    const words = stripped.match(/[A-Za-z][A-Za-z'’]*/g) || [];
    const bad = words.filter((w) => !ALLOWED_LATIN.has(w.toLowerCase()));
    if (bad.length) problems.push(`[latin-in-ru] ${k}: ${JSON.stringify(v)} -> ${bad.join(", ")}`);
  }
  // 4. placeholders
  const vars = (s) => [...new Set((s.match(/\{\{\s*([^},\s]+)[^}]*\}\}/g) || []).map((m) => m.replace(/\{\{\s*([^},\s]+).*$/, "$1")))].sort().join(",");
  for (const k of [...all]) {
    const per = {};
    for (const l of ["uz", "ru", "en"]) {
      const forms = Object.keys(flat[l]).filter((x) => x === k || x.replace(PLURAL, "") === k);
      // union over plural forms ("{{count}}" may be dropped in the _one form, e.g. "one day")
      const set = new Set();
      for (const f of forms) for (const v of vars(flat[l][f]).split(",").filter(Boolean)) set.add(v);
      per[l] = [...set].sort().join(",");
    }
    if (per.uz !== per.ru || per.uz !== per.en)
      problems.push(`[vars] ${k}: uz{${per.uz}} ru{${per.ru}} en{${per.en}}`);
  }

  const counts = Object.fromEntries(["uz", "ru", "en"].map((l) => [l, Object.keys(flat[l]).length]));
  console.log(`\n=== ${appName}: keys uz=${counts.uz} ru=${counts.ru} en=${counts.en}`);
  const byType = {};
  for (const p of problems) byType[p.match(/^\[(.*?)\]/)[1]] = (byType[p.match(/^\[(.*?)\]/)[1]] || 0) + 1;
  for (const t of ["keys", "plural", "cyrillic", "latin-in-ru", "vars"])
    console.log(`  ${t.padEnd(12)} ${byType[t] ? byType[t] + " problem(s)" : "OK"}`);
  for (const p of problems) console.log("   " + p);
  return problems.length;
}

if (require.main === module) {
  let fails = 0;
  fails += check("rentix-admin", loadAdmin());
  fails += check("rentix-user", loadUser());
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? `\nFAILED: ${fails} problem(s)` : "\nALL CHECKS PASSED");
  process.exit(fails ? 1 : 0);
}
module.exports = { loadAdmin, loadUser, flatten };
