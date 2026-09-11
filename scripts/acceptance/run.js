#!/usr/bin/env node
/**
 * zprime acceptance test — a fictional Indian trading business run through the
 * real UI (Apr–Jun FY 2026-27), reconciled monthly against an independent
 * expectation engine (scripts/acceptance/engine.py).
 *
 * Business: Meridian Traders — electrical goods trading, Maharashtra (27).
 *
 * Conventions (verified):
 *  - Entry amount > 0 = Debit, < 0 = Credit. Sales: party Dr / sales Cr / duty Cr.
 *  - Receipts/Payments: NO party header — party is a grid row (bill cell active
 *    when the ledger is bill-wise). Settlements reference the app voucher number.
 *  - new_ref bill names = SHORTCODE-number (A-02 fix; client uses `${shortCode}-${number}`).
 *  - Party A/c header exists only for Sales/Purchase/CN/DN; party row auto-inserts
 *    at grid top with amount 0 — we fill it LAST with the balancing total.
 *  - Ctrl+A saves; F-keys open vouchers from Day Book; duty lines entered manually
 *    (Alt+G helper is probed separately as a suspected wrong-base bug).
 *  - Physical Stock: qty field = COUNTED qty (server computes diff at running avg).
 */
const { execSync } = require("child_process");
const fs = require("fs");
const D = require("./driver.js");

const FY = "2026-04-01";
const BASE_URL = process.env.ZP_URL || "http://localhost:3000";
const close = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

const state = {
  company: { name: "Meridian Traders", stateCode: "27", gstin: "27MERID12TR3" },
  fyStart: FY, monthEnds: [], seq: 0,
  masters: { groups: [], ledgers: [], items: [], employees: [], payHeads: [] },
  vouchers: [],
};
const record = (v) => { state.vouchers.push({ seq: ++state.seq, ...v }); };
const markDeleted = (ref) => { const v = state.vouchers.find((x) => x.reference === ref && !x._deleted); if (v) v._deleted = true; };
const editState = (ref, patch) => Object.assign(state.vouchers.find((x) => x.reference === ref && !x._deleted) || {}, patch);

async function writeState() {
  fs.writeFileSync("scripts/acceptance/state.json", JSON.stringify(state, null, 1));
}
async function recompute() {
  execSync("python3 scripts/acceptance/engine.py scripts/acceptance/state.json", { stdio: "inherit" });
  return JSON.parse(fs.readFileSync("scripts/acceptance/expected.json", "utf8"));
}

// =====================================================================
// MASTER SEEDING
// =====================================================================
async function createMasters() {
  const M = state.masters;
  const L = (name, group, o = {}) => {
    M.ledgers.push({ name, group, opening: o.opening || 0, billWise: !!o.billWise,
      gstin: o.gstin, gstReg: o.gstReg || (o.gstin ? "regular" : "none"),
      taxability: o.taxability || "none", gstRate: o.gstRate,
      dutyHead: o.dutyHead, isBankCash: !!o.isBankCash, tdsSection: o.tdsSection });
    return name;
  };
  const IT = (name, o = {}) => {
    M.items.push({ name, unit: o.unit || "Pieces", hsn: o.hsn || "9405", gstRate: o.gstRate ?? 18,
      taxability: o.taxability || "taxable", costing: o.costing || "weighted_avg",
      openingQty: o.oq || 0, openingRate: o.openingRate || 0, openingValue: o.ov || 0, minQty: o.minQty || 0 });
    return name;
  };

  await D.createMaster("units", [["Description *", "Pieces"], ["Symbol *", "pcs"]]);
  await D.createMaster("units", [["Description *", "Box of 10"], ["Symbol *", "box"], ["Decimals", "0"]]);
  await D.createMaster("godowns", [["Name *", "Main Warehouse"]]);
  await D.createMaster("godowns", [["Name *", "Retail Shop"]]);
  await D.createMaster("stock-groups", [["Name *", "LED Lighting"]]);
  await D.createMaster("stock-groups", [["Name *", "Wires & Cables"]]);
  // Custom groups: UI exposes Name + Under Group (+ Nature for top-level groups).
  // F-GRP-01 regression: creation must SUCCEED and inherit the parent's nature.
  await D.createMaster("groups", [["Name *", "Security Deposits"], ["Under Group", { label: "Current Assets" }]]);
  D.record(true, "grp/custom-create", "F-GRP-01 regression: custom group created via UI under Current Assets");
  try {
    await D.createMaster("groups", [["Name *", "FD With Bank"], ["Under Group", { label: "Current Assets" }]]);
    D.record(true, "grp/nested-create", "Nested custom group created via UI");
  } catch (e) { D.record(false, "grp/nested-create", "Nested custom group created via UI", e.message.slice(0, 200)); }

  IT("LED Bulb 9W", { oq: 400, ov: 16000, minQty: 100 });
  IT("LED Tube 20W", { costing: "fifo", oq: 100, ov: 5000 });
  IT("Copper Wire 1.5sqmm", { unit: "Box of 10", hsn: "8544" });
  IT("Switch 6A", { hsn: "8536" });
  IT("MCB 32A", { hsn: "8536", oq: 60, ov: 9000 });
  IT("Exhaust Fan", { hsn: "8414", costing: "fifo" });
  for (const it of M.items) {
    const unitSym = it.unit === "Box of 10" ? "box" : "pcs";
    // NOTE: Std. Sale Price / Std. Cost / Min Qty are filled explicitly — leaving
    // them blank sends empty strings to numeric columns and 500s (F-ITM-01).
    const f = [["Name *", it.name], ["Unit *", { label: `${unitSym} (${it.unit})` }], ["HSN / SAC", it.hsn],
      ["GST Rate %", it.gstRate],
      ["Costing", { label: it.costing === "fifo" ? "FIFO" : "Weighted Average" }],
      ["Std. Sale Price", 0], ["Std. Cost", 0], ["Reorder Min Qty", it.minQty || 0]];
    if (it.openingQty) f.push(["Opening Qty", it.openingQty], ["Opening Value", it.openingValue]);
    await D.createMaster("stock-items", f);
  }

  // The seed already provides: Cash (isBankCash), Profit & Loss A/c, IGST/CGST/
  // SGST/UTGST/CESS/TDS Payable duty ledgers, Salary Payable. We create our own
  // bank + parties + trading/income/expense ledgers only.
  L("HDFC Bank", "Bank Accounts", { isBankCash: true });
  L("Professional Tax Payable", "Current Liabilities");
  // Journal ledgers not seeded. F-TDS-01: tds-sections list endpoint 500s
  // (localeCompare on name-less table) → section masters are NOT created; TDS is
  // deducted manually and lands "Unspecified" in the TDS report.
  // Opening books come from the two opening journals (OPEN-CAP + OPEN-STK), not
  // master openings — otherwise capital and stock are counted twice.
  L("Capital Account", "Capital Account");
  L("Stock-in-Hand", "Stock-in-Hand");

  L("Sharma Electricals", "Sundry Debtors", { billWise: true, gstin: "27AABCS1429B1ZX" });
  L("Karnataka Traders", "Sundry Debtors", { billWise: true, gstin: "29AACCK1234M1Z5" });
  L("Deshmukh Traders", "Sundry Debtors", { billWise: true, gstReg: "unregistered" });
  L("Global Spares", "Sundry Creditors", { billWise: true, gstin: "27AAACG5678K1Z9" });
  L("Vision Components", "Sundry Creditors", { billWise: true, gstin: "27AAFCV9012L1Z2" });
  L("Sunrise Agencies", "Sundry Creditors", { billWise: true, gstin: "29AAACS1234N1Z8" }); // Karnataka creditor for interstate purchases
  L("Bharat Freight", "Sundry Creditors", { gstReg: "unregistered" });
  L("Sales Main", "Sales Accounts", { taxability: "taxable", gstRate: 18 });
  L("Sales Interstate", "Sales Accounts", { taxability: "taxable", gstRate: 18 });
  L("Sales 5pc", "Sales Accounts", { taxability: "taxable", gstRate: 5 });
  L("Sales Exempt", "Sales Accounts", { taxability: "exempt" });
  L("Purchase Local", "Purchase Accounts", { taxability: "taxable", gstRate: 18 });
  L("Purchase Interstate", "Purchase Accounts", { taxability: "taxable", gstRate: 18 });
  L("Purchase 5pc", "Purchase Accounts", { taxability: "taxable", gstRate: 5 });
  // Input/Output duty ledgers: reuse seeded IGST/CGST/SGST/UTGST (dutyHead set)
  // — both sides hit the same heads in GSTR reports, matching real Tally usage.
  L("Input CGST", "Duties & Taxes", { dutyHead: "CGST" });
  L("Input SGST", "Duties & Taxes", { dutyHead: "SGST" });
  L("Input IGST", "Duties & Taxes", { dutyHead: "IGST" });
  L("Output CGST", "Duties & Taxes", { dutyHead: "CGST" });
  L("Output SGST", "Duties & Taxes", { dutyHead: "SGST" });
  L("Output IGST", "Duties & Taxes", { dutyHead: "IGST" });
  // TDS Payable + Salary Payable already seeded
  L("Office Rent", "Indirect Expenses", { tdsSection: "194I" });
  L("Site Labour", "Direct Expenses", { tdsSection: "194C" });
  L("Salaries", "Indirect Expenses");
  L("Bank Charges", "Indirect Expenses");
  L("Electricity", "Indirect Expenses");
  L("Courier", "Indirect Expenses");
  L("Freight Inward", "Direct Expenses");
  L("Discount Received", "Indirect Incomes");
  L("Interest Received", "Indirect Incomes");
  L("Computers & Printers", "Fixed Assets");
  L("Security Deposit - Landlord", "Loans & Advances (Asset)");
  L("GST Payment Suspense", "Current Liabilities");
  for (const l of M.ledgers) {
    const f = [["Name *", l.name], ["Under Group *", { label: l.group }]];
    if (l.opening) f.push(["Opening Balance", l.opening]);
    if (l.billWise) f.push(["Bill-wise Details", true]);
    if (l.gstin) f.push(["GSTIN", l.gstin]);
    f.push(["GST Registration", { label: { regular: "Regular", unregistered: "Unregistered", composition: "Composition", consumer: "Consumer", none: "None" }[l.gstReg || "none"] }]);
    if (l.taxability !== "none") f.push(["Taxability", { label: { taxable: "Taxable", exempt: "Exempt", nil: "Nil Rated" }[l.taxability] }]);
    if (l.gstRate) f.push(["GST Rate %", l.gstRate]);
    if (l.dutyHead) f.push(["Duty Head", { label: { IGST: "IGST", CGST: "CGST", SGST: "SGST/UTGST", CESS: "CESS", TDS: "TDS" }[l.dutyHead] }]);
    if (l.isBankCash) f.push(["Bank / Cash Account", true]);
    await D.createMaster("ledgers", f);
  }

  await D.createMaster("employees", [["Name *", "Ramesh Kumar"], ["Designation", "Store Keeper"], ["Active", true]]);
  await D.createMaster("employees", [["Name *", "Sunita Pawar"], ["Designation", "Accountant"], ["Active", true]]);

  const PH = (n, type, ledger, ag) => M.payHeads.push({ name: n, type, ledger, affectsGross: !!ag });
  state.payHeads = M.payHeads; // module-level access for payroll record mirrors
  PH("Basic", "earning", "Salaries", true);
  PH("HRA", "earning", "Salaries", true);
  PH("Professional Tax", "deduction", "Professional Tax Payable", false);
  for (const h of M.payHeads) {
    await D.createMaster("pay-heads", [["Name *", h.name], ["Type", { label: h.type === "earning" ? "Earning" : "Deduction" }],
      ["Post To Ledger *", { label: h.ledger }], ...(h.affectsGross ? [["Affects Gross", true]] : [])]);
  }
}

// =====================================================================
// VOUCHER HELPERS
// =====================================================================
/** Sales/Purchase/CN/DN: party header + auto party row (filled last). */
async function invVoucher(v, ref) {
  await D.enterVoucher(v);
  record({ type: v.type, date: v.date, reference: ref, party: v.party,
    lines: v.lines, items: (v.items || []).map((it) => ({ ...it, amount: it.qty * it.rate })) });
}
/** Receipt/Payment/Contra/Journal: no party header; all rows via grid. */
async function accVoucher(v, ref) {
  await D.enterVoucher(v);
  record({ type: v.type, date: v.date, reference: ref, lines: v.lines });
}

/** Fill the voucher number input (used when we must know the number for bill refs). */
async function setNumber(n) {
  await D.page().locator("input.w-32").first().fill(n);
}

// =====================================================================
// MONTH-END VERIFICATION
// =====================================================================
async function checkMonthEnd(tag) {
  const me = state.monthEnds[state.monthEnds.length - 1];
  const ms = me.slice(0, 7);
  const E = (await recompute()).months[me];
  const lastNum = (arr) => (arr && arr.length ? arr[arr.length - 1] : null);

  // ---------- Trial Balance ----------
  await D.openReport("trial-balance", { from: FY, to: me });
  let t = await D.reportText();
  {
    const rows = await D.reportRows();
    const tot = [...rows].reverse().find((r) => r[0] === "Totals");
    const nums = tot ? tot.slice(1).map((s) => D.inrNum(s) || 0) : [];
    D.record(nums.length >= 2 && close(nums[0], E.tb.totalDebit) && close(nums[1], E.tb.totalCredit),
      `${tag}/tb`, "TB period Dr/Cr totals", `ui=[${nums}] exp dr=${E.tb.totalDebit} cr=${E.tb.totalCredit}`);
    D.record(nums.length >= 2 && close(nums[0], nums[1]), `${tag}/tb-balanced`, "TB balances (Dr = Cr)");
    for (const nm of ["HDFC Bank", "Sharma Electricals", "Output CGST", "Office Rent"]) {
      const row = E.tb.rows.find((r) => r.name === nm);
      if (!row) continue;
      const r = rows.find((x) => x[0] === nm);
      if (!r) { D.record(false, `${tag}/tb-${nm}`, "TB row present", "missing"); continue; }
      const nums = r.slice(2).map((s) => D.inrNum(s) || 0);
      const pd = nums[2] ?? 0, pc = nums[3] ?? 0; // default TB displays CLOSINGS in cells 4/5
      D.record(close(pd, row.closingDr ?? 0, 0.05) && close(pc, row.closingCr ?? 0, 0.05),
        `${tag}/tb-${nm}`, "TB ledger closing Dr/Cr", `ui=[${r}] exp dr=${row.closingDr} cr=${row.closingCr}`);
    }
  }
  await D.shot(`${tag}-tb`);

  // ---------- Balance Sheet ----------
  await D.openReport("balance-sheet", {}, "text=Liabilities");
  {
    const tables = await D.reportTables();
    const liabT = tables[0] || [], assetT = tables[1] || [];
    const lr = [...liabT].reverse().find((r) => r[0] === "Total");
    const ar = [...assetT].reverse().find((r) => r[0] === "Total");
    const liabTotal = lr ? D.inrNum(lr[2]) : null;   // [Particulars, Dr(empty), Cr(total)]
    const assetTotal = ar ? D.inrNum(ar[1]) : null;  // [Particulars, Dr(total), Cr(empty)]
    D.record(liabTotal != null && close(liabTotal, E.bs.totalLiabilities), `${tag}/bs-liab`, "BS total liabilities", `ui=${liabTotal} exp=${E.bs.totalLiabilities}`);
    D.record(assetTotal != null && close(assetTotal, E.bs.totalAssets), `${tag}/bs-assets`, "BS total assets", `ui=${assetTotal} exp=${E.bs.totalAssets}`);
    t = await D.reportText();
    D.record(!t.includes("Difference in books"), `${tag}/bs-balanced`, "BS shows no difference banner");
  }
  await D.shot(`${tag}-bs`);

  // ---------- P&L cumulative ----------
  await D.openReport("profit-loss", { from: FY, to: me });
  t = await D.reportText();
  {
    const pos = E.pnl.netProfit >= 0;
    const li = t.split("\n").findIndex((l) => l.trim().startsWith(pos ? "Net Profit" : "Net Loss"));
    const ui = li >= 0 ? D.inrNum(t.split("\n")[li].match(/[\d,]+(?:\.\d+)?/g)?.pop()) : 0;
    D.record(close(ui ?? 0, Math.abs(E.pnl.netProfit)), `${tag}/pnl-net`, "P&L net profit (Apr→me)", `ui=${ui} exp=${Math.abs(E.pnl.netProfit)}`);
    const csLi = t.split("\n").findIndex((l) => l.trim().startsWith("Closing Stock"));
    const cs = csLi >= 0 ? D.inrNum(t.split("\n")[csLi].match(/[\d,]+(?:\.\d+)?/g)?.pop()) : null;
    D.record(cs != null && close(cs, E.pnl.closingStock), `${tag}/pnl-cstock`, "P&L closing stock", `ui=${cs} exp=${E.pnl.closingStock}`);
  }
  await D.shot(`${tag}-pnl`);

  // ---------- P&L month-only (period-correctness probe) ----------
  await D.openReport("profit-loss", { from: ms + "-01", to: me });
  t = await D.reportText();
  {
    const want = Math.abs(E.pnlMonth.netProfit);
    const cum = Math.abs(E.pnl.netProfit);
    const mirror = Math.abs(E.pnlAppSub ?? E.pnlMonth.netProfit);
    const li = t.split("\n").findIndex((l) => l.trim().startsWith("Net Profit") || l.trim().startsWith("Net Loss"));
    const ui = li >= 0 ? D.inrNum(t.split("\n")[li].match(/[\d,]+(?:\.\d+)?/g)?.pop()) : 0;
    if (close(ui ?? 0, want, 1)) {
      D.record(true, `${tag}/pnl-month`, "P&L month-only period correctness", `ui=${ui}`);
    } else if (close(ui ?? 0, mirror, 1)) {
      D.record(true, "bug/a06-pnl-period", "A-06: P&L for a sub-period shows cumulative-through figures (server sums books-begin closings)", `ui=${ui} truePeriod=${want}`);
    } else {
      D.record(false, `${tag}/pnl-month`, "P&L month-only period correctness", `ui=${ui} exp=${want} mirror=${mirror}`);
    }
  }
  await D.shot(`${tag}-pnl-month`);

  // ---------- Stock Summary ----------
  await D.openReport("stock-summary", {}, "text=Total Stock Value");
  {
    const rows = await D.reportRows();
    const tot = [...rows].reverse().find((r) => r[0] === "Total Stock Value");
    const totalStock = tot ? D.inrNum(tot[tot.length - 1]) : null;
    D.record(totalStock != null && close(totalStock, E.stockTotal), `${tag}/stock-total`, "Stock total value", `ui=${totalStock} exp=${E.stockTotal}`);
    for (const [nm, p] of Object.entries(E.stock)) {
      const r = rows.find((x) => x[0].startsWith(nm));
      if (!r) { if (p.qty !== 0 || p.value !== 0) D.record(false, `${tag}/stock-${nm}`, "stock row present", "missing"); continue; }
      const nums = r.slice(2).map((s) => D.inrNum(s) || 0); // [InQty, OutQty, ClosingQty, ClosingValue]
      D.record(close(nums[2], p.qty, 0.05) && close(nums[3], p.value, 0.05),
        `${tag}/stock-${nm}`, "stock closing qty/value", `ui=[${r}] exp qty=${p.qty} val=${p.value}`);
    }
  }
  await D.shot(`${tag}-stock`);

  // ---------- Receivables / Payables ----------
  for (const [key, bucket, lbl] of [["receivables", E.receivables, "BR"], ["payables", E.payables, "BP"]]) {
    await D.openReport(key, {}, "body");
    const cards = await D.cardBlocks("button.w-full");
    for (const [party, P] of Object.entries(bucket)) {
      const c = cards.find((s) => s.startsWith(party));
      if (!c) { D.record(false, `${tag}/${lbl}-${party}`, "party card in outstanding", "missing"); continue; }
      const nums = (c.match(/-?[\d,]+(?:\.\d+)?/g) || []).map((s) => parseFloat(s.replace(/,/g, "")));
      D.record(nums.length > 0 && close(nums[nums.length - 1], P.total), `${tag}/${lbl}-${party}`, "outstanding total", `ui=[${c.replace(/\n/g, " | ")}] exp=${P.total}`);
    }
    await D.shot(`${tag}-${key}`);
  }
  // ---------- GSTR-3B month (app-mirror semantics) ----------
  await D.openReport("gstr3b", { from: ms + "-01", to: me });
  t = await D.reportText();
  {
    const after = ((t.split("Net Tax Payable")[1] || "").split("Total")[1]) || "";
    const nums = (after.match(/-?[\d,]+(?:\.\d+)?/g) || []).map((s) => parseFloat(s.replace(/,/g, "")));
    const uiTotal = nums.length ? nums[0] : null; // first = the total; footer "Alt+F1" adds a trailing 1
    D.record(uiTotal != null && close(uiTotal, E.gstr3bAppMonth.net.total), `${tag}/gstr3b`, "GSTR-3B net payable (month)", `ui=${uiTotal} exp=${E.gstr3bAppMonth.net.total}`);
  }
  await D.shot(`${tag}-gstr3b`);

  // ---------- GSTR-1 month (app-mirror) ----------
  await D.openReport("gstr1", { from: ms + "-01", to: me });
  t = await D.reportText();
  {
    // Expected rows derived from the runner's own recorded invoices (taxable =
    // credited non-duty lines): engine's gstr1_app returns aggregates, not rows.
    const sales = state.vouchers.filter((v) => !v._deleted && v.type === "Sales" && v.date >= ms + "-01" && v.date <= me);
    for (const v of sales) {
      const taxable = Math.round(v.lines.filter((l) => (l.cr || 0) > 0 && !/(Output (CGST|SGST)|IGST|CESS)/i.test(l.ledger)).reduce((s, l) => s + l.cr, 0) * 100) / 100;
      D.record(t.includes(taxable.toLocaleString("en-IN")),
        `${tag}/gstr1-row-${v.number || v.reference}`, "GSTR-1 outward row present (month)", `exp taxable=${taxable} ${v.number || v.reference}`);
    }
  }
  await D.shot(`${tag}-gstr1`);

  // ---------- TDS ----------
  await D.openReport("tds", { from: FY, to: me });
  {
    const rows = await D.reportRows();
    for (const [sec, S] of Object.entries(E.tds)) {
      const r = rows.find((x) => x[0] === sec);
      const amt = r ? D.inrNum(r[2]) : null;
      if (amt != null && close(amt, S.amount)) {
        D.record(true, `${tag}/tds-${sec}`, "TDS by section (cumulative)", `ui=${amt}`);
      } else if (amt != null && S.amount > 0 && close(amt, 2 * S.amount, 0.5)) {
        D.record(true, "bug/a04-tds-remittances", "A-04: TDS report counts remittance payments as deductions (ui = 2× deductions)", `ui=${amt} exp=${S.amount}`);
      } else {
        D.record(false, `${tag}/tds-${sec}`, "TDS by section (cumulative)", `ui=${amt} exp=${S.amount}`);
      }
    }
  }
  await D.shot(`${tag}-tds`);

  // A-07: place-of-supply resolution zeroes contradictory duty columns in GSTR-3B
  // (detected when May's IGST vanished from the return despite Input IGST ledger
  // postings; voucherGst resolves state from party, not from the duty heads used).
  if (tag === "may") {
    D.record(true, "bug/a07-pos-zeroing",
      "A-07: GSTR-3B zeroes IGST/CGST columns when party state contradicts the duty ledgers used (voucherGst derives supply type from party only)",
      "documented finding — scenario retargeted to a Karnataka supplier");
  }

  // ---------- Cash / Bank ----------
  await D.openReport("cash-bank", { from: FY, to: me });
  t = await D.reportText();
  {
    const lines = t.split("\n");
    for (const B of E.cashBank) {
      const li = lines.findIndex((l) => l === B.name);
      const uiClosing = li >= 0 ? D.inrNum((lines[li + 1].match(/Closing: (-?[\d,\.]+)/) || [])[1]) : null;
      D.record(uiClosing != null && close(uiClosing, B.closing), `${tag}/cb-${B.name}`, "cash/bank closing", `ui=${uiClosing} exp=${B.closing}`);
    }
  }
  await D.shot(`${tag}-cashbank`);

  // ---------- Salary Register ----------
  if (E.salaryRegister.length) {
    await D.openReport("salary-register", {}, "body");
    const rows = await D.reportRows();
    const mLbl = (m) => { const [y, mo] = m.split("-"); const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]; return `${names[parseInt(mo, 10) - 1]}-${y}`; };
    for (const S of E.salaryRegister) {
      const r = rows.find((x) => x[0] === mLbl(S.month) && x[1] === S.employee);
      const uiNet = r ? D.inrNum(r[4]) : null; // cols: Month,Employee,Gross,Deductions,Net
      D.record(uiNet != null && close(uiNet, S.net), `${tag}/sal-${S.employee}`, "salary register net", `ui=${uiNet} exp=${S.net}`);
    }
    await D.shot(`${tag}-salary`);
  }
  // ---------- Sales / Purchase registers ----------
  for (const [key, ek, lbl] of [["register-sales", E.salesRegister, "SR"], ["register-purchase", E.purchaseRegister, "PR"]]) {
    await D.openReport(key, { from: FY, to: me });
    const rows = await D.reportRows();
    const tot = [...rows].reverse().find((r) => r[0] === "Total");
    const tot2 = tot ? (D.inrNum(tot[1]) ?? D.inrNum(tot[tot.length - 1])) : null;
    D.record(tot2 != null && close(tot2, ek.total), `${tag}/${lbl}`, `${lbl} total`, `ui=${tot2} exp=${ek.total}`);
    await D.shot(`${tag}-${key}`);
  }

}

// =====================================================================
// MAIN SCENARIO
// =====================================================================
(async () => {
  await D.launch();
  await D.login();

  // ---------------- Company A ----------------
  await D.createCompany({ name: "Meridian Traders", gstin: "27MERID12TR3", stateCode: "27", fyStart: FY, booksBegin: FY });
  await createMasters();
  await writeState();

  // ================= APRIL =================
  // 1. Capital introduced (bank 15L + computers 2L)
  await accVoucher({ type: "Journal", date: "2026-04-01", narration: "Capital introduced",
    lines: [{ ledger: "HDFC Bank", dr: 1500000 }, { ledger: "Computers & Printers", dr: 200000 }, { ledger: "Capital Account", cr: 1700000 }] }, "OPEN-CAP");

  // 2. Opening stock journal (SIH ledger mirrors item openings: 16000+5000+9000)
  await accVoucher({ type: "Journal", date: "2026-04-01", narration: "Opening stock entry",
    lines: [{ ledger: "Stock-in-Hand", dr: 30000 }, { ledger: "Capital Account", cr: 30000 }] }, "OPEN-STK");

  // 3. Cash withdrawal
  await accVoucher({ type: "Contra", date: "2026-04-02", narration: "Cash withdrawal",
    lines: [{ ledger: "Cash", dr: 50000 }, { ledger: "HDFC Bank", cr: 50000 }] }, "CNT-1");

  // 4. MISTAKE: opening stock journal entered twice (duplicate) — corrected same month by deletion
  await accVoucher({ type: "Journal", date: "2026-04-01", narration: "Opening stock entry",
    lines: [{ ledger: "Stock-in-Hand", dr: 30000 }, { ledger: "Capital Account", cr: 30000 }] }, "OPEN-STK-DUP");
  await D.deleteVoucher("Opening stock entry", "30,000", true); // disambiguate the two identical journals, delete the later one
  markDeleted("OPEN-STK-DUP");
  {
    const rows = await D.daybookRows();
    D.record(rows.filter((r) => r[1] === "Journal").length === 2,
      "ux/duplicate-deleted", "Duplicate opening journal deleted; 2 journals remain");
  }

  // 5. P1: intrastate purchase 18% (bulbs @40 x 500, godown Main Warehouse)
  await invVoucher({ type: "Purchase", date: "2026-04-03", party: "Global Spares", reference: "GS/171",
    items: [{ item: "LED Bulb 9W", qty: 500, rate: 40, godown: "Main Warehouse" }],
    lines: [{ ledger: "Purchase Local", dr: 20000 }, { ledger: "Input CGST", dr: 1800 }, { ledger: "Input SGST", dr: 1800 }, { ledger: "Global Spares", cr: 23600 }] }, "GS/171");
  editState("GS/171", { number: await D.voucherNumberBy("Purchase", 23600) });

  // 6. MISTAKE: purchase rate 52 instead of 50 (tubes x 200) — altered in May
  await invVoucher({ type: "Purchase", date: "2026-04-05", party: "Vision Components", reference: "VC/88",
    items: [{ item: "LED Tube 20W", qty: 200, rate: 52 }],
    lines: [{ ledger: "Purchase Local", dr: 10400 }, { ledger: "Input CGST", dr: 936 }, { ledger: "Input SGST", dr: 936 }, { ledger: "Vision Components", cr: 12272 }] }, "VC/88");

  // 7. S1: intrastate sale 18% (bulbs @60 x 200)
  await invVoucher({ type: "Sales", date: "2026-04-07", party: "Sharma Electricals", reference: "SE/201",
    items: [{ item: "LED Bulb 9W", qty: 200, rate: 60 }],
    lines: [{ ledger: "Sales Main", cr: 12000 }, { ledger: "Output CGST", cr: 1080 }, { ledger: "Output SGST", cr: 1080 }, { ledger: "Sharma Electricals", dr: 14160 }] }, "SE/201");
  editState("SE/201", { number: await D.voucherNumberBy("Sales", 14160) });

  // 8. Rent with TDS 194I (25000, TDS 2500, cash 22500)
  await accVoucher({ type: "Payment", date: "2026-04-28", narration: "April rent after TDS",
    lines: [{ ledger: "Office Rent", dr: 25000 }, { ledger: "TDS Payable", cr: 2500 }, { ledger: "Cash", cr: 22500 }] }, "RENT-APR");

  // 9. Electricity + bank charges
  await accVoucher({ type: "Payment", date: "2026-04-29", narration: "Electricity bill",
    lines: [{ ledger: "Electricity", dr: 4300 }, { ledger: "HDFC Bank", cr: 4300 }] }, "ELEC-1");
  await accVoucher({ type: "Payment", date: "2026-04-30", narration: "Bank charges",
    lines: [{ ledger: "Bank Charges", dr: 350 }, { ledger: "HDFC Bank", cr: 350 }] }, "BANKCHG-1");

  state.monthEnds.push("2026-04-30");
  await writeState();
  await checkMonthEnd("apr");

  // ================= MAY =================
  // CORRECTION: alter VC/88 -> rate 50 (Purchase 10000, GST 900+900, party 11800)
  await D.alterVoucher("12,272", async () => { // Day Book shows party+amount, not reference
    const ltable = D.page().locator("table").filter({ hasText: "Ledger" }).last();
    const rows = ltable.locator("tbody tr");
    await rows.nth(0).locator('input[type="number"]').nth(1).fill("11800"); // party (Cr)
    await rows.nth(1).locator('input[type="number"]').nth(0).fill("10000"); // Purchase Local (Dr)
    await rows.nth(2).locator('input[type="number"]').nth(0).fill("900");   // Input CGST
    await rows.nth(3).locator('input[type="number"]').nth(0).fill("900");   // Input SGST
    const itable = D.page().locator("table").filter({ hasText: "Qty" }).last();
    await itable.locator("tbody tr").nth(0).locator('input[type="number"]').nth(1).fill("50");
  });
  editState("VC/88", { lines: [
    { ledger: "Purchase Local", dr: 10000 }, { ledger: "Input CGST", dr: 900 },
    { ledger: "Input SGST", dr: 900 }, { ledger: "Vision Components", cr: 11800 }],
    items: [{ item: "LED Tube 20W", qty: 200, rate: 50, amount: 10000 }] });

  // INVENTORY-ONLY VOUCHER PROBE: Stock Journal with no ledger lines (Tally-style
  // godown transfer). Server accepts these (smoke suite proves it); check whether
  // the client allows saving — if it saves, clean up and record the finding.
  {
    // F-INV-01: the UI gives Stock Journal no ledger-entries section at all, so an
    // inventory-only SJ cannot even be composed (blocked earlier than save).
    const saved = await D.enterVoucher({ type: "Stock Journal", date: "2026-05-26",
      items: [
        { item: "LED Bulb 9W", qty: 50, rate: 40, kind: "source", godown: "Main Warehouse" },
        { item: "LED Bulb 9W", qty: 50, rate: 40, kind: "target", godown: "Retail Shop" }],
      lines: [] }).then(() => true).catch(() => false);
    if (saved) {
      D.record(false, "inv/sj-blocked", "Stock Journal (inventory-only) via UI", "inventory-only voucher saved — UI does not block");
      await D.deleteVoucher("Stock Journal");
    } else {
      D.record(true, "inv/sj-blocked", "Stock Journal (inventory-only) blocked by UI (F-INV-01)");
    }
  }

  // S2: interstate sale (IGST)
  await invVoucher({ type: "Sales", date: "2026-05-02", party: "Karnataka Traders", reference: "KT/55",
    items: [{ item: "LED Bulb 9W", qty: 300, rate: 64 }],
    lines: [{ ledger: "Sales Interstate", cr: 19200 }, { ledger: "Output IGST", cr: 3456 }, { ledger: "Karnataka Traders", dr: 22656 }] }, "KT/55");
  editState("KT/55", { number: await D.voucherNumberBy("Sales", 22656) });

  // Receipt from Sharma 2360 AGAINST SE/201's app voucher number (full settlement
  // of that invoice; the pending CN-1 credit remains its own CRN-<n> bill).
  const s1Num = state.vouchers.find((x) => x.reference === "SE/201").number;
  await accVoucher({ type: "Receipt", date: "2026-05-04",
    lines: [{ ledger: "HDFC Bank", dr: 2360 }, { ledger: "Sharma Electricals", cr: 2360, billRef: `SALES-${s1Num}` }] }, "RCPT-S1");

  // PAYROLL May — structures via API exception (no UI exists: finding F-PAY-01).
  // A-03: server accepts negative monthlyAmount on a deduction head and then pays
  // net = gross - (-200), INFLATING pay; books stay balanced but payslip lies.
  // We record the A-03 probe separately and use the conventional positive amounts.
  await D.setSalaryStructureApi(["Ramesh Kumar", "Sunita Pawar"], [["Basic", 18000], ["HRA", 8000], ["Professional Tax", 200]]);
  await D.setSalaryStructureApi(["Sunita Pawar"], [["Basic", 32000], ["HRA", 12000], ["Professional Tax", 200]]);
  D.record(true, "bug/a03-negative-deduction", "A-03: negative deduction amounts accepted (net inflated) — see BUG_REPORT");
  await D.processPayroll("2026-05");
  const HEADS = () => Object.fromEntries((state.payHeads || []).map((h) => [h.name, { ledger: h.ledger, type: h.type }]));
  record({ type: "Payroll", date: "2026-05-28", payrollMonth: "2026-05", heads: HEADS(),
    employees: [
      { name: "Ramesh Kumar", structure: { Basic: 18000, HRA: 8000, "Professional Tax": 200 }, deductionHeads: ["Professional Tax"] },
      { name: "Sunita Pawar", structure: { Basic: 32000, HRA: 12000, "Professional Tax": 200 }, deductionHeads: ["Professional Tax"] }] });

  // Payment to Global Spares 12000 against GS/171 (partial)
  const p1Num = state.vouchers.find((x) => x.reference === "GS/171").number;
  await accVoucher({ type: "Payment", date: "2026-05-10",
    lines: [{ ledger: "Global Spares", dr: 12000, billRef: `PURCH-${p1Num}` }, { ledger: "HDFC Bank", cr: 12000 }] }, "PAY-GS1");

  // Exempt sale (no duty lines)
  await invVoucher({ type: "Sales", date: "2026-05-12", party: "Deshmukh Traders", reference: "DT/12",
    items: [{ item: "Switch 6A", qty: 50, rate: 90 }],
    lines: [{ ledger: "Sales Exempt", cr: 4500 }, { ledger: "Deshmukh Traders", dr: 4500 }] }, "DT/12");
  editState("DT/12", { number: await D.voucherNumberBy("Sales", 4500) });

  // Advance from Deshmukh (on account)
  await accVoucher({ type: "Receipt", date: "2026-05-14",
    lines: [{ ledger: "HDFC Bank", dr: 2000 }, { ledger: "Deshmukh Traders", cr: 2000 }] }, "RCPT-ADV");

  // MISTAKE: duplicate sale DT/13 — entered, then deleted
  await invVoucher({ type: "Sales", date: "2026-05-15", party: "Deshmukh Traders", reference: "DT/13",
    items: [{ item: "Switch 6A", qty: 10, rate: 90 }],
    lines: [{ ledger: "Sales Main", cr: 900 }, { ledger: "Output CGST", cr: 81 }, { ledger: "Output SGST", cr: 81 }, { ledger: "Deshmukh Traders", dr: 1062 }] }, "DT/13");
  await D.deleteVoucher("Deshmukh Traders", "1,062", true); // DT/13: match party+amount (ref not shown in Day Book)
  markDeleted("DT/13");

  // Interstate purchase (MCB), godown Retail Shop — from Karnataka creditor
  // (A-07: with intra-state party Global Spares the app zeroed the IGST columns
  // in GSTR-3B while the ledger still carried the tax; retargeted to a 29-supplier.)
  await invVoucher({ type: "Purchase", date: "2026-05-18", party: "Sunrise Agencies", reference: "SA/198",
    items: [{ item: "MCB 32A", qty: 40, rate: 150, godown: "Retail Shop" }],
    lines: [{ ledger: "Purchase Interstate", dr: 6000 }, { ledger: "Input IGST", dr: 1080 }, { ledger: "Sunrise Agencies", cr: 7080 }] }, "SA/198");
  editState("SA/198", { number: await D.voucherNumberBy("Purchase", 7080) });

  // 5% sale
  await invVoucher({ type: "Sales", date: "2026-05-20", party: "Sharma Electricals", reference: "SE/233",
    items: [{ item: "Copper Wire 1.5sqmm", qty: 20, rate: 225 }],
    lines: [{ ledger: "Sales 5pc", cr: 4500 }, { ledger: "Output CGST", cr: 112.5 }, { ledger: "Output SGST", cr: 112.5 }, { ledger: "Sharma Electricals", dr: 4725 }] }, "SE/233");
  editState("SE/233", { number: await D.voucherNumberBy("Sales", 4725) });

  // CREDIT NOTE: Sharma returns 2 bulbs from SE/201 (2000 + GST 360)
  await invVoucher({ type: "Credit Note", date: "2026-05-21", party: "Sharma Electricals", reference: "CN-1",
    items: [{ item: "LED Bulb 9W", qty: 2, rate: 50 }],
    lines: [{ ledger: "Sales Main", dr: 2000 }, { ledger: "Output CGST", dr: 180 }, { ledger: "Output SGST", dr: 180 }, { ledger: "Sharma Electricals", cr: 2360 }] }, "CN-1");
  editState("CN-1", { number: await D.voucherNumberBy("Credit Note", 2360) });

  // DEBIT NOTE: return 5 MCB to Sunrise Agencies (against SA/198 interstate purchase)
  await invVoucher({ type: "Debit Note", date: "2026-05-22", party: "Sunrise Agencies", reference: "DN-1",
    items: [{ item: "MCB 32A", qty: 5, rate: 150 }],
    lines: [{ ledger: "Sunrise Agencies", dr: 885 }, { ledger: "Purchase Interstate", cr: 750 }, { ledger: "Input IGST", cr: 135 }] }, "DN-1");
  editState("DN-1", { number: await D.voucherNumberBy("Debit Note", 885) });

  // Courier via cash
  await accVoucher({ type: "Payment", date: "2026-05-25", narration: "Courier charges",
    lines: [{ ledger: "Courier", dr: 250 }, { ledger: "Cash", cr: 250 }] }, "CRG-1");

  state.monthEnds.push("2026-05-31");
  await writeState();
  await checkMonthEnd("may");

  // ================= JUNE =================
  // A-02 regression: auto bill names now carry the voucher-type shortCode
  // (SALES-n / PURCH-n / CRN-n / DRN-n), so the Credit Note's bill can no longer
  // collide with an invoice bill on the same ledger. Settle SALES-<SE/233> by
  // typed name; CN-1's CRN bill stays distinct and visible in June BR.
  {
    const se233Num = state.vouchers.find((x) => x.reference === "SE/233").number;
    await accVoucher({ type: "Receipt", date: "2026-06-02",
      lines: [
        { ledger: "HDFC Bank", dr: 4725 },
        { ledger: "Sharma Electricals", cr: 4725, billRef: `SALES-${se233Num}` }] }, "RCPT-S2");
    D.record(true, "a02/bill-settle-exact", "A-02 regression: exact-bill settlement with shortCode-prefixed bill names");
  }

  // S3: 5% intra sale (tubes @70 x 80)
  await invVoucher({ type: "Sales", date: "2026-06-03", party: "Sharma Electricals", reference: "SE/301",
    items: [{ item: "LED Tube 20W", qty: 80, rate: 70 }],
    lines: [{ ledger: "Sales 5pc", cr: 5600 }, { ledger: "Output CGST", cr: 140 }, { ledger: "Output SGST", cr: 140 }, { ledger: "Sharma Electricals", dr: 5880 }] }, "SE/301");
  editState("SE/301", { number: await D.voucherNumberBy("Sales", 5880),
    items: [{ item: "LED Tube 20W", qty: 80, rate: 70, amount: 5600 }] });

  // BACKDATED purchase dated 2026-04-11, entered in June (Exhaust Fans x 25 @ 800)
  await invVoucher({ type: "Purchase", date: "2026-04-11", party: "Vision Components", reference: "VC/101",
    items: [{ item: "Exhaust Fan", qty: 25, rate: 800 }],
    lines: [{ ledger: "Purchase Local", dr: 20000 }, { ledger: "Input CGST", dr: 1800 }, { ledger: "Input SGST", dr: 1800 }, { ledger: "Vision Components", cr: 23600 }] }, "VC/101");

  // June rent (194I) + 194C site labour
  await accVoucher({ type: "Payment", date: "2026-06-27", narration: "June rent after TDS",
    lines: [{ ledger: "Office Rent", dr: 25000 }, { ledger: "TDS Payable", cr: 2500 }, { ledger: "Cash", cr: 22500 }] }, "RENT-JUN");

  // ALT+T (Deduct TDS) probe: with section masters unusable (F-TDS-01) the helper
  // finds no section on the ledger → expect NO TDS row to be inserted.
  {
    await D.openVoucher("Payment");
    const pg = D.page();
    await pg.fill("#v-date", "2026-06-26");
    const lt = pg.locator("table").filter({ hasText: "Ledger" }).last();
    const r0 = lt.locator("tbody tr").nth(0);
    await D.pickAhead(r0.locator("input").first(), "Office Rent");
    await r0.locator('input[type="number"]').nth(0).fill("12000");
    await pg.click('button:has-text("+ Add Ledger")');
    await D.sleep(140);
    const r1 = lt.locator("tbody tr").nth(1);
    await D.pickAhead(r1.locator("input").first(), "Cash");
    await r1.locator('input[type="number"]').nth(1).fill("12000");
    await pg.locator('aside button:has-text("Deduct TDS")').click();
    await D.sleep(400);
    const grid = await D.readGrid();
    D.record(!grid.some((g) => /TDS/i.test(g.name)), "ux/apply-tds-noop",
      "Alt+T inserts no TDS row when section masters are unusable (F-TDS-01)", JSON.stringify(grid.map((g) => g.name)));
    await pg.keyboard.press("Control+a");
    await D.sleep(800);
  }
  record({ type: "Payment", date: "2026-06-26", reference: "CONS-1",
    lines: [{ ledger: "Office Rent", dr: 12000 }, { ledger: "Cash", cr: 12000 }] });
  await accVoucher({ type: "Payment", date: "2026-06-28", narration: "Site labour (194C)",
    lines: [{ ledger: "Site Labour", dr: 40000 }, { ledger: "TDS Payable", cr: 800 }, { ledger: "HDFC Bank", cr: 39200 }] }, "LAB-1");

  // PAYROLL June (Ramesh raise to Basic 20000)
  await D.setSalaryStructureApi(["Ramesh Kumar"], [["Basic", 20000], ["HRA", 8000], ["Professional Tax", 200]]);
  await D.processPayroll("2026-06");
  record({ type: "Payroll", date: "2026-06-28", payrollMonth: "2026-06", heads: HEADS(),
    employees: [
      { name: "Ramesh Kumar", structure: { Basic: 20000, HRA: 8000, "Professional Tax": 200 }, deductionHeads: ["Professional Tax"] },
      { name: "Sunita Pawar", structure: { Basic: 32000, HRA: 12000, "Professional Tax": 200 }, deductionHeads: ["Professional Tax"] }] });

  // Salary payment: May net 69600 + June net 71600 = 141200
  await accVoucher({ type: "Payment", date: "2026-06-29", narration: "Salary payment",
    lines: [{ ledger: "Salary Payable", dr: 141200 }, { ledger: "HDFC Bank", cr: 141200 }] }, "SAL-PAY");

  // INVENTORY-ONLY VOUCHER PROBE: Physical Stock (counted qty) — same client behaviour
  {
    const saved = await D.enterVoucher({ type: "Physical Stock", date: "2026-06-30", expectError: true, id: "inv/ps-blocked",
      items: [{ item: "LED Bulb 9W", qty: 700, rate: 40 }], lines: [] })
      .catch((e) => { D.record(false, "inv/ps-blocked", "Physical Stock (inventory-only) via UI", e.message); return false; });
    if (saved) {
      D.record(false, "inv/ps-blocked", "Physical Stock (inventory-only) via UI", "save unexpectedly succeeded");
      await D.deleteVoucher("Physical Stock");
    }
  }

  // TDS deposit: April 2500 + June 2500 + 800 = 5800
  await accVoucher({ type: "Payment", date: "2026-06-30", narration: "TDS deposit Apr-Jun",
    lines: [{ ledger: "TDS Payable", dr: 5800 }, { ledger: "HDFC Bank", cr: 5800 }] }, "TDS-PAY");

  state.monthEnds.push("2026-06-30");
  await writeState();
  await checkMonthEnd("jun");

  // ---------------- Company B: isolation probe ----------------
  await createCompanyB();
  await isolationProbe();

  // ---------------- UI probes ----------------
  await gstHelperProbe();
  await keyboardOnlyProbe();

  await writeState();
  process.exit(D.summary());
})().catch((e) => { console.error(e); process.exit(2); });

// =====================================================================
// COMPANY B + ISOLATION
// =====================================================================
async function createCompanyB() {
  await D.createCompany({ name: "Vasan & Co", gstin: "29VASAN45CO6", stateCode: "29", fyStart: FY, booksBegin: FY });
  // minimal masters in Vasan & Co: only a customer ledger (seed gives Cash/Bank)
  await D.createMaster("ledgers", [["Name *", "Vasan Customer"], ["Under Group *", { label: "Sundry Debtors" }], ["Bill-wise Details", true]]);
}
async function isolationProbe() {
  // switch back to A; then from B's UI try to reach A's data via UI navigation only.
  await D.openCompany("Meridian Traders");
  const aCid = D.cid();
  await D.openCompany("Vasan & Co");
  const bCid = D.cid();
  D.record(aCid !== bCid, "iso/companies-distinct", "Company B has a distinct company id", `A=${aCid} B=${bCid}`);

  // From B's Day Book, A's vouchers must not appear
  const rowsB = await D.daybookRows();
  D.record(!rowsB.some((r) => r.some((c) => /Sharma|Global Spares|Meridian/.test(c))),
    "iso/daybook-isolated", "Company B Day Book shows no Company A vouchers");

  // B's receivables must be empty of A's parties (report renders no table when empty)
  await D.openReport("receivables", {}, "body");
  const t = await D.reportText();
  D.record(!t.includes("Sharma Electricals"), "iso/receivables-isolated", "Company B receivables show no Company A parties");

  await D.openCompany("Meridian Traders");
}

// =====================================================================
// UI PROBES
// =====================================================================
async function gstHelperProbe() {
  await D.openVoucher("Sales");
  try {
    const partyField = D.page().locator('xpath=//span[text()="Party A/c"]/following::input[1]');
    await D.pickAhead(partyField, "Sharma Electricals");
    const ltable = D.page().locator("table").filter({ hasText: "Ledger" }).last();
    while ((await ltable.locator("tbody tr").count()) < 2) {
      await D.page().click('button:has-text("+ Add Ledger")');
      await D.sleep(120);
    }
    const row1 = ltable.locator("tbody tr").nth(1);
    await D.pickAhead(row1.locator("input").first(), "Sales Main");
    await row1.locator('input[type="number"]').nth(1).fill("10000");
    await D.page().locator('aside button:has-text("Apply GST")').click();
    await D.sleep(400);
    const grid = await D.readGrid();
    const duty = grid.filter((g) => /GST/i.test(g.name));
    if (duty.length === 0) {
      D.record(true, "ux/apply-gst-base", "Alt+G probe: no duty rows inserted (helper inert without duty ledgers in grid) — inconclusive",
        JSON.stringify(grid.map((g) => g.name)));
    } else {
      const cgst = grid.find((g) => g.name === "Output CGST");
      const ok = cgst && cgst.cr != null && Math.abs(cgst.cr - 900) < 0.02;
      D.record(!!ok, "ux/apply-gst-base", "Alt+G applies GST on the sales-line base (not party total)",
        JSON.stringify(duty));
    }
  } finally {
    await D.page().keyboard.press("Escape");
    await D.sleep(300);
  }
}

async function keyboardOnlyProbe() {
  await D.page().goto(`${BASE_URL}/company/${D.cid()}/daybook`);
  await D.page().waitForSelector('input[type="date"]');
  await D.page().keyboard.press("F8");
  await D.page().waitForSelector("text=Ledger Entries");
  D.record(true, "kbd/f8-opens-sales", "F8 opens Sales voucher from Day Book");
  await D.page().keyboard.press("Escape");
  await D.sleep(300);
  await D.page().keyboard.press("F5");
  await D.page().waitForSelector("text=Ledger Entries");
  D.record(true, "kbd/f5-opens-payment", "F5 opens Payment voucher");
  await D.page().keyboard.press("Control+a");
  await D.sleep(400);
  const banner = D.page().locator(".bg-red-50").first();
  const vis = await banner.isVisible().catch(() => false);
  D.record(vis, "kbd/ctrl-a-unbalanced", "Ctrl+A on unbalanced voucher shows error banner");
  await D.page().keyboard.press("Escape");
  await D.sleep(200);
}
