// PERSONA A — brand-new beginner user (first login on a fresh install).
// Simulates someone who has never seen the app: signs in, creates a company
// through the form, meets empty states, gets actionable errors, creates the
// first masters + first invoice with a guided sale, checks the money landed
// in Day Book / receivables, tries harmless navigation (Esc) and never
// crashes the app. The bar: confusing-but-recoverable is PASS only if there
// is an actionable message; white screens and unhandled errors FAIL.
// Prereqs: compose stack at localhost:3000 (admin/admin123).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 220)}`); }
};

const BASE = D.BASE.replace(/\/$/, "");

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  // ---- 1. first login -----------------------------------------------------
  await page.goto(`${BASE}/login`);
  ok("login page renders a form", await page.locator('input[type="password"]').isVisible().catch(() => false));

  // beginner types the wrong password first (most common first-contact error)
  const badResp = page.waitForResponse((r) => r.url().includes("/api/auth/login"), { timeout: 15000 }).catch(() => null);
  await page.fill('input[type="text"], input:not([type])', "admin");
  await page.fill('input[type="password"]', "wrong-guess-1");
  await page.keyboard.press("Enter");
  const bad = await badResp;
  ok("wrong password reaches the API (401)", !!bad && bad.status() === 401, bad?.status());
  await page.waitForSelector(".bg-red-50", { timeout: 5000 }).catch(() => {});
  const errText = await page.locator(".bg-red-50, [role=alert]").first().textContent().catch(() => "");
  ok("wrong password shows an error message", !!errText && errText.trim().length > 0, errText);
  ok("wrong password stays on /login (no crash)", page.url().includes("/login"), page.url());

  const goodResp = page.waitForResponse((r) => r.url().includes("/api/auth/login"), { timeout: 15000 }).catch(() => null);
  await page.fill('input[type="password"]', "admin123");
  await page.keyboard.press("Enter");
  const good = await goodResp;
  ok("correct password accepted by API (200)", !!good && good.status() === 200, good?.status());
  await page.waitForURL("**/companies", { timeout: 15000 });
  ok("correct password reaches companies screen", true);

  // ---- 2. create a company through the real form ---------------------------
  const stamp = Date.now().toString(36);
  const coName = `BeginnerCo ${stamp}`;
  await D.createCompany({
    name: coName, gstin: `27BEG${stamp.slice(-5).toUpperCase()}1Z5`, stateCode: "27",
    fyStart: "2026-04-01", booksBegin: "2026-04-01",
  });
  const cid = D.cid();
  ok("beginner created first company via form", !!cid, cid);
  ok("Gateway is the landing screen after create", await page.locator("text=Gateway").first().isVisible().catch(() => false));

  // ---- 3. empty states are calm and explained ------------------------------
  await page.goto(`${BASE}/company/${cid}/daybook`);
  await page.waitForSelector('input[type="date"]');
  await page.waitForTimeout(700);
  const daybookText = (await page.locator("main").textContent().catch(() => "")) || "";
  ok("Day Book empty state mentions no vouchers/explanatory text", /no voucher|no entries|no transactions/i.test(daybookText), daybookText.slice(0, 160));

  await page.goto(`${BASE}/company/${cid}/reports/trial-balance`);
  await page.waitForTimeout(900);
  const tbText = (await page.locator("main").textContent().catch(() => "")) || "";
  ok("Trial Balance renders (empty OK, no crash)", tbText.length > 0);
  const tbNumsGarbled = /NaN|undefined|Infinity/.test(tbText);
  ok("Trial Balance shows no NaN/undefined/Infinity", !tbNumsGarbled, tbText.slice(0, 120));

  // ---- 4. create first masters through the UI forms ------------------------
  // NOTE: deliberately NOT bill-wise — R-69 made the receivables report show
  // a non-bill-wise party's balance as an "On Account" bill (Tally parity);
  // before that fix this customer was invisible in receivables entirely.
  await D.createMaster("ledgers", [
    ["Name", "First Customer"],
    ["Under", { label: "Sundry Debtors" }],
  ]);
  await D.createMaster("ledgers", [
    ["Name", "Local Sales"],
    ["Under", { label: "Sales Accounts" }],
  ]);
  ok("beginner created party (non-bill-wise) + sales ledgers via forms", true);

  // duplicate name is refused with an actionable message
  let dupThrew = null;
  try {
    await D.createMaster("ledgers", [["Name", "First Customer"], ["Under", { label: "Sundry Debtors" }]]);
  } catch (e) { dupThrew = String(e?.message ?? e); }
  ok("duplicate ledger refused with visible error", !!dupThrew && /exists|already|duplicate|unique/i.test(dupThrew), dupThrew);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // ---- 5. first sale voucher through the UI --------------------------------
  await D.openVoucher("Sales");
  await D.enterVoucher({
    type: "Sales", date: "2026-04-10", narration: "first invoice ever",
    party: "First Customer",
    lines: [{ ledger: "First Customer", dr: 1180 }, { ledger: "Local Sales", cr: 1180 }],
  });
  ok("beginner saved first Sales voucher (balanced: party Dr 1180 / sales Cr 1180)", true);

  // ---- 6. the money is visible where a beginner looks ----------------------
  await page.goto(`${BASE}/company/${cid}/daybook`);
  await page.waitForTimeout(800);
  const dbText = (await page.locator("main").textContent().catch(() => "")) || "";
  ok("Day Book lists the sale", /sales/i.test(dbText) && /First Customer/i.test(dbText), dbText.slice(0, 200));

  const out = await D.getJson(`/api/c/${cid}/reports/receivables`);
  const parties = out?.parties || (Array.isArray(out) ? out : []);
  const firstCust = parties.find((r) => (r.ledgerName || r.party || r.name || "").includes("First Customer"));
  ok("Receivables shows First Customer outstanding 1180", !!firstCust && Math.round(Number(firstCust.total ?? firstCust.closing ?? firstCust.amount ?? 0)) === 1180, firstCust);
  ok("non-bill-wise party surfaces as an On Account bill (R-69, Tally parity)", !!firstCust && (firstCust.bills || []).some((b) => b.billType === "on_account" && Math.round(Number(b.amount)) === 1180), firstCust && firstCust.bills);

  // ---- 7. navigation is forgiving ------------------------------------------
  await D.openVoucher("Sales"); // open a fresh voucher
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  ok("Esc backs out of a voucher without crash", true);

  // ---- 8. unbalanced voucher is blocked, not silently saved ----------------
  await D.openVoucher("Journal");
  const jtable = page.locator("table").filter({ hasText: "Ledger" }).last();
  await D.pickAhead(jtable.locator("tbody tr").nth(0).locator("input").first(), "Local Sales");
  await jtable.locator("tbody tr").nth(0).locator('input[type="number"]').nth(0).fill("500");
  await page.keyboard.press("Control+a");
  await page.waitForTimeout(600);
  const unbalBanner = await page.locator(".bg-red-50").first().isVisible().catch(() => false);
  ok("unbalanced voucher blocked with error banner", unbalBanner);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // ---- 9. report exploration doesn't break ---------------------------------
  for (const key of ["profit-loss", "balance-sheet", "stock-summary"]) {
    await page.goto(`${BASE}/company/${cid}/reports/${key}`);
    await page.waitForTimeout(700);
    const t = (await page.locator("main").textContent().catch(() => "")) || "";
    ok(`report ${key} renders clean`, t.length > 0 && !/NaN|undefined|Infinity/.test(t), t.slice(0, 100));
  }

  ok("zero page errors across the whole beginner journey", pageErrors.length === 0, pageErrors);

  console.log(`\n== PERSONA beginner: ${pass} passed, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
