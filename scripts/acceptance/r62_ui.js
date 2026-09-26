// R-62 browser acceptance: Gateway ordering + shortcut-class voucher order +
// Alt+S. Operator-specified arrangement:
// 1) headings read Create, Alter, Vouchers, Day Book, Reports, Utilities,
//    Company Settings;
// 2) the Vouchers pane is ordered by shortcut class — plain F-keys first
//    (F4…F10), then the Alt+ chords (Alt+F5…Alt+F9), then Ctrl+ (Ctrl+F7),
//    keyless Payroll last — the same rule the Day Book rail already uses;
// 3) Company Settings advertises Alt+S on its chip and the chord fires from
//    the Gateway, Day Book, and a report (every screen, Tally's Stock-Query
//    chord — unused in zprime before R-62); plain S still fires Sales
//    Register (no collision), and the palette advertises the chord;
// 4) single-letter chips keep the standard box — the Day Book K chip is NOT
//    wider than the Create C chip (only chord chips like Alt+S stretch).
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

  // ---- 1) heading order: Create, Alter, Vouchers, Day Book, ... ----
  await gateway();
  const headings = await page.locator(".grid > div:nth-child(2) .fkey-item .flex-1").allTextContents();
  const names = headings.map((t) => t.trim());
  ok("all seven headings present in the operator-specified order",
    JSON.stringify(names) === JSON.stringify(["Create", "Alter", "Vouchers", "Day Book", "Reports", "Utilities", "Company Settings"]),
    names);

  // ---- 2) Vouchers pane: shortcut-class order (F-keys, Alt+, Ctrl+) ----
  await gateway();
  await page.keyboard.press("V");
  await D.sleep(350);
  const items = (await pane().locator("a .flex-1").allTextContents()).map((t) => t.trim());
  ok("plain F-keys first, in numeric order",
    JSON.stringify(items.slice(0, 7)) === JSON.stringify(["Contra", "Payment", "Receipt", "Journal", "Sales", "Purchase", "Manufacturing Journal"]), items);
  ok("then the Alt+ chords in numeric order",
    JSON.stringify(items.slice(7, 12)) === JSON.stringify(["Debit Note", "Credit Note", "Stock Journal", "Delivery Note", "Receipt Note"]), items.slice(7));
  ok("then Ctrl+ chords, keyless Payroll last", items[12] === "Physical Stock" && items[items.length - 1] === "Process Payroll", items.slice(12));
  // R-73: the seeded vocabulary grows by the order pair (Sale Order, Purchase
  // Order — keyless, reachable via Gateway/Day Book/palette). 15 types + Payroll.
  ok("every seeded type still listed (15 types incl. the R-73 order pair + Payroll)", items.length === 16, items.length);

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

  // ---- 4) single-letter chips keep the standard box (K not stretched) ----
  await gateway();
  const chipW = async (label) =>
    (await page.locator(`.fkey-item:has-text("${label}") .fkey-chip`).first().boundingBox())?.width ?? 0;
  const kWidth = await chipW("Day Book");
  const cWidth = await chipW("Create");
  const altSWidth = await chipW("Company Settings");
  ok("Day Book K chip same width as Create C chip (standard letter box)", Math.abs(kWidth - cWidth) <= 1, { kWidth, cWidth });
  ok("chord chip (Alt+S) is the only widened one", altSWidth > kWidth + 4, { altSWidth, kWidth });

  ok("no page errors during R-62 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-62 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
