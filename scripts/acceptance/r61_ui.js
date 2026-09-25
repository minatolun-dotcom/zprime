// R-61 browser acceptance: the Tally-sectioned Gateway (Option C) through the
// REAL UI. TallyHelp: "Gateway of Tally is organised into Masters, Vouchers,
// Utilities, and Reports."
//  A) layout: four section headers in order; Utilities items + headline
//     reports visible at level 1 (Tally's seamlessness); report tail hidden
//     until "Display More Reports"; Company Settings still last;
//  B) the expander: click shows the tail IN PLACE (9 items, letters
//     unchanged), keyboard "5" fires Receivables from it, Esc collapses;
//  C) R-61 letter discipline: the freed heading letters R and U fire NOTHING
//     (never reassigned — R-53c arithmetic preserved);
//  D) muscle memory: every pre-R-61 letter still fires the same target from
//     the bare Gateway (X/J/Z/B/F/T/H/S/P/M/K + V-pane W);
//  E) panes survive where Tally has them: V (Vouchers), C/A (masters);
//     promoted letters still fire from inside a pane (global fallback);
//  F) the Alt+G palette follows the new sections (Utilities / Reports);
//  G) zero page errors.
// Prereqs: fresh-ish compose stack at localhost:3000 (admin/admin123) with
// the built client (docker compose build app && docker compose up -d app).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 160)}`); }
};

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  const coName = `R61 GW ${Date.now().toString(36)}`;
  await D.createCompany({ name: coName, gstin: "27R61GWUI0A1B2", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);
  const gw = `${D.BASE}/company/${cid}`;

  const gateway = async () => {
    await page.goto(gw, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=Gateway of zprime", { timeout: 15000 });
    await D.sleep(250);
  };
  const pane = () => page.locator('[data-testid="gateway-contents"]');
  const paneHead = async () =>
    (await pane().locator(".text-indigo-600").first().textContent().catch(() => ""))?.trim() ?? "";

  // ================= A) sectioned layout =================
  await gateway();
  const headers = await page.locator('[data-testid="gateway-section-header"]').allTextContents();
  ok("four Tally section headers render", headers.map((h) => h.trim().toLowerCase()).join("|") === "masters|transactions|utilities|reports", headers);
  ok("Masters header present", await page.locator('[data-testid="gateway-section-header"]:has-text("Masters")').isVisible().catch(() => false));
  ok("Transactions header present", await page.locator('[data-testid="gateway-section-header"]:has-text("Transactions")').isVisible().catch(() => false));
  ok("Utilities header present", await page.locator('[data-testid="gateway-section-header"]:has-text("Utilities")').isVisible().catch(() => false));
  ok("Reports header present", await page.locator('[data-testid="gateway-section-header"]:has-text("Reports")').isVisible().catch(() => false));

  // Utilities promoted to level 1 — visible with NO keypress (R-61 seamlessness)
  ok("XML Import visible at level 1 (no drill)", await page.locator('a:has-text("XML Import")').first().isVisible().catch(() => false));
  ok("Cheque Printing visible at level 1", await page.locator('a:has-text("Cheque Printing")').first().isVisible().catch(() => false));
  ok("Audit Trail visible at level 1", await page.locator('a:has-text("Audit Trail")').first().isVisible().catch(() => false));

  // Headline reports at level 1
  ok("Balance Sheet visible at level 1", await page.locator('a:has-text("Balance Sheet")').first().isVisible().catch(() => false));
  ok("Trial Balance visible at level 1", await page.locator('a:has-text("Trial Balance")').first().isVisible().catch(() => false));
  ok("Sales Register visible at level 1", await page.locator('a:has-text("Sales Register")').first().isVisible().catch(() => false));

  // Tail hidden until expanded; expander present; Settings still last
  ok("report tail hidden at rest (no GSTR-9)", !(await page.locator('a:has-text("GSTR-9 (Annual)")').first().isVisible().catch(() => false)));
  ok("Display More Reports expander present", await page.locator('[data-testid="gateway-more-toggle"]').isVisible().catch(() => false));
  ok("Company Settings still level 1 (letterless ·)", await page.locator('a:has-text("Company Settings")').first().isVisible().catch(() => false));

  // ================= B) Display More Reports =================
  await page.locator('[data-testid="gateway-more-toggle"]').click();
  await page.locator('[data-testid="gateway-more-expanded"]').waitFor({ state: "visible", timeout: 5000 });
  ok("expander reveals the tail in place", await page.locator('[data-testid="gateway-more-expanded"]').isVisible().catch(() => false));
  const tailOk = [];
  for (const t of ["Receivables (B/R)", "Payables (B/P)", "GSTR-1", "GSTR-3B", "GSTR-9 (Annual)", "TDS Report", "TCS Report", "Salary Register", "Cheque Register"]) {
    if (!(await page.locator(`[data-testid="gateway-more-expanded"] a:has-text("${t}")`).isVisible().catch(() => false))) tailOk.push(t);
  }
  ok("all 9 tail reports visible with letters unchanged", tailOk.length === 0, tailOk);
  await page.keyboard.press("5");
  await page.waitForURL("**/reports/receivables", { timeout: 8000 });
  ok("keyboard 5 fires Receivables from the expanded tail", page.url().includes("/reports/receivables"), page.url());

  await gateway();
  await page.locator('[data-testid="gateway-more-toggle"]').click();
  await page.locator('[data-testid="gateway-more-expanded"]').waitFor({ state: "visible", timeout: 5000 });
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="gateway-more-expanded"]').waitFor({ state: "detached", timeout: 5000 });
  ok("Esc collapses the expansion (stays on Gateway)", page.url().endsWith(`/company/${cid}`), page.url());
  ok("Esc reveals the neutral hint pane", await page.locator("text=Select a menu").isVisible().catch(() => false));

  // ================= C) freed letters R and U fire NOTHING =================
  await gateway();
  await page.keyboard.press("R");
  await D.sleep(400);
  ok("freed letter R does nothing (heading letter retired, never reassigned)", page.url().endsWith(`/company/${cid}`), page.url());
  await page.keyboard.press("U");
  await D.sleep(400);
  ok("freed letter U does nothing", page.url().endsWith(`/company/${cid}`), page.url());

  // ================= D) muscle memory: every pre-R-61 letter unchanged =====
  const memory = [
    ["X", "/import", "X fires XML Import from anywhere"],
    ["J", "/cheques", "J fires Cheque Printing from anywhere"],
    ["Z", "/audit", "Z fires Audit Trail from anywhere"],
    ["B", "balance-sheet", "B fires Balance Sheet (was inside R pane)"],
    ["F", "profit-loss", "F fires Profit & Loss"],
    ["T", "trial-balance", "T fires Trial Balance (R-then-T flow now one key)"],
    ["H", "cash-bank", "H fires Cash / Bank Book"],
    ["S", "register-sales", "S fires Sales Register"],
    ["P", "register-purchase", "P fires Purchase Register"],
    ["M", "stock-summary", "M fires Stock Summary"],
    ["K", "/daybook", "K fires Day Book from anywhere"],
  ];
  for (const [k, frag, name] of memory) {
    await gateway();
    await page.keyboard.press(k);
    await page.waitForURL(`**/${frag.replace(/^\//, "")}**`, { timeout: 8000 }).catch(() => {});
    await D.sleep(150);
    ok(name, page.url().includes(frag), page.url());
  }

  // ================= E) panes survive where Tally has them =================
  await gateway();
  await page.keyboard.press("V");
  await D.sleep(300);
  ok("V opens the Vouchers pane", (await paneHead()) === "Vouchers", await paneHead());
  await page.keyboard.press("W");
  await page.waitForURL("**/payroll", { timeout: 8000 });
  ok("W fires Process Payroll from inside the V pane", page.url().includes("/payroll"), page.url());

  await gateway();
  await page.keyboard.press("C");
  await D.sleep(300);
  ok("C opens the Create pane (masters)", (await paneHead()) === "Create", await paneHead());
  await page.keyboard.press("B");
  await page.waitForURL("**/balance-sheet**", { timeout: 8000 });
  ok("promoted B still fires from inside the Create pane (fallback)", page.url().includes("balance-sheet"), page.url());

  await gateway();
  await page.keyboard.press("A");
  await D.sleep(300);
  ok("A opens the Alter pane (masters)", (await paneHead()) === "Alter", await paneHead());
  await page.keyboard.press("Escape");
  await D.sleep(250);
  ok("Esc closes the pane to the hint", await page.locator("text=Select a menu").isVisible().catch(() => false));

  // ================= F) Alt+G palette follows the new sections =================
  await gateway();
  await page.keyboard.press("Alt+g");
  await D.sleep(350);
  await page.fill('[data-testid="goto-input"]', "xml");
  await D.sleep(400);
  const xmlRow = page.locator('[data-testid="goto-results"] li').filter({ hasText: "XML Import" }).first();
  ok("palette finds XML Import under Utilities", (await xmlRow.textContent().catch(() => ""))?.includes("Utilities") ?? false);
  await page.fill('[data-testid="goto-input"]', "gstr-9");
  await D.sleep(400);
  const g9Row = page.locator('[data-testid="goto-results"] li').filter({ hasText: "GSTR-9" }).first();
  ok("palette finds GSTR-9 under Reports (expander state irrelevant)", (await g9Row.textContent().catch(() => ""))?.includes("Reports") ?? false);
  await page.keyboard.press("Escape");
  await D.sleep(250);

  // ================= G) settings + errors =================
  await gateway();
  await page.locator('a:has-text("Company Settings")').first().click();
  await page.waitForURL("**/settings", { timeout: 8000 });
  ok("Company Settings click opens Settings (one click, unchanged)", page.url().includes("/settings"), page.url());

  ok("no page errors during R-61 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-61 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
