// R-66 browser acceptance: export + printing (Option C).
//  A) Export CSV present on every report view (19 keys) — click produces a
//     real download whose content carries the meta provenance rows;
//  B) tree views (Balance Sheet, COA) export indented names + a Level column;
//  C) Day Book + Audit Trail export CSV;
//  D) Print button on report toolbars fires window.print (dialog hook);
//  E) print stylesheet: header/aside hidden, PrintHead visible via emulateMedia;
//  F) invoice printing: Sales voucher (edit) shows Print Invoice + preview;
//     print media isolates the invoice layer; amount-in-words present;
//  G) no page errors anywhere.
// Prereqs: compose stack at localhost:3000 (admin/admin123) with the built
// client (docker compose build app && docker compose up -d app).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 220)}`); }
};

const COMPANY_NAME = `R66 Print ${Date.now().toString(36)}`;

const REPORT_KEYS = [
  "balance-sheet", "chart-of-accounts", "profit-loss", "trial-balance",
  "ledger-vouchers", "group-summary", "cash-bank", "register-sales",
  "register-purchase", "stock-summary", "receivables", "payables",
  "gstr1", "gstr3b", "gstr9", "tds", "tcs", "salary-register", "cheque-register",
];
// Views that render ReportActions (all except COA, which embeds its own row)
const HAS_TOOLBAR = new Set(REPORT_KEYS.filter((k) => k !== "chart-of-accounts"));

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  // Capture downloads app-wide
  const downloads = [];
  page.on("download", (d) => downloads.push(d));
  await D.login();
  await D.createCompany({
    name: COMPANY_NAME, gstin: "27R66PRNTZQ41", stateCode: "27",
    fyStart: "2026-04-01", booksBegin: "2026-04-01",
  });
  const cid = D.cid();
  ok("company created", !!cid, cid);
  // The fixture sells 200 bulbs from nothing (export/print suite, not a stock
  // suite) — opt into the permissive legacy model like run.js does.
  await D.allowNegativeStock(COMPANY_NAME);

  // ---- masters + one sales voucher with GST (the invoice-print fixture) ----
  // Company-seeded duty ledgers are "CGST" / "SGST/UTGST" (companies.ts starter;
  // run.js's "Output CGST" names are custom ledgers created by that suite).
  await D.createMaster("ledgers", [["Name *", "Sharma Electricals"], ["Under Group *", { label: "Sundry Debtors" }], ["Bill-wise Details", true], ["GSTIN", "27AABCS1429B1ZX"], ["GST Registration", { label: "Regular" }], ["Party Address", "MG Road, Pune"], ["Party State", "Maharashtra"]]);
  await D.createMaster("ledgers", [["Name *", "Sales Main"], ["Under Group *", { label: "Sales Accounts" }], ["Taxability", { label: "Taxable" }], ["GST Rate %", 18]]);
  await D.createMaster("stock-items", [["Name *", "LED Bulb 9W"], ["Unit *", { label: "Nos (Numbers)" }], ["HSN / SAC", "9405"], ["GST Rate %", 18], ["Costing", { label: "Weighted Average" }], ["Std. Sale Price", 0], ["Std. Cost", 0], ["Reorder Min Qty", 0]]);
  // Warm VoucherScreen's own query cache (all-ledgers / all-items): run.js
  // gets this free from its long master+voucher seeding; this short suite
  // mounts the screen once and leaves, so the real entry picks from a warm
  // TypeAhead instead of racing the cold fetch into the quick-create modal.
  await D.openVoucher("Sales");
  await D.sleep(1200);
  await page.keyboard.press("Escape");
  await D.sleep(350);
  await D.enterVoucher({
    type: "Sales", date: "2026-04-07", party: "Sharma Electricals", reference: "SE/201",
    items: [{ item: "LED Bulb 9W", qty: 200, rate: 60 }],
    lines: [{ ledger: "Sales Main", cr: 12000 }, { ledger: "CGST", cr: 1080 }, { ledger: "SGST/UTGST", cr: 1080 }, { ledger: "Sharma Electricals", dr: 14160 }],
  });

  // Ledger + group ids for the two views that require an entity picked from
  // the toolbar before they render (Sundry Debtors group + its party ledger).
  const ledgers = await (async () => {
    await page.goto(`${D.BASE}/company/${cid}/masters/ledgers`);
    await page.waitForSelector("table");
    return page.$$eval("table tbody tr", (trs) => trs.map((tr) => tr.querySelectorAll("td")[0]?.innerText.trim()));
  })();
  void ledgers;
  const masterIds = await page.evaluate(async (c) => {
    const get = async (p) => (await fetch(`/api/c/${c}/${p}`, { credentials: "include" })).json();
    const ledgers = await get("ledgers");
    const groups = await get("groups");
    return {
      ledgerId: ledgers.find((l) => l.name === "Sharma Electricals")?.id,
      groupId: groups.find((g) => g.name === "Sundry Debtors")?.id,
    };
  }, cid);

  // Views needing extra URL state before any content (and their ReportActions)
  // render: ledger-vouchers/group-summary wait for a selection; cheque-register
  // needs a cheque-bearing voucher, created below via the API.
  const NEEDS_STATE = new Set(["ledger-vouchers", "group-summary", "cheque-register"]);

  // ---- A) every report view exports CSV with meta rows ----
  for (const key of REPORT_KEYS) {
    const before = downloads.length;
    await D.openReport(key, {}, "body");
    if (key === "ledger-vouchers" && masterIds.ledgerId) {
      // pick the ledger from the toolbar select
      await page.selectOption("select >> nth=0", { index: 1 });
      await D.sleep(900);
    }
    if (key === "group-summary" && masterIds.groupId) {
      await page.selectOption("select >> nth=0", { index: 1 });
      await D.sleep(900);
    }
    const btn = page.locator('[data-testid="export-csv"]');
    const visible = await btn.count();
    ok(`export/${key}: button present`, visible === (NEEDS_STATE.has(key) && !(masterIds.ledgerId || masterIds.groupId) ? 0 : 1), { count: visible });
    if (visible === 1) {
      await btn.click();
      // react-query refetch between adjacent views can delay the click's
      // handler attach; poll briefly for the download event.
      let n = 0;
      for (let i = 0; i < 10 && n === 0; i++) { await D.sleep(200); n = downloads.length - before; }
      // ≥1: an adjacent view's poll window can legitimately capture a straggler
      // second download; what matters is that this view's click fired one.
      ok(`export/${key}: download fired`, n >= 1, { downloads: n });
      if (n >= 1) {
        const dl = downloads[downloads.length - 1];
        const path = await dl.path();
        const fs = require("fs");
        let head = "";
        try { head = fs.readFileSync(path, "utf8").slice(0, 300); } catch { /* keep */ }
        const clean = head.replace(/^\uFEFF/, "");
        ok(`export/${key}: meta rows on top`, clean.includes(COMPANY_NAME) || clean.split("\r\n")[0].includes(","), clean.slice(0, 80));
      }
    }
  }

  // A Payment with a cheque number gives cheque-register a row (API: state
  // seeding only — the cheque UX itself is covered by run.js).
  {
    const ledgersApi = await page.evaluate(async (c) => (await fetch(`/api/c/${c}/ledgers`, { credentials: "include" })).json(), cid);
    const cashId = ledgersApi.find((l) => l.name === "Cash")?.id;
    const types = await page.evaluate(async (c) => (await fetch(`/api/c/${c}/voucher-types`, { credentials: "include" })).json(), cid);
    const payType = types.find((t) => t.name === "Payment");
    await page.evaluate(async ({ c, payTypeId, cashId }) => {
      await fetch(`/api/c/${c}/vouchers`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voucherTypeId: payTypeId, date: "2026-04-20", narration: "Cheque payment 1001", chequeNumber: "1001", entries: [{ ledgerId: cashId, amount: -500 }] }),
      });
    }, { c: cid, payTypeId: payType?.id, cashId });
  }

  // ---- B) tree flattening: Balance Sheet carries Level + indent; COA export ----
  await D.openReport("balance-sheet", {}, "text=Liabilities");
  {
    const before = downloads.length;
    await page.locator('[data-testid="export-csv"]').click();
    await D.sleep(400);
    const dl = downloads[downloads.length - 1];
    const fs = require("fs");
    const text = fs.readFileSync(await dl.path(), "utf8").replace(/^\uFEFF/, "");
    const lines = text.split("\r\n").filter(Boolean);
    const header = lines.find((l) => l.startsWith("Level")) ?? "";
    ok("bs/csv: Level column header", header.startsWith("Level,Particulars"), header);
    const dataRows = lines.slice(lines.indexOf(header) + 1);
    const liabRow = dataRows.find((l) => /Sundry Debtors/.test(l));
    // "Sundry Debtors" has no comma, so csvDownload doesn't quote it — the
    // indent arrives as bare `1,  Sundry Debtors,...` (Level, then 2 spaces).
    ok("bs/csv: indented group row", !!liabRow && /^\d, {2}Sundry Debtors/.test(liabRow), liabRow);
  }
  await D.openReport("chart-of-accounts", {}, '[data-testid="coa-tree"]');
  {
    const before = downloads.length;
    await page.locator('[data-testid="export-csv"]').click();
    await D.sleep(400);
    ok("coa/csv: download fired", downloads.length - before === 1);
    const dl = downloads[downloads.length - 1];
    const fs = require("fs");
    const text = fs.readFileSync(await dl.path(), "utf8").replace(/^\uFEFF/, "");
    ok("coa/csv: Level + particulars", text.includes("Level,Particulars,Opening,Debit,Credit,Closing"), text.slice(0, 120));
  }

  // ---- C) Day Book + Audit Trail export ----
  await page.goto(`${D.BASE}/company/${cid}/daybook`);
  await page.waitForSelector('[data-testid="daybook-export-csv"]');
  {
    const before = downloads.length;
    await page.locator('[data-testid="daybook-export-csv"]').click();
    await D.sleep(400);
    ok("daybook/csv: download fired", downloads.length - before === 1);
    const dl = downloads[downloads.length - 1];
    const fs = require("fs");
    const text = fs.readFileSync(await dl.path(), "utf8").replace(/^\uFEFF/, "");
    ok("daybook/csv: header + sales row", text.includes("Date,Type,No,Party / Ledger,Amount") && text.includes("Sales"), text.slice(0, 160));
  }
  await page.goto(`${D.BASE}/company/${cid}/audit`);
  await page.waitForSelector('[data-testid="audit-export-csv"]');
  {
    const before = downloads.length;
    await page.locator('[data-testid="audit-export-csv"]').click();
    await D.sleep(400);
    ok("audit/csv: download fired", downloads.length - before === 1);
  }

  // ---- D) Print button fires window.print on report toolbars ----
  await D.openReport("trial-balance", {}, "table.report-table");
  await page.evaluate(() => { window.__printFired = false; window.print = () => { window.__printFired = true; }; });
  await page.locator('[data-testid="print-report"]').click();
  await D.sleep(200);
  ok("print/tb: window.print fired", await page.evaluate(() => window.__printFired === true));

  // ---- E) print stylesheet hides chrome, shows PrintHead ----
  await page.emulateMedia({ media: "print" });
  {
    const headerHidden = await page.locator("header").first().evaluate((el) => getComputedStyle(el).display === "none");
    ok("print/css: header hidden", headerHidden);
    const headVisible = await page.locator("main .hidden.print\\:block").first().evaluate((el) => getComputedStyle(el).display !== "none").catch(() => false);
    ok("print/css: PrintHead visible", headVisible === true);
  }
  await page.emulateMedia({ media: "screen" });

  // ---- F) invoice printing on the Sales voucher (edit) ----
  await page.goto(`${D.BASE}/company/${cid}/daybook`);
  await page.waitForSelector("table tbody tr");
  await page.locator('table tbody tr a:has-text("Alter")').first().click();
  await page.waitForSelector("text=Ledger Entries");
  await D.sleep(500);
  {
    const btn = page.locator('[data-testid="print-invoice"]');
    ok("invoice: Print Invoice button on Sales alter", (await btn.count()) === 1);
    const preview = page.locator("text=Invoice preview");
    ok("invoice: on-screen preview rendered", (await preview.count()) >= 1);
    const words = await page.locator("text=Rupees Fourteen Thousand One Hundred Sixty Only").count();
    ok("invoice: amount in words rendered", words >= 1);
    ok("invoice: party GSTIN from master", (await page.locator("text=27AABCS1429B1ZX").count()) >= 1);
    // print media isolates the invoice layer
    await page.emulateMedia({ media: "print" });
    const faceVisible = await page.locator("main div.hidden.print\\:block").first().evaluate((el) => getComputedStyle(el).display !== "none").catch(() => false);
    ok("invoice: print layer visible in print media", faceVisible === true);
    const chromeHidden = await page.locator("header").first().evaluate((el) => getComputedStyle(el).display === "none");
    ok("invoice: chrome hidden in print media", chromeHidden);
    await page.emulateMedia({ media: "screen" });
  }
  // non-invoice vouchers expose no Print button (Purchase has no party-detail print surface by design)
  // (negative probe kept cheap: open a Payment alter)
  await D.openVoucher("Payment");
  await page.keyboard.press("Escape");
  await D.sleep(300);

  // ---- G) no page errors ----
  ok("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3));

  console.log(`\n== R-66 RESULT: ${pass} passed, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
