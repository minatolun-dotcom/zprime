// R-25 browser acceptance: e-way bill payload generation through the REAL UI.
// 1) GSTR-1 B2B rows expose "e-way" beside R-24's "e-inv"; clicking downloads
//    a valid EWB-01 JSON (Part-A) whose totals agree with the e-invoice.
// 2) Sub-threshold advisory shows as a warning on success; no download on a
//    validation failure; no page errors anywhere.
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
  await D.createCompany({ name: "R25 Eway UI", gstin: "27R25EWB01X4Y5", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const get = async (p) => (await page.request.get(`${D.BASE}/api/c/${cid}${p}`)).json();
  const companies = await (await page.request.get(`${D.BASE}/api/companies`)).json();
  const mine = companies.find((c) => String(c.id) === String(cid));
  await page.request.put(`${D.BASE}/api/companies/${cid}`, { data: { ...mine, address: "12 MG Road", city: "Mumbai", pincode: "400001" } });

  await D.createMaster("ledgers", [
    ["Name *", "R25 Buyer UI"], ["Under Group", { label: "Sundry Debtors" }],
    ["GST Registration", { label: "Regular" }], ["GSTIN", "29R25EWBBY01L3M"],
    ["Party Address", "9 Brigade Road"], ["Party State", "Karnataka"], ["Party PIN Code", "560001"],
  ]);
  await D.createMaster("ledgers", [["Name *", "R25 Sales UI"], ["Under Group", { label: "Sales Accounts" }], ["Taxability", { label: "Taxable" }]]);

  const units = await get("/units");
  let nos = (units || []).find((u) => u.symbol === "NOS");
  if (!nos) { await page.request.post(`${D.BASE}/api/c/${cid}/units`, { data: { name: "Numbers", symbol: "NOS", decimalPlaces: 0 } }); nos = (await get("/units")).find((u) => u.symbol === "NOS"); }
  await page.request.post(`${D.BASE}/api/c/${cid}/stock-items`, { data: { name: "R25 Widget", unitId: nos.id, hsnSac: "8471", gstRate: "18", openingQty: "50", openingRate: "900", openingValue: "45000" } });

  // The sale through the REAL voucher form (driver contract).
  const saved = await D.enterVoucher({
    type: "Sales", date: "2026-08-15", party: "R25 Buyer UI",
    lines: [
      { ledger: "R25 Sales UI", cr: 10000 },
      { ledger: "IGST", cr: 1800 },
      { ledger: "R25 Buyer UI", dr: 11800 },
    ],
    items: [{ item: "R25 Widget", qty: 10, rate: 1000 }],
  });
  ok("sale saved through the voucher form", saved, "save failed");

  // ---- GSTR-1: e-way action beside e-inv ----
  await D.openReport("gstr1", { from: "2026-08-01", to: "2026-08-31" });
  const b2bRow = page.locator("table tr", { hasText: "R25 Buyer UI" }).first();
  ok("B2B row present", await b2bRow.isVisible().catch(() => false));
  const ewBtn = b2bRow.locator('button:has-text("e-way")').first();
  const eiBtn = b2bRow.locator('button:has-text("e-inv")').first();
  ok("e-way action on B2B row", await ewBtn.isVisible().catch(() => false));
  ok("e-inv action still present (R-24 intact)", await eiBtn.isVisible().catch(() => false));

  // e-way download fires with a valid EWB-01 Part-A payload
  const dl = page.waitForEvent("download", { timeout: 10000 }).catch(() => null);
  await ewBtn.click();
  const download = await dl;
  ok("download fired", !!download, "no download event");
  if (download) {
    const fp = path.join("/tmp", `r25-${download.suggestedFilename()}`);
    await download.saveAs(fp);
    const j = JSON.parse(fs.readFileSync(fp, "utf8"));
    ok("EWB-01 Part-A fields", j.userGstin === "27R25EWB01X4Y5" && j.docType === "INV" && j.toState === "29" && j.totInvValue === 11800,
      { doc: j.docType, to: j.toState, val: j.totInvValue });
    ok("Part-A only (no transport params sent)", !("vehicleList" in j), Object.keys(j));
  }

  // success banner carries the sub-threshold advisory
  const banner = page.locator("text=e-way bill JSON downloaded").first();
  ok("success banner shown", await banner.isVisible().catch(() => false));
  const warnText = await banner.textContent().catch(() => "");
  ok("sub-threshold advisory visible", !!warnText && warnText.includes("50,000"), warnText?.slice(0, 160));

  // validation failure path: strip buyer state -> amber banner, no download
  const ledgers = await get("/ledgers");
  const b2 = ledgers.find((l) => l.name === "R25 Buyer UI");
  await page.request.put(`${D.BASE}/api/c/${cid}/ledgers/${b2.id}`, {
    data: { name: "R25 Buyer UI", groupId: b2.groupId, gstin: "29R25EWBBY01L3M", gstRegistrationType: "regular",
      billWise: true, partyAddress: "9 Brigade Road", partyState: null, partyPincode: "560001" },
  });
  await D.sleep(300);
  const dl2 = page.waitForEvent("download", { timeout: 6000 }).catch(() => null);
  await ewBtn.click();
  ok("no download on validation failure", !(await dl2), "unexpected download");
  const amber = page.locator(".bg-amber-50, [class*='amber']").filter({ hasText: "state" }).first();
  ok("amber banner names the state gap", await amber.isVisible().catch(() => false), await amber.textContent?.().catch(() => ""));

  ok("no page errors", pageErrors.length === 0, pageErrors);
  console.log(`\n== R25 UI: ${pass} passed, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
