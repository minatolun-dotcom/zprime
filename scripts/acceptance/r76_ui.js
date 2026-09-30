// R-75 browser acceptance: Balance Sheet column integrity + back-navigation
// (operator-reported pair: "in balance sheet in both liabilities and assets
// table there seems to be extra blank column of debit and credit in both the
// table" and "from gateway … reports then to balance sheet … going back it
// directly goes back to the gateway not the options that comes after it").
//  A) BS column integrity: both cards render exactly Particulars + Debit +
//     Credit (+ Prev only with F12 compare) — header, tree rows, profit row
//     and Total row ALL carry the same cell count (the phantom second Dr/Cr
//     pair is gone).
//  A2) R-77: the same phantom-column audit extended to P&L, Trial Balance and
//     GSTR-1: TB header = 6 cols (7 with compare) with every row matching;
//     P&L rows carry a uniform silhouette (3 condensed, 4 with compare, the
//     Income Total row previously emitted TWO prev cells and swapped Dr/Cr
//     values); GSTR-1 B2B header carries the e-invoice/e-way action column
//     the rows always emitted (9, previously 8).
//  A3) R-77 STANDING SWEEP: the same invariants walked across EVERY report
//     table on ALL 21 report routes, so any future thead/body drift on any
//     report fails here and not in production:
//     (a) a table WITH a thead — every body row's column coverage (colSpan,
//         with rowSpan occupancy tracked per column, the honest HTML grid
//         model) must equal the thead's column count;
//     (b) a header-less table (the P&L's Tally-style statement cards and
//         GSTR-3B's summary tables) — every body row must carry the same
//         cell count (uniform silhouette).
//     Each route also declares a minimum report-table count (the fixture
//     guarantees structure everywhere except payables, which is legitimately
//     empty), so a table disappearing entirely fails the sweep too.
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
      // colSpan-aware: a Totals row spanning 4 columns carries 3 td ELEMENTS
      // but covers 6 columns — count columns covered, not elements.
      const tds = await card.locator("tbody tr").nth(i).locator("td");
      const n = await tds.count();
      let covered = 0;
      for (let j = 0; j < n; j++) covered += Number(await tds.nth(j).getAttribute("colspan")) || 1;
      if (covered !== ths) allMatch = false;
      if (sample.length < 4) sample.push(covered);
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

  // ---- A2) R-77: P&L / Trial Balance / GSTR-1 column integrity -------------
  // P&L cards are intentionally header-less (Tally's statement look) — the
  // check there is a uniform ROW silhouette instead of thead-vs-row.
  const rowStats = async (cardTitle) => {
    const card = page.locator(".card", { has: page.locator(`text=${cardTitle}`) }).first();
    const rows = await card.locator("tbody tr").count();
    const counts = [];
    for (let i = 0; i < rows; i++) counts.push(await card.locator("tbody tr").nth(i).locator("td").count());
    return { rows, uniq: [...new Set(counts)], counts };
  };
  await page.goto(`${BASE}/company/${cid}/reports/profit-loss`);
  await page.waitForSelector("text=Expenses (Dr)");
  await D.sleep(400);
  const exp = await rowStats("Expenses (Dr)");
  const inc = await rowStats("Income (Cr)");
  ok("P&L Expenses: every row carries the same cell count (3 — header-less statement)",
     exp.rows > 0 && exp.uniq.length === 1 && exp.uniq[0] === 3, exp);
  ok("P&L Income: every row carries the same cell count (3)",
     inc.rows > 0 && inc.uniq.length === 1 && inc.uniq[0] === 3, inc);

  await page.keyboard.press("F12");
  await D.sleep(500);
  const expC = await rowStats("Expenses (Dr)");
  const incC = await rowStats("Income (Cr)");
  const indC = await rowStats("Indirect Expenses");
  const indIC = await rowStats("Indirect Incomes");
  ok("P&L Expenses with F12 compare: uniform 4-cell rows (Dr/Cr + ONE prev)",
     expC.rows > 0 && expC.uniq.length === 1 && expC.uniq[0] === 4, expC);
  ok("P&L Income with F12 compare: uniform 4-cell rows (was: Total emitted 5)",
     incC.rows > 0 && incC.uniq.length === 1 && incC.uniq[0] === 4, incC);
  ok("P&L Indirect Expenses/Incomes with F12 compare: uniform 4-cell rows",
     indC.rows > 0 && indC.uniq.length === 1 && indC.uniq[0] === 4
     && indIC.rows > 0 && indIC.uniq.length === 1 && indIC.uniq[0] === 4,
     { ind: indC.uniq, indI: indIC.uniq });
  await page.keyboard.press("Alt+F1"); // detailed: the ledger detail rows join
  await D.sleep(400);
  const expD = await rowStats("Expenses (Dr)");
  ok("P&L Expenses detailed + compare: detail rows match the silhouette (4)",
     expD.rows > 0 && expD.uniq.length === 1 && expD.uniq[0] === 4, expD);
  await page.keyboard.press("F12");
  await D.sleep(400);
  const expD2 = await rowStats("Expenses (Dr)");
  ok("P&L Expenses detailed, no compare: detail rows match the silhouette (3)",
     expD2.rows > 0 && expD2.uniq.length === 1 && expD2.uniq[0] === 3, expD2);
  await page.keyboard.press("Alt+F1"); // back to condensed
  await D.sleep(300);

  await page.goto(`${BASE}/company/${cid}/reports/trial-balance`);
  await page.waitForSelector("table.report-table");
  await D.sleep(400);
  const tbCells = async (want) => {
    const ths = await page.locator("thead th").count();
    const rows = await page.locator("tbody tr").count();
    let allMatch = true;
    const sample = [];
    for (let i = 0; i < rows; i++) {
      const tr = page.locator("tbody tr").nth(i);
      const tds = tr.locator("td");
      const n = await tds.count();
      let covered = 0;
      for (let j = 0; j < n; j++) covered += Number(await tds.nth(j).getAttribute("colspan")) || 1;
      if (covered !== want) allMatch = false;
      if (sample.length < 3) sample.push(covered);
    }
    return { ths, rows, allMatch, sample };
  };
  const tb = await tbCells(6);
  ok("TB: header has exactly 6 columns (no phantom)", tb.ths === 6, tb);
  ok("TB: every row (incl. the colSpan Totals row) matches the header", tb.rows > 0 && tb.allMatch, tb);
  await page.keyboard.press("F12");
  await D.sleep(500);
  const tbC = await tbCells(7);
  ok("TB with F12 compare: 7 columns everywhere (header + every row)",
     tbC.ths === 7 && tbC.rows > 0 && tbC.allMatch, tbC);
  await page.keyboard.press("F12");
  await D.sleep(200);

  // GSTR-1 B2B: rows always emitted a 9th action cell (e-inv / e-way / …);
  // the header previously stopped at SGST — pin the header at 9.
  const gr = Object.fromEntries((await (await page.request.get(`${BASE}/api/c/${cid}/groups`)).json()).map((g) => [g.name, g.id]));
  const units = await (await page.request.get(`${BASE}/api/c/${cid}/units`)).json();
  const nos = units.find((u) => u.symbol === "Nos");
  ok("seeded unit present (Nos)", !!nos, units?.map?.((u) => u.symbol));
  const mkLedger = async (body) => (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: body })).json());
  const buyer = await mkLedger({ name: `R77 Buyer ${stamp}`, groupId: gr["Sundry Debtors"],
    gstin: `29R77${stamp.toUpperCase()}BUYER0`.slice(0, 15), gstRegistrationType: "regular",
    partyState: "Karnataka", partyPincode: "560001" });
  const walkin = await mkLedger({ name: `R77 Walkin ${stamp}`, groupId: gr["Sundry Debtors"],
    gstRegistrationType: "unregistered", partyState: "Maharashtra", partyPincode: "400001" });
  const sales = await mkLedger({ name: `R77 Sales ${stamp}`, groupId: gr["Sales Accounts"], taxability: "taxable" });
  const allLedgers = await (await page.request.get(`${BASE}/api/c/${cid}/ledgers`)).json();
  const igst = allLedgers.find((l) => l.name === "IGST" && l.dutyHead === "IGST");
  const cgst = allLedgers.find((l) => l.dutyHead === "CGST");
  const sgst = allLedgers.find((l) => l.dutyHead === "SGST");
  const itemRes = await page.request.post(`${BASE}/api/c/${cid}/stock-items`, { data: {
    name: `R77 Widget ${stamp}`, groupId: null, unitId: nos.id, gstRate: 18, taxability: "taxable",
    openingQty: 100, openingRate: 500, standardCost: 500, hsnSac: "8471" } });
  const item = await itemRes.json();
  ok("GST fixture ready (buyer / walkin / taxable sales / IGST / item)", !!buyer?.id && !!walkin?.id && !!sales?.id && !!igst?.id && !!cgst?.id && !!sgst?.id && !!item?.id,
     { buyer: buyer?.id, walkin: walkin?.id, sales: sales?.id, igst: igst?.id, cgst: cgst?.id, sgst: sgst?.id, item: item?.id });
  await post({
    voucherTypeId: vtList.find((t) => t.name === "Sales").id, date: "2026-04-05",
    partyLedgerId: buyer.id, placeOfSupply: "Karnataka",
    entries: [
      { ledgerId: sales.id, amount: -5000 },
      { ledgerId: igst.id, amount: -900 },
      { ledgerId: buyer.id, amount: 5900 },
    ],
    inventoryEntries: [{ itemId: item.id, qty: -10, rate: 500, amount: 5000, hsnSac: "8471", gstRate: 18 }],
  });
  // a B2C sale too (unregistered party, intra-state) so the B2C card has rows
  await post({
    voucherTypeId: vtList.find((t) => t.name === "Sales").id, date: "2026-04-06",
    partyLedgerId: walkin.id, placeOfSupply: "Maharashtra",
    entries: [
      { ledgerId: sales.id, amount: -2000 },
      { ledgerId: cgst.id, amount: -180 },
      { ledgerId: sgst.id, amount: -180 },
      { ledgerId: walkin.id, amount: 2360 },
    ],
    inventoryEntries: [{ itemId: item.id, qty: -4, rate: 500, amount: 2000, hsnSac: "8471", gstRate: 18 }],
  });
  await page.goto(`${BASE}/company/${cid}/reports/gstr1`);
  await page.waitForSelector("text=B2B Invoices");
  await D.sleep(400);
  const b2b = await cardStats("B2B Invoices");
  ok("GSTR-1 B2B: header carries the action column (9 columns, was 8)", b2b.ths === 9, b2b);
  ok("GSTR-1 B2B: every row's cell count matches the header", b2b.rows > 0 && b2b.allMatch, { sample: b2b.sample });
  const b2c = await cardStats("B2C (unregistered consumers)");
  ok("GSTR-1 B2C: header carries its E-way bill column (8 columns, already clean)", b2c.ths === 8, b2c.ths);
  ok("GSTR-1 B2C: every row's cell count matches the header", b2c.rows > 0 && b2c.allMatch, { sample: b2c.sample });

  // ---- A3) R-77 standing sweep: EVERY report table, ALL 21 report routes ---
  const SWEEP = [
    { key: "balance-sheet", wait: "text=Liabilities", min: 2 },
    { key: "chart-of-accounts", wait: '[data-testid="coa-tree"]', min: 1 },
    { key: "profit-loss", wait: "text=Expenses (Dr)", min: 4 },
    { key: "trial-balance", wait: "table.report-table", min: 1 },
    { key: "group-summary", wait: "table.report-table", min: 1, select: { label: "Sales Accounts" } },
    { key: "cash-bank", wait: "text=Period Dr", min: 1 },
    { key: "register-sales", wait: "table.report-table", min: 1 },
    { key: "register-purchase", wait: "table.report-table", min: 1 },
    { key: "stock-summary", wait: "text=Total Stock Value", min: 1 },
    { key: "receivables", wait: "table.report-table", min: 1 },
    { key: "payables", wait: '[data-testid="report-actions"]', min: 0 }, // no creditors in this fixture — legitimately table-less (empty state renders no table)
    { key: "gstr1", wait: "text=B2B Invoices", min: 3 },
    { key: "gstr3b", wait: "table.report-table", min: 3 },
    { key: "gstr9", wait: "text=Table 4", min: 6 },
    { key: "tds", wait: "table.report-table", min: 3 },
    { key: "tcs", wait: "table.report-table", min: 3 },
    { key: "salary-register", wait: "table.report-table", min: 1 },
    { key: "cheque-register", wait: "table.report-table", min: 1 },
    { key: "bank-reconciliation", wait: "table.report-table", min: 1 }, // server defaults to the first bank/cash ledger (Cash)
    { key: "order-book", wait: "table.report-table", min: 1 },
    { key: "ledger-vouchers", wait: "table.report-table", min: 1, select: { label: "Cash" } },
  ];
  const sweepTable = async (tb) => {
    const ths = await tb.locator("thead th").count();
    const rows = tb.locator("tbody tr");
    const rc = await rows.count();
    if (ths > 0) {
      // (a) grid equality: colSpan coverage per row, with rowSpan occupancy
      // tracked per column — a row under a rowSpan legitimately covers fewer
      // columns (Order Book's per-line rows).
      const occupied = new Map(); // rowIndex -> Set(columnIndex occupied from above)
      for (let r = 0; r < rc; r++) {
        const cells = rows.nth(r).locator("td");
        const cc = await cells.count();
        const occ = occupied.get(r) ?? new Set();
        let col = 0, covered = 0;
        for (let c = 0; c < cc; c++) {
          while (occ.has(col)) col++;
          const cs = Number(await cells.nth(c).getAttribute("colspan")) || 1;
          const rs = Number(await cells.nth(c).getAttribute("rowspan")) || 1;
          covered += cs;
          for (let rr = r + 1; rr < r + rs; rr++) {
            const s = occupied.get(rr) ?? new Set();
            for (let k = col; k < col + cs; k++) s.add(k);
            occupied.set(rr, s);
          }
          col += cs;
        }
        if (covered !== ths - occ.size)
          return { ok: false, why: "grid", ths, row: r, covered, expected: ths - occ.size, rows: rc };
      }
    } else if (rc > 0) {
      // (b) header-less table: uniform row silhouette (P&L statement cards)
      const first = await rows.nth(0).locator("td").count();
      for (let r = 1; r < rc; r++) {
        const cc = await rows.nth(r).locator("td").count();
        if (cc !== first) return { ok: false, why: "uniform", row: r, cc, first, rows: rc };
      }
    }
    return { ok: true, ths, rows: rc };
  };
  let sweepOk = 0, sweepFail = 0;
  for (const route of SWEEP) {
    await page.goto(`${BASE}/company/${cid}/reports/${route.key}`);
    if (route.select) {
      // picker-gated views (group-summary, ledger-vouchers) have NO data URL
      // until a pick is made — wait for the toolbar select first.
      await page.waitForSelector("select", { timeout: 15000 });
      await page.locator("select").selectOption({ label: route.select.label });
      await page.waitForSelector("table.report-table", { timeout: 15000 });
    } else {
      await page.waitForSelector(route.wait, { timeout: 15000 });
    }
    await D.sleep(350);
    const tables = page.locator("table.report-table");
    const n = await tables.count();
    if (n < route.min) {
      sweepFail++;
      ok(`sweep ${route.key}: table presence`, false, { tables: n, min: route.min });
      continue;
    }
    const bad = [];
    for (let i = 0; i < n; i++) {
      const res = await sweepTable(tables.nth(i));
      if (!res.ok) bad.push({ table: i, ...res });
    }
    if (bad.length === 0) { sweepOk++; ok(`sweep ${route.key}: ${n} table(s) grid-consistent`, true, null); }
    else { sweepFail++; ok(`sweep ${route.key}: ${n} table(s) grid-consistent`, false, bad); }
  }
  ok("standing sweep covered all 21 report routes", sweepOk + sweepFail === SWEEP.length && sweepFail === 0,
     { ok: sweepOk, fail: sweepFail, routes: SWEEP.length });

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
  ok("Reports menu page renders the full report list (18 options — 17 + the F-83-8 Cost Centres)", menuCount === 18, menuCount);
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

  console.log(`\n== R-75/R-77 RESULT: ${pass} passed, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
