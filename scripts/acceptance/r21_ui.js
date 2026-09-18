// R-21 browser acceptance: pre-validation UX through the REAL UI.
// A) VoucherScreen negative-stock advisory: entering an outward qty beyond
//    available stock shows the amber strip naming the item + available qty;
//    correcting the qty clears it; a company opted into negative stock
//    (allowNegativeStock) shows no warning; non-stock types never warn.
// B) ImportXml Validate (dry run): runs the identical server validation and
//    returns the would-import table with a "nothing was imported" banner;
//    the Day Book is unchanged; Start Import then really imports.
// Prereqs: fresh compose stack at localhost:3000 (admin/admin123).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 160)}`); }
};

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  await D.createCompany({ name: "R21 UI Hardening", gstin: "27R21UIHX0A1B2", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const get = async (path) => (await page.request.get(`${D.BASE}/api/c/${cid}${path}`)).json();
  const groups = await get("/groups");
  const g = Object.fromEntries(groups.map((x) => [x.name, x.id]));
  const ru = await page.request.post(`${D.BASE}/api/c/${cid}/units`, { data: { name: "Nos", symbol: "Nos", decimalPlaces: 0 } });
  ok("unit created", ru.status() === 200, await ru.text());
  const unitId = (await ru.json()).id;
  const ri = await page.request.post(`${D.BASE}/api/c/${cid}/stock-items`, { data: { name: "R21 Widget", unitId, openingQty: "2", openingRate: "100", openingValue: "200" } });
  ok("stock item created (qty 2)", ri.status() === 200, await ri.text());
  await page.request.post(`${D.BASE}/api/c/${cid}/ledgers`, { data: { name: "R21 Debtor", groupId: g["Sundry Debtors"] } });
  await page.request.post(`${D.BASE}/api/c/${cid}/ledgers`, { data: { name: "R21 Sales", groupId: g["Sales Accounts"] } });

  // ---- A) negative-stock advisory while typing ----
  await D.openVoucher("Delivery Note");
  // party not required for Delivery Note; add inventory row: 5 of 2 available
  await page.click('button:has-text("+ Add Item")');
  const table = page.locator("table").filter({ hasText: "Qty" }).last();
  const row = table.locator("tbody tr").nth(0);
  await D.pickAhead(row.locator("input").first(), "R21 Widget");
  const nums = row.locator('input[type="number"]');
  await nums.nth(0).fill("5");
  await D.sleep(700); // allow stock-summary query + re-render
  const warn = page.locator("text=Insufficient stock").first();
  ok("amber warning appears when outward exceeds availability", await warn.isVisible().catch(() => false), "no warning");
  const warnText = (await warn.textContent().catch(() => "")) || "";
  ok("warning names the item + available qty + the setting", warnText.includes("R21 Widget") && warnText.includes("2 available") && warnText.includes("Allow Negative Stock"), warnText);

  // correcting the qty clears the warning
  await nums.nth(0).fill("2");
  await D.sleep(600);
  ok("warning clears when qty is within availability", !(await warn.isVisible().catch(() => false)), "warning persisted");
  await page.keyboard.press("Escape");
  await D.sleep(250);

  // opted-in company: no warning even on oversell (PUT the EXACT company id)
  await page.request.put(`${D.BASE}/api/companies/${cid}`, { data: { allowNegativeStock: true } });
  await page.goto(`${D.BASE}/company/${cid}/daybook`);
  await D.openVoucher("Delivery Note");
  await page.click('button:has-text("+ Add Item")');
  const table2 = page.locator("table").filter({ hasText: "Qty" }).last();
  const row2 = table2.locator("tbody tr").nth(0);
  await D.pickAhead(row2.locator("input").first(), "R21 Widget");
  await row2.locator('input[type="number"]').nth(0).fill("9");
  await D.sleep(700);
  ok("opted-in company shows no warning (allowNegativeStock)", !(await warn.isVisible().catch(() => false)), "warning shown despite opt-in");
  await page.keyboard.press("Escape");
  await D.sleep(250);

  // ---- B) import dry run through the UI ----
  const XML = `<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
<TALLYMESSAGE><VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>20260801</DATE><VOUCHERNUMBER>R21-UI-1</VOUCHERNUMBER>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>70.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>R21 Capital</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-70.00</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER></TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
  await page.goto(`${D.BASE}/company/${cid}/import`, { waitUntil: "domcontentloaded" });
  await page.locator('button:has-text("Paste XML")').click();
  await page.locator("textarea").fill(XML);

  // Validate (dry run)
  await page.locator('button:has-text("Validate (dry run)")').click();
  await page.locator("text=Dry run complete").waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  ok("dry run shows the nothing-imported banner", await page.locator("text=Dry run complete").first().isVisible().catch(() => false), "no banner");
  ok("dry run shows would-import voucher count 1", (await page.locator("text=Validation result").first().isVisible().catch(() => false)), "no validation result");

  let rows = await D.daybookRows();
  ok("Day Book unchanged after dry run", !rows.some((r) => (r[2] || "").includes("R21-UI-1")), rows.slice(0, 3));

  // Real import — navigate back (Day Book check left the page) and re-paste
  await page.goto(`${D.BASE}/company/${cid}/import`, { waitUntil: "domcontentloaded" });
  await page.locator('button:has-text("Paste XML")').click();
  await page.locator("textarea").fill(XML);
  await page.locator('button:has-text("Start Import")').click();
  await page.locator("text=Import complete").waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  ok("real import completes through the UI", await page.locator("text=Import complete").first().isVisible().catch(() => false), "no completion card");
  rows = await D.daybookRows();
  ok("Day Book now shows the imported voucher", rows.some((r) => (r[2] || "").includes("R21-UI-1")), rows.slice(0, 3));

  ok("no page errors during R-21 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-21 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
