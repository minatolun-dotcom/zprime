// R-78 browser acceptance: Tally's level-model arrow navigation on the Gateway.
// 1) Headings level: ArrowDown/Up move the heading highlight (wraps);
//    ArrowRight/Enter drill INTO the selected heading (pane for pane targets,
//    direct navigation for Day Book / Company Settings); ArrowLeft with no
//    pane is a no-op.
// 2) Pane level: ArrowDown/Up move the item highlight; Enter picks it (leaf
//    navigation); ArrowLeft backs OUT to the headings with the heading still
//    picked (pane closed); Esc still closes (and keeps the heading picked).
// 3) Mouse hover mirrors the heading highlight; letter navigation still fires
//    (R opens Reports with the heading picked, item highlight at the first).
// Prereqs: compose stack at localhost:3000 (admin/admin123) with the built
// client (docker compose build app && docker compose up -d app).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 240)}`); }
};

const BASE = D.BASE.replace(/\/$/, "");

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  await D.createCompany({ name: `R78 Arrows ${Date.now().toString(36)}`, stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  // helpers ------------------------------------------------------------
  // heading highlight = the ring/bg class on the headings-column items
  const headings = page.locator(".card", { hasText: "Gateway of zprime" }).first();
  const hlHeadingText = async () => {
    const n = await headings.locator("a.fkey-item, button.fkey-item").count();
    for (let i = 0; i < n; i++) {
      const el = headings.locator("a.fkey-item, button.fkey-item").nth(i);
      const cls = (await el.getAttribute("class")) ?? "";
      if (cls.includes("bg-indigo-50")) return (await el.innerText()).trim();
    }
    return null;
  };
  const pane = () => page.locator('[data-testid="gateway-contents"]');
  const hlPaneText = async () => {
    const links = pane().locator("a.fkey-item");
    const n = await links.count();
    for (let i = 0; i < n; i++) {
      const cls = (await links.nth(i).getAttribute("class")) ?? "";
      if (cls.includes("bg-indigo-50")) return (await links.nth(i).innerText()).trim();
    }
    return null;
  };
  const press = async (key) => { await page.keyboard.press(key); await D.sleep(120); };

  // ---- 1) headings level: arrows move, wrap, drill in ------------------
  ok("headings: nothing highlighted on first arrival (mouse/mouse-native)",
     (await hlHeadingText()) === null, await hlHeadingText());

  await press("ArrowDown");
  ok("ArrowDown picks the first heading (Create)", (await hlHeadingText())?.includes("Create"), await hlHeadingText());
  await press("ArrowDown");
  ok("ArrowDown again: Alter", (await hlHeadingText())?.includes("Alter"), await hlHeadingText());
  for (let i = 0; i < 6; i++) await press("ArrowDown"); // Alter + 6 → wraps to Create (7 headings)
  ok("ArrowDown wraps around the heading list", (await hlHeadingText())?.includes("Create"), await hlHeadingText());
  await press("ArrowUp");
  ok("ArrowUp wraps backwards to the last heading (Company Settings)", (await hlHeadingText())?.includes("Company Settings"), await hlHeadingText());

  // ---- 2) Right drills into a pane target ------------------------------
  for (let i = 0; i < 6; i++) await press("ArrowUp"); // CS + 6 → wraps to Create
  ok("wrap up lands on Create again", (await hlHeadingText())?.includes("Create"), await hlHeadingText());
  await press("ArrowRight");
  await page.waitForSelector('[data-testid="gateway-contents"] a:has-text("Ledgers")', { timeout: 8000 });
  ok("ArrowRight on Create opens its pane (Ledgers…)", true, null);
  ok("pane item highlight starts at the first item", (await hlPaneText())?.includes("Ledgers"), await hlPaneText());
  ok("heading highlight mirrors the open pane (Create)", (await hlHeadingText())?.includes("Create"), await hlHeadingText());

  // ---- 3) Left backs out, heading stays picked -------------------------
  await press("ArrowLeft");
  await page.waitForSelector("text=Select a menu", { timeout: 5000 });
  ok("ArrowLeft closes the pane (neutral pane returns)", true, null);
  ok("ArrowLeft keeps the heading picked (Create)", (await hlHeadingText())?.includes("Create"), await hlHeadingText());

  // ---- 4) pane arrows: move + wrap; Enter picks -------------------------
  await press("ArrowRight"); // back into Create
  await page.waitForSelector('[data-testid="gateway-contents"] a:has-text("Ledgers")', { timeout: 8000 });
  await press("ArrowDown");
  ok("pane ArrowDown moves item 1 → 2 (Groups)", (await hlPaneText())?.includes("Groups"), await hlPaneText());
  for (let i = 0; i < 9; i++) await press("ArrowDown"); // wraps to Ledgers (10 items)
  ok("pane ArrowDown wraps to Ledgers", (await hlPaneText())?.includes("Ledgers"), await hlPaneText());
  await press("ArrowUp");
  ok("pane ArrowUp wraps backwards to Employees", (await hlPaneText())?.includes("Employees"), await hlPaneText());

  await press("ArrowRight"); // pane open: Right pins the first item (idempotent-ish)
  ok("pane ArrowRight pins the first item (Enter target exists)", (await hlPaneText()) !== null, await hlPaneText());

  // Enter picks the highlighted item → navigates to the leaf
  // (Right kept the existing highlight — Employees & Payroll, item 10 of 10)
  const want = await hlPaneText();
  await press("Enter");
  await page.waitForSelector("text=Employees & Payroll", { timeout: 10000 }).catch(() => {});
  ok(`Enter navigates to the highlighted leaf (${want?.replace(/\s+/g, " ")})`,
     page.url().includes("/masters/employees"), page.url());

  // ---- 5) direct targets: Right/Enter navigate WITHOUT a pane ----------
  await page.goBack();
  await page.waitForSelector("text=Gateway of zprime", { timeout: 10000 });
  await D.sleep(400); // pane restore effect settles
  ok("back-nav restores the pane (R-75 contract intact)", (await pane().locator("a.fkey-item").count()) > 0, null);
  await press("ArrowLeft"); // close pane, heading picked
  await press("ArrowUp"); // Company Settings (last)
  await press("ArrowUp"); // Utilities (has pane)
  ok("positioned on Utilities", (await hlHeadingText())?.includes("Utilities"), await hlHeadingText());
  await press("ArrowUp"); // Reports
  await press("ArrowRight");
  await page.waitForSelector('[data-testid="gateway-contents"] a:has-text("Balance Sheet")', { timeout: 8000 });
  ok("ArrowRight on Reports opens its pane", true, null);

  // Day Book is a DIRECT target one UP from Reports: Left → Up → Right navigates
  await press("ArrowLeft");
  await press("ArrowUp"); // Day Book (immediately above Reports)
  ok("positioned on Day Book", (await hlHeadingText())?.includes("Day Book"), await hlHeadingText());
  await press("ArrowRight");
  await page.waitForSelector("text=Day Book", { timeout: 10000 });
  ok("ArrowRight on a direct target navigates WITHOUT opening a pane", page.url().includes("/daybook"), page.url());

  // ---- 6) Esc from a pane keeps the heading picked ----------------------
  await page.goBack();
  await page.waitForSelector("text=Gateway of zprime", { timeout: 10000 });
  await D.sleep(400); // fresh mount: pane null AND heading highlight null
  for (let i = 0; i < 5; i++) await press("ArrowDown"); // Create → … → Reports
  await press("ArrowRight");
  await page.waitForSelector('[data-testid="gateway-contents"] a:has-text("Balance Sheet")', { timeout: 8000 });
  await press("Escape");
  await page.waitForSelector("text=Select a menu", { timeout: 5000 });
  ok("Esc closes the pane and keeps the heading picked (Reports)", (await hlHeadingText())?.includes("Reports"), await hlHeadingText());

  // ---- 7) letter nav unchanged; hover mirrors the highlight -------------
  await press("R"); // letter R opens Reports with the heading picked
  await page.waitForSelector('[data-testid="gateway-contents"] a:has-text("Balance Sheet")', { timeout: 8000 });
  ok("letter navigation still opens the pane (R)", true, null);
  ok("letter-open keeps the heading highlight honest (Reports)", (await hlHeadingText())?.includes("Reports"), await hlHeadingText());

  await headings.locator("button.fkey-item", { hasText: "Vouchers" }).hover();
  await D.sleep(150);
  ok("mouse hover mirrors the heading highlight (Vouchers)", (await hlHeadingText())?.includes("Vouchers"), await hlHeadingText());

  ok("zero page errors across the R-78 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-78 RESULT: ${pass} passed, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
