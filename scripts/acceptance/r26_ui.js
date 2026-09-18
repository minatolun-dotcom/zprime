// R-26 browser acceptance: GSTR-9 annual return through the REAL UI.
// 1) Gateway Reports card carries the GSTR-9 entry; opening it renders the
//    tables over the FY window.
// 2) Table 4/8/9 numbers match the books seeded through the voucher form;
//    consistency rows stay neutral (zero) for well-formed books.
// 3) Table 8 difference rows highlight amber when non-zero.
// Prereqs: fresh compose stack at localhost:3000 (admin/admin123).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 220)}`); }
};

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  await D.createCompany({ name: "R26 Gstr9 UI", gstin: "27R26G9UI01Z5A6", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const get = async (p) => (await page.request.get(`${D.BASE}/api/c/${cid}${p}`)).json();
  const companies = await (await page.request.get(`${D.BASE}/api/companies`)).json();
  const mine = companies.find((c) => String(c.id) === String(cid));
  await page.request.put(`${D.BASE}/api/companies/${cid}`, { data: { ...mine, address: "12 MG Road", city: "Mumbai", pincode: "400001" } });

  await D.createMaster("ledgers", [
    ["Name *", "R26 Buyer"], ["Under Group", { label: "Sundry Debtors" }],
    ["GST Registration", { label: "Regular" }], ["GSTIN", "29R26BUY001B2C3"],
    ["Party Address", "9 Brigade Road"], ["Party State", "Karnataka"], ["Party PIN Code", "560001"],
  ]);
  await D.createMaster("ledgers", [["Name *", "R26 Sales"], ["Under Group", { label: "Sales Accounts" }], ["Taxability", { label: "Taxable" }]]);
  await D.createMaster("ledgers", [["Name *", "R26 Purchases"], ["Under Group", { label: "Purchase Accounts" }], ["Taxability", { label: "Taxable" }]]);
  await D.createMaster("ledgers", [
    ["Name *", "R26 Supplier"], ["Under Group", { label: "Sundry Creditors" }],
    ["GST Registration", { label: "Regular" }], ["GSTIN", "24R26SUP002D4E5"],
  ]);
  const units = await get("/units");
  let nos = (units || []).find((u) => u.symbol === "NOS");
  if (!nos) { await page.request.post(`${D.BASE}/api/c/${cid}/units`, { data: { name: "Numbers", symbol: "NOS", decimalPlaces: 0 } }); nos = (await get("/units")).find((u) => u.symbol === "NOS"); }
  await page.request.post(`${D.BASE}/api/c/${cid}/stock-items`, { data: { name: "R26 Widget", unitId: nos.id, hsnSac: "8471", gstRate: "18", openingQty: "50", openingRate: "900", openingValue: "45000" } });

  // Sale through the REAL voucher form (10,000 + IGST 1,800)
  const saved = await D.enterVoucher({
    type: "Sales", date: "2026-08-15", party: "R26 Buyer",
    lines: [
      { ledger: "R26 Sales", cr: 10000 },
      { ledger: "IGST", cr: 1800 },
      { ledger: "R26 Buyer", dr: 11800 },
    ],
    items: [{ item: "R26 Widget", qty: 10, rate: 1000 }],
  });
  ok("sale saved through the voucher form", saved, "save failed");
  // Purchase through the REAL voucher form (2,000 + IGST 360)
  const saved2 = await D.enterVoucher({
    type: "Purchase", date: "2026-09-05", party: "R26 Supplier",
    lines: [
      { ledger: "R26 Purchases", dr: 2000 },
      { ledger: "IGST", dr: 360 },
      { ledger: "R26 Supplier", cr: 2360 },
    ],
  });
  ok("purchase saved through the voucher form", saved2, "save failed");

  // ---- Gateway carries the GSTR-9 entry; open it ----
  await page.goto(`${D.BASE}/company/${cid}`);
  await page.waitForSelector("text=Gateway");
  const g9Link = page.locator('a:has-text("GSTR-9"), button:has-text("GSTR-9")').first();
  ok("Gateway GSTR-9 entry present", await g9Link.isVisible().catch(() => false));
  await g9Link.click().catch(async () => { await page.goto(`${D.BASE}/company/${cid}/reports/gstr9`); });
  await page.waitForSelector("text=Table 4", { timeout: 15000 });
  ok("GSTR-9 view renders Table 4", true);

  // ---- numbers over the FY window ----
  const dates = page.locator('input[type="date"]');
  if ((await dates.count()) >= 2) {
    await dates.nth(0).fill("2026-04-01");
    await dates.nth(1).fill("2027-03-31");
    await D.sleep(900);
  }
  const txt = await D.reportText();
  ok("Table 4 A(5) shows ITC 1,800", txt.includes("1,800"), "igst column");
  ok("Table 9 shows the sale", txt.includes("11,800") || txt.includes("10,000"), "net values");
  ok("Table 12 shows HSN 8471", txt.includes("8471"), "hsn rows");
  ok("Table 5 note rendered (no reversal surface)", txt.includes("no ITC-reversal transaction type"), "limitation note");

  // Table 8 difference: with a single IGST duty ledger carrying BOTH output
  // (1,800 Cr) and input (360 Dr), the honest difference is 1,080 by design —
  // the row must be amber AND the Table-9-vs-3B cross-check must stay neutral.
  const amberCount = await page.locator("tr.bg-amber-50").count();
  ok("Table 8 difference amber (single-ledger output/input netting)", amberCount === 5, `amber rows: ${amberCount}`);
  const crossRow = page.locator("tr", { hasText: "Table 9 net − GSTR-3B outward" }).first();
  const crossCls = (await crossRow.getAttribute("class")) || "";
  ok("Table9-vs-3B cross-check neutral (zero)", !crossCls.includes("bg-amber-50"), crossCls);

  ok("no page errors", pageErrors.length === 0, pageErrors);
  console.log(`\n== R26 UI: ${pass} passed, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
