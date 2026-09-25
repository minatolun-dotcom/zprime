// R-62 browser acceptance: Gateway ordering + common vouchers first + Alt+S.
// 1) headings in workflow order: Day Book first, then Vouchers, Create,
//    Alter, Reports, Utilities, Company Settings;
// 2) the Vouchers pane floats the COMMON types to the top (Payment, Receipt,
//    Sales, Purchase — ahead of Contra/Journal and the notes), Payroll last;
// 3) Company Settings advertises Alt+S on its chip and the chord fires from
//    the Gateway, Day Book, and a report (every screen, Tally's Stock-Query
//    chord — unused in zprime before R-62); plain S still fires Sales
//    Register (no collision), and the palette advertises the chord.
// Prereqs: fresh-ish compose stack at localhost:3000 (admin/admin123) with
// the built client.
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 200)}`); }
};

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  await D.createCompany({ name: `R62 Order ${Date.now().toString(36)}`, gstin: "27R62ORDER9K4", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);
  const gw = `${D.BASE}/company/${cid}`;
  const gateway = async () => {
    await page.goto(gw, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=Gateway of zprime", { timeout: 15000 });
    await D.sleep(250);
  };
  const pane = () => page.locator('[data-testid="gateway-contents"]');

  // ---- 1) heading order: Day Book first, Vouchers second ----
  await gateway();
  const headings = await page.locator(".grid > div:nth-child(2) .fkey-item .flex-1").allTextContents();
  const names = headings.map((t) => t.trim());
  ok("Day Book is the first Gateway heading (R-62 workflow order)", names[0] === "Day Book", names);
  ok("Vouchers is the second heading", names[1] === "Vouchers", names);
  ok("Company Settings is still last", names[names.length - 1] === "Company Settings", names);
  ok("all seven headings present in order",
    JSON.stringify(names) === JSON.stringify(["Day Book", "Vouchers", "Create", "Alter", "Reports", "Utilities", "Company Settings"]),
    names);

  // ---- 2) Vouchers pane: common types first ----
  await gateway();
  await page.keyboard.press("V");
  await D.sleep(350);
  const items = (await pane().locator("a .flex-1").allTextContents()).map((t) => t.trim());
  ok("Vouchers pane opens with the common four on top",
    JSON.stringify(items.slice(0, 4)) === JSON.stringify(["Payment", "Receipt", "Sales", "Purchase"]), items.slice(0, 6));
  ok("Contra and Journal now follow the common four", items[4] === "Contra" && items[5] === "Journal", items.slice(4, 6));
  ok("Process Payroll is last", items[items.length - 1] === "Process Payroll", items.slice(-2));
  ok("every seeded type still listed (13 types + Payroll)", items.length === 14, items.length);

  // ---- 3) Company Settings = Alt+S ----
  await gateway();
  const settingsChip = await page.locator('a:has-text("Company Settings") .fkey-chip').first().textContent();
  ok("Company Settings chip advertises Alt+S", settingsChip?.trim() === "Alt+S", settingsChip);

  await page.keyboard.press("Alt+s");
  await page.waitForURL("**/settings", { timeout: 8000 });
  ok("Alt+S from the Gateway opens Company Settings", page.url().includes("/settings"), page.url());

  await page.goto(`${D.BASE}/company/${cid}/daybook`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="date"]', { timeout: 10000 });
  await page.keyboard.press("Alt+s");
  await page.waitForURL("**/settings", { timeout: 8000 });
  ok("Alt+S from the Day Book opens Company Settings (every screen)", page.url().includes("/settings"), page.url());

  await page.goto(`${D.BASE}/company/${cid}/reports/trial-balance`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="date"]', { timeout: 10000 });
  await page.keyboard.press("Alt+s");
  await page.waitForURL("**/settings", { timeout: 8000 });
  ok("Alt+S from a report opens Company Settings", page.url().includes("/settings"), page.url());

  // plain S is untouched (Sales Register) — no collision with the chord
  await gateway();
  await page.keyboard.press("s");
  await page.waitForURL("**/reports/register-sales", { timeout: 8000 });
  ok("plain S still fires Sales Register (chord needs Alt)", page.url().includes("register-sales"), page.url());

  // palette advertises the chord
  await gateway();
  await page.keyboard.press("Alt+g");
  await D.sleep(350);
  await page.fill('[data-testid="goto-input"]', "company sett");
  await D.sleep(400);
  const row = page.locator('[data-testid="goto-results"] li').filter({ hasText: "Company Settings" }).first();
  ok("Go To palette advertises Alt+S for Company Settings", (await row.textContent().catch(() => ""))?.includes("Alt+S") ?? false);
  await page.keyboard.press("Escape");

  ok("no page errors during R-62 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-62 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
