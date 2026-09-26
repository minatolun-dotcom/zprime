// PERSONA B — professional accountant driving a full monthly cycle.
// Power-user journey: company setup to Tally parity, taxable sale + purchase
// (IGST on the interstate leg), receipt/payment application, TDS on
// professional fees, stock lifecycle, e-invoice with IRN QR on the invoice
// face, month-end reports (P&L, BS, TB, GSTR-1, receivables), CSV export with
// provenance, keyboard shortcuts (Alt+G palette), and a final trial-balance
// balance assertion.
// Prereqs: compose stack at localhost:3000 (admin/admin123) + mock-irp sidecar.
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 220)}`); }
};

const BASE = D.BASE.replace(/\/$/, "");
const MOCK_HOST = "http://localhost:3299";

(async () => {
  // sidecar gate (same SKIP convention as r28…r31/r46/r68)
  let pubPem = null;
  try { pubPem = (await (await fetch(`${MOCK_HOST}/__pubkey`)).json()).publicKeyPem; } catch { /* absent */ }

  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  const stamp = Date.now().toString(36);
  // exactly 15 chars: "27" + 10 PAN-ish alnum + "1Z5"
  const coGstin = ("27PRO" + stamp.toUpperCase() + "XXXXXXXXXX").replace(/[^A-Z0-9]/g, "").slice(0, 12) + "1Z5";
  await D.createCompany({
    name: `ProCo ${stamp}`, gstin: coGstin, stateCode: "27",
    fyStart: "2026-04-01", booksBegin: "2026-04-01",
  });
  const cid = D.cid();
  ok("company created", !!cid, cid);

  // ---- setup: masters an accountant would build day one --------------------
  const g = {};
  for (const grp of await D.getJson(`/api/c/${cid}/groups`)) g[grp.name] = grp.id;
  await page.request.put(`${BASE}/api/companies/${cid}`, { data: { address: "5 Pro Street", city: "Mumbai", pincode: "400001" } });

  const buyer = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: {
    name: "Zen Traders", groupId: g["Sundry Debtors"], gstin: "29PROBUYER01Q3ZX",
    gstRegistrationType: "regular", billWise: true, partyAddress: "8 Buyer Road",
    partyState: "Karnataka", partyPincode: "560001",
  } })).json());
  const sellerLedger = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: {
    name: "Core Sales", groupId: g["Sales Accounts"], taxability: "taxable",
  } })).json());
  const supplier = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: {
    name: "Om Suppliers", groupId: g["Sundry Creditors"], gstin: "27OMPSUPPLY01Q3ZX",
    gstRegistrationType: "regular", partyState: "Maharashtra", partyPincode: "400001",
  } })).json());
  const purchaseLedger = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: {
    name: "Stock Purchases", groupId: g["Purchase Accounts"], taxability: "taxable",
  } })).json());
  const profFees = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: {
    name: "Professional Fees", groupId: g["Indirect Expenses"],
  } })).json());
  ok("masters created (buyer/sales/supplier/purchase/fees)", !!buyer?.id && !!sellerLedger?.id && !!supplier?.id && !!purchaseLedger?.id && !!profFees?.id);

  const igst = (await D.getJson(`/api/c/${cid}/ledgers`)).find((l) => l.name === "IGST" && l.dutyHead === "IGST");
  ok("seeded IGST duty ledger present", !!igst, !!igst);

  const unitId = (await D.getJson(`/api/c/${cid}/units`)).find((u) => u.symbol === "Nos")?.id;
  const item = (await (await page.request.post(`${BASE}/api/c/${cid}/stock-items`, { data: {
    name: "Pro Widget", unitId, gstRate: 18, taxability: "taxable",
    openingQty: 0, openingRate: 400, standardCost: 400, hsnSac: "9403",
  } })).json());
  ok("stock item created (opening 0, HSN 9403)", !!item?.id, item);

  // ---- goods inward first (a pro buys before selling; R-06 guard enforces it)
  await D.enterVoucher({
    type: "Purchase", date: "2026-04-05", party: "Om Suppliers", reference: "BIL-77",
    clickApplyGst: true,
    items: [{ item: "Pro Widget", qty: 20, rate: 400 }],
    lines: [{ ledger: "Stock Purchases", dr: 8000 }, { ledger: "Om Suppliers", cr: 9440 }],
  });
  ok("purchase posted (20 × ₹400 inward, GST applied)", true);

  // ---- taxable sale to Karnataka (interstate → IGST) -----------------------
  await D.enterVoucher({
    type: "Sales", date: "2026-04-08", party: "Zen Traders", reference: "INV-2001",
    narration: "Pro cycle sale", clickApplyGst: true,
    items: [{ item: "Pro Widget", qty: 10, rate: 500 }],
    lines: [{ ledger: "Zen Traders", dr: 5900 }, { ledger: "Core Sales", cr: 5000 }],
  });
  ok("taxable sale posted (10 × ₹500, GST via Apply-GST, party auto-balances)", true);

  const gstr1 = await D.getJson(`/api/c/${cid}/reports/gstr1?from=2026-04-01&to=2026-04-30`);
  const zenRow = (gstr1?.b2b || []).find((r) => r.partyName === "Zen Traders");
  ok("GSTR-1 B2B row: taxable 5000 + IGST 900 = total 5900", !!zenRow && Number(zenRow.taxable) === 5000 && Number(zenRow.igst) === 900 && Number(zenRow.total) === 5900, zenRow);
  ok("GSTR-1 B2B row flagged interstate, no supply mismatch", !!zenRow && zenRow.supplyType === "interstate" && zenRow.supplyMismatch === false, zenRow && { supplyType: zenRow.supplyType, mismatch: zenRow.supplyMismatch });

  const rec = await D.getJson(`/api/c/${cid}/reports/receivables`);
  const zen = (rec?.parties || []).find((r) => (r.ledgerName || "").includes("Zen Traders"));
  ok("Receivables: Zen Traders ₹5,900 outstanding", !!zen && Math.round(Number(zen.total)) === 5900, zen);

  // ---- receipt against the receivable --------------------------------------
  await D.enterVoucher({
    type: "Receipt", date: "2026-04-20",
    lines: [{ ledger: "Cash", dr: 1180 }, { ledger: "Zen Traders", cr: 1180 }],
  });
  ok("receipt posted (Cash Dr 1180 / Zen Traders Cr 1180)", true);

  const rec2 = await D.getJson(`/api/c/${cid}/reports/receivables`);
  const zen2 = (rec2?.parties || []).find((r) => (r.ledgerName || "").includes("Zen Traders"));
  ok("Receivables reduced to ₹4,720 after receipt", !!zen2 && Math.round(Number(zen2.total)) === 4720, zen2);

  // ---- payment to supplier --------------------------------------------------
  await D.enterVoucher({
    type: "Payment", date: "2026-04-21",
    lines: [{ ledger: "Om Suppliers", dr: 2000 }, { ledger: "Cash", cr: 2000 }],
  });
  ok("payment posted (Om Suppliers Dr 2000 / Cash Cr 2000)", true);

  // ---- TDS on professional fees (journal with a TDS Payable leg) -----------
  // (sections are per-company CRUD masters, empty on a fresh company; the
  // seeded duty ledger carries the deduction — the report reads it back)
  const allLedgers = await D.getJson(`/api/c/${cid}/ledgers`);
  const tdsPayable = allLedgers.find((l) => l.dutyHead === "TDS");
  const journalType = (await D.getJson(`/api/c/${cid}/voucher-types`)).find((t) => t.name === "Journal");
  const tdsResp = await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: {
    voucherTypeId: journalType.id, date: "2026-04-25", narration: "CA fees Apr — TDS deducted",
    idempotencyKey: `persona-pro-tds-${stamp}`,
    entries: [
      { ledgerId: profFees.id, amount: 20000 },
      { ledgerId: tdsPayable.id, amount: -2000 },
      { ledgerId: supplier.id, amount: -18000 },
    ],
  } });
  ok("TDS journal posted (fees 20000 Dr / TDS Payable 2000 Cr / supplier 18000 Cr)", tdsResp.ok(), await tdsResp.text().catch(() => tdsResp.status()));
  const tdsRep = await D.getJson(`/api/c/${cid}/reports/tds?from=2026-04-01&to=2026-04-30`);
  const deducted = (tdsRep?.deductions || []).filter((d) => Number(d.amount) === 2000).length > 0;
  ok("TDS report shows the ₹2,000 deduction", deducted, (tdsRep?.deductions || []).slice(0, 2));

  // ---- stock check ------------------------------------------------------------
  const stock = await D.getJson(`/api/c/${cid}/reports/stock-summary?from=2026-04-01&to=2026-04-30`);
  ok("Stock Summary shows Pro Widget", JSON.stringify(stock).includes("Pro Widget"));

  // ---- e-invoice: credentials + submit + IRN QR on the invoice face ---------
  if (pubPem) {
    const MOCK_OVERRIDE = "http://mock-irp:3199";
    const put = await page.request.put(`${BASE}/api/companies/${cid}/irp-credentials`, { data: {
      environment: "sandbox", clientId: "procli", clientSecret: "prosecret",
      gstin: coGstin, username: "proop", password: "propass",
      publicKeyPem: pubPem, endpointOverride: MOCK_OVERRIDE,
    } });
    ok("sandbox IRP credentials saved", put.ok(), put.status());
    const allVouchers = await D.getJson(`/api/c/${cid}/vouchers`);
    const saleVid = (Array.isArray(allVouchers) ? allVouchers : allVouchers?.vouchers || []).find((v) => v.typeName === "Sales")?.id;
    if (!saleVid) throw new Error("no Sales voucher found for e-invoice");
    if (saleVid) {
      const sub = await (await page.request.post(`${BASE}/api/c/${cid}/reports/einvoice/${saleVid}/submit`)).json();
      const irn = sub?.submission?.irn || sub?.irn;
      ok("e-invoice submitted (IRN accepted by mock)", !!sub?.ok && !!irn, sub);
      // invoice face: open the Sales alter screen via Day Book (r68 pattern)
      await page.goto(`${BASE}/company/${cid}/daybook`);
      await page.waitForSelector("table tbody tr");
      await page.locator("table tbody tr", { hasText: "Zen Traders" }).first().locator('a:has-text("Alter")').click();
      await page.waitForSelector("text=Ledger Entries");
      await D.sleep(800); // submissions query + face render
      const strip = page.locator('[data-testid="irn-qr-strip"]');
      const stripCount = await strip.count();
      const stripText = stripCount ? await strip.first().innerText() : "";
      ok("invoice face shows IRN QR strip (IRN + SVG)", stripCount >= 1 && stripText.includes(String(irn).slice(0, 16)) && (await page.locator('[data-testid="irn-qr-strip"] svg').count()) >= 1, { stripCount, stripText: stripText.slice(0, 80) });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    } else {
      ok("e-invoice submitted (IRN accepted by mock)", false, "sale voucher id not found");
      ok("invoice face shows IRN QR strip (SVG present)", false, "skipped — no voucher");
    }
  } else {
    console.log("  skip e-invoice block (mock-irp sidecar not running)");
  }

  // ---- month-end reports -----------------------------------------------------
  const pl = await D.getJson(`/api/c/${cid}/reports/profit-loss?from=2026-04-01&to=2026-04-30`);
  ok("P&L computes without error", !!pl && JSON.stringify(pl).length > 50);

  const bs = await D.getJson(`/api/c/${cid}/reports/balance-sheet?asOf=2026-04-30`);
  ok("Balance Sheet computes (as-of 30 Apr)", !!bs && JSON.stringify(bs).length > 50);

  // keyboard: Alt+G opens the Go To palette (assert via its input + results)
  await page.goto(`${BASE}/company/${cid}/daybook`);
  await page.waitForSelector('input[type="date"]');
  await page.keyboard.press("Alt+g");
  await page.waitForSelector('[data-testid="goto-input"]', { timeout: 5000 }).catch(() => {});
  const paletteVisible = await page.locator('[data-testid="goto-input"]').isVisible().catch(() => false);
  ok("Alt+G opens the Go To palette", paletteVisible);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // ---- CSV export from the Trial Balance (provenance meta rows) --------------
  await page.goto(`${BASE}/company/${cid}/reports/trial-balance?from=2026-04-01&to=2026-04-30`);
  await page.waitForSelector("table.report-table");
  const dl = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
  await page.locator('[data-testid="export-csv"], button:has-text("Export CSV")').first().click().catch(() => {});
  const download = await dl;
  ok("Trial Balance CSV downloads", !!download, "no download event");
  if (download) {
    const path = await download.path();
    const fs = require("fs");
    const csv = fs.readFileSync(path, "utf8");
    ok("CSV carries provenance meta (company + title)", new RegExp(`ProCo`).test(csv) && /[Tt]rial [Bb]alance/.test(csv), csv.slice(0, 120));
    ok("CSV ends with CRLF and is non-trivial", csv.includes("\r\n") && csv.split("\r\n").length > 5, csv.split("\r\n").length);
  }

  // ---- closing integrity: TB balances ---------------------------------------
  const tb = await D.getJson(`/api/c/${cid}/reports/trial-balance?from=2026-04-01&to=2026-04-30`);
  ok(`Trial Balance balances (diff ${tb?.difference})`, Number(tb?.totalDebit) === Number(tb?.totalCredit), tb && { dr: tb.totalDebit, cr: tb.totalCredit, diff: tb.difference });

  ok("zero page errors across the professional cycle", pageErrors.length === 0, pageErrors);

  console.log(`\n== PERSONA pro: ${pass} passed, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
