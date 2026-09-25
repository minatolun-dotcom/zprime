// R-63 browser acceptance: the Chart of Accounts explorer (Tally's COA view).
//  A) the tree renders ALL groups and ALL ledgers (zero-activity included) in
//     one view, expanded one level deep;
//  B) node rows show the ledger's Closing balance (dash-blank when nil) and
//     group rows roll up their subtree;
//  C) the type-to-filter box narrows the tree to matches (ledger name,
//     group name, case-insensitive), Clear restores;
//  D) click a ledger → ledger-vouchers for it; click a group → group-summary;
//  E) registered on the Gateway (Reports pane, C) and in the Alt+G palette;
//  F) changing the period re-computes balances (the explorer respects the
//     session period);
//  G) zero page errors.
// Prereqs: compose stack at localhost:3000 (admin/admin123) with the built
// client (docker compose build app && docker compose up -d app).
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
  await D.createCompany({ name: `R63 COA ${Date.now().toString(36)}`, gstin: "27R63COAUI9K5", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created", !!cid, cid);
  const gw = `${D.BASE}/company/${cid}`;
  const coa = `${gw}/reports/chart-of-accounts`;

  // Seed: one Payment 500 (R63 Cash → R63 Rent) + a zero-activity ledger.
  const api = async (method, path, body) => {
    const r = await page.request[method](`${D.BASE}/api${path}`, body !== undefined ? { data: body } : undefined);
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status(), j };
  };
  const grps = Object.fromEntries(((await api("get", `/c/${cid}/groups`)).j ?? []).map((x) => [x.name, x.id]));
  await api("post", `/c/${cid}/ledgers`, { name: "R63 Cash", groupId: grps["Cash-in-Hand"] });
  await api("post", `/c/${cid}/ledgers`, { name: "R63 Rent", groupId: grps["Indirect Expenses"] });
  await api("post", `/c/${cid}/ledgers`, { name: "R63 Dormant", groupId: grps["Sundry Debtors"] });
  const led = (await api("get", `/c/${cid}/ledgers`)).j ?? [];
  const cash = led.find((l) => l.name === "R63 Cash");
  const rent = led.find((l) => l.name === "R63 Rent");
  const payment = ((await api("get", `/c/${cid}/voucher-types`)).j ?? []).find((t) => t.name === "Payment");
  const v = await api("post", `/c/${cid}/vouchers`, {
    voucherTypeId: payment.id, date: "2026-05-10", narration: "R63 coa probe",
    entries: [{ ledgerId: rent.id, amount: 500 }, { ledgerId: cash.id, amount: -500 }],
  });
  ok("seed voucher posted", v.status === 200 && !!v.j?.id, { status: v.status, id: v.j?.id });

  const open = async () => {
    await page.goto(coa, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="coa-tree"]', { timeout: 15000 });
    await D.sleep(300);
  };

  // ---- A) the full chart in one view ----
  await open();
  ok("COA page renders the tree", await page.locator('[data-testid="coa-tree"]').isVisible().catch(() => false));
  // expanded one level: roots visible, e.g. Capital Account (root) and
  // Current Assets → Bank Accounts (depth-1 group).
  ok("root group visible (Capital Account)", await page.locator('[data-testid="coa-group"]:has-text("Capital Account")').first().isVisible().catch(() => false));
  ok("depth-1 group visible (Bank Accounts)", await page.locator('[data-testid="coa-group"]:has-text("Bank Accounts")').first().isVisible().catch(() => false));
  ok("income group visible (Sales Accounts)", await page.locator('[data-testid="coa-group"]:has-text("Sales Accounts")').first().isVisible().catch(() => false));

  // ---- B) every ledger present (zero-activity too) ----
  const leafTexts = await page.locator('[data-testid="coa-ledger"]').allTextContents();
  const leaves = leafTexts.map((t) => t.trim());
  ok("posted ledger present (R63 Cash)", leaves.some((t) => t.includes("R63 Cash")), leaves.filter((t) => t.includes("R63")));
  ok("posted ledger present (R63 Rent)", leaves.some((t) => t.includes("R63 Rent")));
  ok("zero-activity ledger present (R63 Dormant) — masters always shown", leaves.some((t) => t.includes("R63 Dormant")));
  ok("opening-balance style dash-blank for nil balances", leaves.some((t) => t.includes("R63 Dormant") && !/\d/.test(t.replace("R63 Dormant", ""))), leaves.find((t) => t.includes("R63 Dormant")));
  ok("seeded ledgers visible (Cash ledger under Cash-in-Hand)", leaves.some((t) => t.includes("Cash")));

  // ---- C) type-to-filter ----
  await page.fill('[data-testid="coa-filter"]', "r63 rent");
  await D.sleep(300);
  ok("filter narrows to matching ledger", await page.locator('[data-testid="coa-ledger"]:has-text("R63 Rent")').first().isVisible().catch(() => false));
  ok("filter hides non-matching subtrees (no Capital Account)", !(await page.locator('[data-testid="coa-group"]:has-text("Capital Account")').first().isVisible().catch(() => false)));
  ok("filter is case-insensitive", (await page.locator('[data-testid="coa-ledger"]').count()) === 1);
  await page.click('[data-testid="coa-clear"]');
  await D.sleep(300);
  ok("Clear restores the full tree (R63 Dormant back)", await page.locator('[data-testid="coa-ledger"]:has-text("R63 Dormant")').first().isVisible().catch(() => false));

  // ---- D) click-through ----
  await page.locator('[data-testid="coa-ledger"]:has-text("R63 Rent")').first().click();
  await page.waitForURL("**/reports/ledger-vouchers**", { timeout: 8000 });
  ok("ledger click → ledger-vouchers", page.url().includes("ledger-vouchers"), page.url());
  const state = await page.evaluate(() => window.history.state?.usr ?? {});
  ok("ledger id passed for the drill-down", String(state.ledgerId ?? "") === String(rent.id), state);

  await open();
  await page.locator('[data-testid="coa-group"]:has-text("Indirect Expenses")').first().click();
  await page.waitForURL("**/reports/group-summary**", { timeout: 8000 });
  ok("group click → group-summary", page.url().includes("group-summary"), page.url());

  // ---- E) Gateway + palette registration (chord Alt+O — letters saturated) ----
  await page.goto(gw, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Gateway of zprime", { timeout: 15000 });
  await page.keyboard.press("R");
  await D.sleep(300);
  const coaChip = await page.locator('[data-testid="gateway-contents"] a:has-text("Chart of Accounts") .fkey-chip').first().textContent();
  ok("Gateway Reports pane lists Chart of Accounts with the Alt+O chip", coaChip?.trim() === "Alt+O", coaChip);
  await page.keyboard.press("Escape");
  await D.sleep(200);
  await page.keyboard.press("Alt+o");
  await page.waitForURL("**/reports/chart-of-accounts", { timeout: 8000 });
  ok("Alt+O opens the Chart of Accounts from the Gateway (every screen)", page.url().includes("chart-of-accounts"), page.url());
  await page.keyboard.press("Alt+g");
  await D.sleep(350);
  await page.fill('[data-testid="goto-input"]', "chart of");
  await D.sleep(400);
  const palRow = page.locator('[data-testid="goto-results"] li').filter({ hasText: "Chart of Accounts" }).first();
  ok("Alt+G palette finds Chart of Accounts and advertises Alt+O", (await palRow.textContent().catch(() => ""))?.includes("Alt+O") ?? false);
  await page.keyboard.press("Escape");
  await D.sleep(200);

  // ---- F) period respect ----
  await open();
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill("2026-05-01");
  await dates.nth(1).fill("2026-05-31");
  await D.sleep(900);
  const row = await page.locator('[data-testid="coa-ledger"]:has-text("R63 Rent")').first().textContent();
  ok("May window shows the 500 movement on R63 Rent", (row ?? "").includes("500"), row);
  await dates.nth(0).fill("2026-06-01");
  await dates.nth(1).fill("2026-06-30");
  await D.sleep(900);
  // Openings recompute per window (Tally-style): June shows the carried-forward
  // opening/closing of 500 with NO movement inside the window (Dr/Cr blank).
  const cells = await page.locator('[data-testid="coa-ledger"]:has-text("R63 Rent")').first().locator("td").allTextContents();
  ok("June window: no movement inside the window (Debit/Credit blank)", (cells[2] ?? "").trim() === "" && (cells[3] ?? "").trim() === "", cells);
  ok("June window: carried-forward opening/closing still shown", (cells[1] ?? "").includes("500") && (cells[4] ?? "").includes("500"), cells);

  ok("no page errors during R-63 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-63 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
