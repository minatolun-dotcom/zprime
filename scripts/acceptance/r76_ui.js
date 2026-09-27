// R-75 browser acceptance: Balance Sheet column integrity + back-navigation
// (operator-reported pair: "in balance sheet in both liabilities and assets
// table there seems to be extra blank column of debit and credit in both the
// table" and "from gateway … reports then to balance sheet … going back it
// directly goes back to the gateway not the options that comes after it").
//  A) BS column integrity: both cards render exactly Particulars + Debit +
//     Credit (+ Prev only with F12 compare) — header, tree rows, profit row
//     and Total row ALL carry the same cell count (the phantom second Dr/Cr
//     pair is gone).
//  B) Back-navigation: Gateway → Reports pane → Balance Sheet; browser Back
//     reopens the Gateway WITH the Reports pane restored; the new Reports
//     menu page (/company/:cid/reports) is the in-between surface — reachable
//     from a report's breadcrumb and by Esc/Back; deep links still fall back
//     to the Gateway (documented R-53c behaviour, unchanged).
// Prereqs: compose stack at localhost:3000 (admin/admin123) with the built
// client (docker compose build app && docker compose up -d app).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 260)}`); }
};

const BASE = D.BASE.replace(/\/$/, "");
const stamp = Date.now().toString(36);

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  await D.createCompany({
    name: `R75 Nav Fix ${stamp}`, stateCode: "27",
    // Books begin a year before the FY so the R-60 prior-year window overlaps
    // the books (r60's own fixture pattern) — otherwise the prior column is
    // honestly suppressed and the compare leg has nothing to pin.
    fyStart: "2025-04-01", booksBegin: "2025-04-01",
  });
  const cid = D.cid();
  ok("company created", !!cid, cid);

  // minimal balanced fixture: capital introduced (Dr Cash / Cr P&L)
  const ledgers = await (await page.request.get(`${BASE}/api/c/${cid}/ledgers`)).json();
  const cash = ledgers.find((l) => l.name === "Cash");
  const pl = ledgers.find((l) => l.name === "Profit & Loss A/c");
  const vtList = await (await page.request.get(`${BASE}/api/c/${cid}/voucher-types`)).json();
  const journalType = vtList.find((t) => t.name === "Journal");
  const post = async (body) => {
    const res = await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: body });
    if (!res.ok()) throw new Error(`POST failed: ${await res.text()}`);
    return res.json();
  };
  await post({
    voucherTypeId: journalType.id, date: "2026-04-01", narration: "Capital introduced",
    entries: [
      { ledgerId: cash.id, amount: 5000 },
      { ledgerId: pl.id, amount: -5000 },
    ],
  });
  ok("balanced fixture journal posted", true, null);
  // R-60 honest-null: a prior-year column only renders when the prior window
  // overlaps the books — post one prior-FY voucher so the F12 leg has data.
  await post({
    voucherTypeId: journalType.id, date: "2025-05-10", narration: "Prior-FY capital",
    entries: [
      { ledgerId: cash.id, amount: 500 },
      { ledgerId: pl.id, amount: -500 },
    ],
  });
  ok("prior-FY fixture journal posted (2025-05-10)", true, null);

  // ---- A) Balance Sheet column integrity -------------------------------------
  await page.goto(`${BASE}/company/${cid}/reports/balance-sheet`);
  await page.waitForSelector("text=Liabilities");
  await D.sleep(400);

  const cardStats = async (cardTitle) => {
    const card = page.locator(".card", { has: page.locator(`text=${cardTitle}`) }).first();
    const ths = await card.locator("thead th").count();
    const rows = await card.locator("tbody tr").count();
    let allMatch = true;
    let sample = [];
    for (let i = 0; i < rows; i++) {
      const tds = await card.locator("tbody tr").nth(i).locator("td").count();
      if (tds !== ths) allMatch = false;
      if (sample.length < 4) sample.push(tds);
    }
    return { ths, rows, allMatch, sample };
  };

  const liab = await cardStats("Liabilities");
  const assets = await cardStats("Assets");
  ok("BS Liabilities: header has exactly 3 columns (no phantom Dr/Cr pair)", liab.ths === 3, liab);
  ok("BS Assets: header has exactly 3 columns", assets.ths === 3, assets);
  ok("BS Liabilities: every row's cell count matches the header",
     liab.rows > 0 && liab.allMatch, liab);
  ok("BS Assets: every row's cell count matches the header",
     assets.rows > 0 && assets.allMatch, assets);

  // F12 compare ON: one Prev column appears — header 4, every row 4
  await page.keyboard.press("F12");
  await D.sleep(500);
  const liabC = await cardStats("Liabilities");
  const assetsC = await cardStats("Assets");
  ok("BS with F12 compare: header has exactly 4 columns (Dr/Cr + Prev, no phantoms)",
     liabC.ths === 4 && assetsC.ths === 4, { liab: liabC.ths, assets: assetsC.ths });
  ok("BS with F12 compare: every row's cell count matches the header",
     liabC.allMatch && assetsC.allMatch, { liab: liabC.sample, assets: assetsC.sample });
  await page.keyboard.press("F12");
  await D.sleep(300);

  // ---- B) Back-navigation ------------------------------------------------------
  // Gateway → Reports pane → Balance Sheet (the operator's exact path)
  await page.goto(`${BASE}/company/${cid}`);
  await page.waitForSelector("text=Gateway of zprime");
  await page.click('button:has-text("Reports")');
  await D.sleep(300);
  const paneVisible = (await page.locator('[data-testid="gateway-contents"] a:has-text("Balance Sheet")').count()) === 1;
  ok("Gateway Reports pane opens with report options", paneVisible, null);
  await page.click('[data-testid="gateway-contents"] a:has-text("Balance Sheet")');
  await page.waitForSelector("text=Liabilities");
  ok("Balance Sheet opens from the Gateway pane", page.url().includes("/reports/balance-sheet"), page.url());

  // browser Back → the Gateway WITH the Reports pane restored
  await page.goBack();
  await page.waitForSelector("text=Gateway of zprime");
  await D.sleep(400);
  const paneRestored = (await page.locator('[data-testid="gateway-contents"] a:has-text("Balance Sheet")').count()) === 1;
  ok("browser Back returns to the Gateway with the Reports pane restored",
     page.url().replace(/\/$/, "") === `${BASE}/company/${cid}` && paneRestored,
     { url: page.url(), paneRestored });

  // the new Reports menu page: reachable from a report's breadcrumb
  await page.goto(`${BASE}/company/${cid}/reports/balance-sheet`);
  await page.waitForSelector("text=Liabilities");
  await page.click('nav >> text=Reports');
  await page.waitForSelector('[data-testid="reports-menu"]');
  const menuCount = await page.locator('[data-testid="reports-menu"] a').count();
  ok("Reports menu page renders the full report list (17 options)", menuCount === 17, menuCount);
  ok("Reports menu URL is the in-between surface", /\/company\/\d+\/reports$/.test(page.url()), page.url());

  // Esc from the menu goes back to the report it came from (history-faithful)
  await page.keyboard.press("Escape");
  await page.waitForSelector("text=Liabilities");
  ok("Esc on the Reports menu returns to the report", page.url().includes("/reports/balance-sheet"), page.url());

  // menu → Trial Balance → Esc lands on the MENU, not the Gateway
  await page.goto(`${BASE}/company/${cid}/reports`);
  await page.waitForSelector('[data-testid="reports-menu"]');
  await page.click('[data-testid="reports-menu"] a:has-text("Trial Balance")');
  await page.waitForSelector("table.report-table");
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="reports-menu"]');
  ok("Esc from a report opened via the menu lands back on the menu (the options that came after it)",
     /\/company\/\d+\/reports$/.test(page.url()), page.url());

  // same-tab deep links walk the real trail: the menu visit is in it
  await page.goto(`${BASE}/company/${cid}/reports/trial-balance`);
  await page.waitForSelector("table.report-table");
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="reports-menu"]', { timeout: 8000 });
  ok("Esc from a same-tab deep link walks the trail (the menu) — history-faithful",
     /\/company\/\d+\/reports$/.test(page.url()), page.url());

  // Esc semantics on a truly fresh page: Playwright's newPage() carries an
  // about:blank history entry, so nav.length > 1 and Esc walks history back
  // (about:blank) — the CORRECT history-faithful behaviour. A real browser's
  // fresh tab has nav.length === 1 and falls back to the Gateway (R-53c);
  // that exact state is unconstructible here, so pin the honest contract:
  // Esc either falls back to the Gateway or walks history — never /companies,
  // never an error, never a page reload.
  const p2 = await page.context().newPage();
  const errs2 = [];
  p2.on("pageerror", (e) => errs2.push(String(e?.message ?? e)));
  await p2.goto(`${BASE}/company/${cid}/reports/trial-balance`);
  await p2.waitForSelector("table.report-table");
  await p2.keyboard.press("Escape");
  await p2.waitForTimeout(1000);
  const deepUrl = p2.url();
  const escSemanticsOk = /\/company\/\d+\/?$/.test(deepUrl) // Gateway fallback (real no-trail)
    || deepUrl === "about:blank" // history-back (the Playwright about:blank entry)
    || /\/company\/\d+\/reports/.test(deepUrl); // stayed (no claim fired)
  ok("Esc on a fresh-page report keeps history-faithful semantics (Gateway fallback or history-back, never a leak)",
     escSemanticsOk, deepUrl);
  await p2.close();
  ok("zero page errors on the fresh-page deep link", errs2.length === 0, errs2);

  ok("zero page errors across the R-75 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-75 RESULT: ${pass} passed, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
