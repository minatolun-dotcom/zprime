// R-24 browser acceptance: e-invoice payload generation through the REAL UI.
// 1) A GST sale is entered through the voucher form (party + item + HSN).
// 2) The ledger form carries the new Party PIN Code field.
// 3) GSTR-1 B2B rows expose the "e-inv" action; clicking it downloads a valid
//    NIC v1.01 JSON (event.download fired) with INV/B2B + buyer pincode.
// 4) Stripping the buyer pincode server-side makes the same click show the
//    amber validation banner naming the gap — no download.
// Prereqs: fresh compose stack at localhost:3000 (admin/admin123).
const D = require("./driver.js");
const fs = require("fs");
const path = require("path");

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
  await D.createCompany({ name: "R24 Einvoice UI", gstin: "27R24UIE01V1N2", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const get = async (p) => (await page.request.get(`${D.BASE}/api/c/${cid}${p}`)).json();

  // Seller master must be complete (the payload validator enforces it —
  // by design). The create-company modal leaves address/pincode blank;
  // complete it through the company PUT with the current row merged in.
  const companies = await (await page.request.get(`${D.BASE}/api/companies`)).json();
  const mine = (companies || []).find((c) => String(c.id) === String(cid));
  await page.request.put(`${D.BASE}/api/companies/${cid}`, {
    data: { ...mine, address: "12 MG Road", city: "Mumbai", pincode: "400001" },
  });
  const mine2 = (await (await page.request.get(`${D.BASE}/api/companies`)).json()).find((c) => String(c.id) === String(cid));
  ok("seller master complete (address + pincode)", !!mine2?.address && !!mine2?.pincode, mine2 && { a: mine2.address, p: mine2.pincode });
  const groups = await get("/groups");
  const g = Object.fromEntries(groups.map((x) => [x.name, x.id]));

  // ---- 1) Party PIN Code field exists on the ledger form ----
  await page.goto(`${D.BASE}/company/${cid}/masters/ledgers`);
  await page.waitForSelector('button:has-text("+ New")');
  await page.click('button:has-text("+ New")');
  await D.sleep(250);
  const pinField = page.locator('form label', { hasText: "Party PIN Code" }).first();
  ok("Party PIN Code field on ledger form", await pinField.isVisible().catch(() => false));
  await page.keyboard.press("Escape").catch(() => {});
  await D.sleep(200);

  // Buyer with every e-invoice field via the UI form (driver's createMaster).
  await D.createMaster("ledgers", [
    ["Name *", "R24 Buyer UI"],
    ["Under Group", { label: "Sundry Debtors" }],
    ["GST Registration", { label: "Regular" }],
    ["GSTIN", "29R24UIBUY01K2L"],
    ["Party Address", "9 Brigade Road"],
    ["Party State", "Karnataka"],
    ["Party PIN Code", "560001"],
  ]);
  const ledgers = await get("/ledgers");
  const buyer = ledgers.find((l) => l.name === "R24 Buyer UI");
  ok("buyer saved with pincode + GSTIN", !!buyer && buyer.partyPincode === "560001" && buyer.gstin === "29R24UIBUY01K2L", buyer && { pin: buyer.partyPincode });

  // Sales ledger (taxable income) — through the UI form too.
  await D.createMaster("ledgers", [
    ["Name *", "R24 Sales UI"],
    ["Under Group", { label: "Sales Accounts" }],
    ["Taxability", { label: "Taxable" }],
  ]);

  // Unit + item with HSN (API is fine: masters, not voucher workflow).
  const units = await get("/units");
  let nos = (units || []).find((u) => u.symbol === "NOS");
  if (!nos) {
    await page.request.post(`${D.BASE}/api/c/${cid}/units`, { data: { name: "Numbers", symbol: "NOS", decimalPlaces: 0 } });
    nos = (await get("/units")).find((u) => u.symbol === "NOS");
  }
  await page.request.post(`${D.BASE}/api/c/${cid}/stock-items`, { data: { name: "R24 UI Widget", unitId: nos.id, hsnSac: "8471", gstRate: "18", openingQty: "50", openingRate: "900", openingValue: "45000" } });
  const items = await get("/stock-items");
  const item = items.find((i) => i.name === "R24 UI Widget");
  ok("stock item with HSN created", !!item, items.map((i) => i.name).slice(0, 5));

  // ---- 2) enter the sale through the REAL voucher form (driver contract:
  //         entries Dr>0/Cr<0, inventory qty given positive, STOCK_FLOW applied
  //         at save; party row auto-inserted and set last as the balance) ----
  const saved = await D.enterVoucher({
    type: "Sales", date: "2026-08-15", party: "R24 Buyer UI",
    lines: [
      { ledger: "R24 Sales UI", cr: 10000 },
      { ledger: "IGST", cr: 1800 },
      { ledger: "R24 Buyer UI", dr: 11800 },
    ],
    items: [{ item: "R24 UI Widget", qty: 10, rate: 1000 }],
  });
  ok("sale saved through the voucher form", saved, "save failed");

  // ---- 3) GSTR-1: e-inv action downloads a valid payload ----
  await D.openReport("gstr1", { from: "2026-08-01", to: "2026-08-31" });
  const b2bRow = page.locator("table tr", { hasText: "R24 Buyer UI" }).first();
  ok("B2B row present", await b2bRow.isVisible().catch(() => false));
  const einvBtn = b2bRow.locator('button:has-text("e-inv")').first();
  ok("e-inv action on B2B row", await einvBtn.isVisible().catch(() => false));

  const dl = page.waitForEvent("download", { timeout: 10000 }).catch(() => null);
  await einvBtn.click();
  const download = await dl;
  ok("download fired", !!download, "no download event");
  if (download) {
    const fp = path.join("/tmp", `r24-${download.suggestedFilename()}`);
    await download.saveAs(fp);
    const j = JSON.parse(fs.readFileSync(fp, "utf8"));
    ok("payload v1.01 B2B INV", j.Version === "1.01" && j.TranDtls?.SupTyp === "B2B" && j.DocDtls?.Typ === "INV", j.DocDtls);
    ok("buyer pincode in payload", j.BuyerDtls?.Pin === 560001, j.BuyerDtls);
    ok("values match the voucher", j.ValDtls?.AssVal === 10000 && j.ValDtls?.IgstVal === 1800, j.ValDtls);
  }

  // success banner visible
  const banner = page.locator("text=e-invoice JSON downloaded").first();
  ok("success banner shown", await banner.isVisible().catch(() => false));

  // ---- 4) strip the pincode server-side → amber validation banner, no download ----
  const ls = await get("/ledgers");
  const b2 = ls.find((l) => l.name === "R24 Buyer UI");
  const all = ls.reduce((a, l) => ((a[l.name] = l.id), a), {});
  await page.request.put(`${D.BASE}/api/c/${cid}/ledgers/${b2.id}`, {
    data: { name: "R24 Buyer UI", groupId: all["R24 Buyer UI"] ? b2.groupId : b2.groupId, gstin: "29R24UIBUY01K2L",
      gstRegistrationType: "regular", billWise: true, partyAddress: "9 Brigade Road", partyState: "Karnataka", partyPincode: null },
  });
  await D.sleep(300);
  const dl2 = page.waitForEvent("download", { timeout: 6000 }).catch(() => null);
  await einvBtn.click();
  const dl2got = await dl2;
  ok("no download on validation failure", !dl2got, "unexpected download");
  const amber = page.locator(".bg-amber-50, [class*='amber']").filter({ hasText: "PIN" }).first();
  ok("amber banner names the PIN gap", await amber.isVisible().catch(() => false), await amber.textContent?.().catch(() => ""));

  ok("no page errors", pageErrors.length === 0, pageErrors);
  D.record(pass + fail === pass + fail, "R24-SUMMARY", `${pass} passed, ${fail} failed`);
  console.log(`\n== R24 UI: ${pass} passed, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
