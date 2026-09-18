// R-23 browser acceptance: reverse charge (RCM) through the REAL UI.
// 1) A Purchase voucher shows the RCM checkbox (header) + Alt+R panel button;
//    toggling it shows the amber reverse-charge strip; saving persists the flag.
// 2) The Day Book row carries the amber "RCM" badge.
// 3) The self-assessed duty on the RCM Payable ledger surfaces in GSTR-3B as
//    4(A)(3) "Supplies attracting reverse charge" + "ITC claimed on reverse
//    charge" rows; the net payable line is unchanged (cash effect nil).
// 4) A Sales voucher (outward) shows no RCM control.
// Prereqs: fresh compose stack at localhost:3000 (admin/admin123).
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
  await D.createCompany({ name: "R23 RCM UI", gstin: "27R23RCMUX0A1B2", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const get = async (path) => (await page.request.get(`${D.BASE}/api/c/${cid}${path}`)).json();
  const groups = await get("/groups");
  const g = Object.fromEntries(groups.map((x) => [x.name, x.id]));
  const ledgers = await get("/ledgers");
  const L = Object.fromEntries(ledgers.map((x) => [x.name, x]));
  ok("RCM Payable starter ledger exists with dutyHead RCM", !!L["RCM Payable"] && L["RCM Payable"].dutyHead === "RCM", L["RCM Payable"]?.dutyHead);

  await page.request.post(`${D.BASE}/api/c/${cid}/ledgers`, { data: { name: "R23 Freight", groupId: g["Direct Expenses"], taxability: "taxable", gstRate: "5" } });
  await page.request.post(`${D.BASE}/api/c/${cid}/ledgers`, { data: { name: "R23 GTA", groupId: g["Sundry Creditors"], gstRegistrationType: "unregistered", billWise: true } });

  // ---- 1) the RCM toggle on a Purchase voucher ----
  await D.openVoucher("Purchase");
  await page.fill("#v-date", "2026-08-05");
  const rcmBox = page.locator('input[type="checkbox"]').filter({ hasNot: page.locator("checked") }).first();
  const headerRcm = page.locator("label", { hasText: "RCM" }).first();
  ok("RCM checkbox visible on Purchase header", await headerRcm.isVisible().catch(() => false));
  const panelBtn = page.locator('aside button:has-text("Reverse Charge")').first();
  ok("Alt+R panel button visible", await panelBtn.isVisible().catch(() => false));

  // toggle via the panel button → amber strip appears
  await panelBtn.click();
  await D.sleep(200);
  const strip = page.locator("text=Reverse charge — GST is NOT charged").first();
  ok("amber reverse-charge strip appears", await strip.isVisible().catch(() => false), "no strip");

  // fill the voucher: Dr Freight 5000, Dr RCM Payable 250, Cr GTA 5250
  const lt = page.locator("table").filter({ hasText: "Ledger" }).last();
  const r0 = lt.locator("tbody tr").nth(0);
  await D.pickAhead(r0.locator("input").first(), "R23 Freight");
  await r0.locator('input[type="number"]').nth(0).fill("5000");
  await page.click('button:has-text("+ Add Ledger")');
  await D.sleep(150);
  const r1 = lt.locator("tbody tr").nth(1);
  await D.pickAhead(r1.locator("input").first(), "RCM Payable");
  await r1.locator('input[type="number"]').nth(0).fill("250");
  await page.click('button:has-text("+ Add Ledger")');
  await D.sleep(150);
  const r2 = lt.locator("tbody tr").nth(2);
  await D.pickAhead(r2.locator("input").first(), "R23 GTA");
  await r2.locator('input[type="number"]').nth(1).fill("5250");
  await D.sleep(200);
  await page.keyboard.press("Control+a");
  await page.waitForURL("**/daybook", { timeout: 12000 });
  ok("RCM purchase saved via Ctrl+A", true);

  // ---- 2) Day Book badge ----
  const rows = await D.daybookRows();
  const rcmRow = rows.find((r) => r[1]?.startsWith("Purchase") && r.some((c) => c.includes("5,250")));
  // innerText concatenates the inline badge into the type cell ("PurchaseRCM").
  ok("Day Book row shows the amber RCM badge", !!rcmRow && rcmRow[1].includes("RCM"), rcmRow);

  // ---- 3) GSTR-3B 4(A)(3) rows ----
  await D.openReport("gstr3b", { from: "2026-08-01", to: "2026-08-31" });
  const t = await D.reportText();
  ok("3B shows the reverse-charge section", t.includes("reverse charge"), t.slice(0, 120));
  ok("3B shows RCM ITC row", /RCM ITC claimed/i.test(t));
  // parse the 4(A)(3) row: taxable 5,000 and IGST 250 must appear in that section
  const sec = (t.split("reverse charge")[1] || "").split("ITC claimed")[0] || "";
  ok("4(A)(3) taxable 5,000 and IGST 250 present", sec.includes("5,000") && sec.includes("250"), sec.slice(0, 160));

  // net payable unchanged: RCM is liability+ITC net-nil → Net Tax Payable total 0
  const afterNet = ((t.split("Net Tax Payable")[1] || "").split("Total")[1]) || "";
  const nums = (afterNet.match(/-?[\d,]+(?:\.\d+)?/g) || []).map((s) => parseFloat(s.replace(/,/g, "")));
  ok("Net Tax Payable total = 0 (RCM nets to nil)", nums.length >= 1 && Math.abs(nums[0]) < 0.02, nums);

  // ---- 4) outward types have no RCM control ----
  await D.openVoucher("Sales");
  const salesRcm = page.locator("label", { hasText: "RCM" }).first();
  ok("no RCM control on Sales voucher", !(await salesRcm.isVisible().catch(() => false)));
  await page.keyboard.press("Escape");

  // API double-check: the saved voucher carries isRcm
  const vs = await get("/vouchers?from=2026-08-01&to=2026-08-31");
  const v23 = (vs || []).find((v) => v.isRcm);
  ok("saved voucher carries isRcm=true (API)", !!v23, (vs || []).map((v) => v.isRcm));

  ok("no page errors during R-23 scenario", pageErrors.length === 0, pageErrors.slice(0, 3));

  await D.close();
  console.log(`\n== R-23 UI scenario: ${pass} ok, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
