// R-04 browser acceptance: XML import integrity through the REAL UI.
// 1) balanced file imports fine (stats table renders, voucher in Day Book)
// 2) unbalanced file is rejected; the server error naming the voucher is shown
//    in the page's error banner — no white-screen, no uncaught page errors.
// Prereqs: fresh compose stack at localhost:3000 (admin/admin123).
const D = require("./driver.js");
const fs = require("fs");

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

  // login + fresh company via the shared driver
  await D.login();
  await D.createCompany({ name: "R04 UI Import", gstin: "27R04UI000A1B2", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  // ---- balanced import via real file upload ----
  const goodXml = `<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
<TALLYMESSAGE>
 <LEDGER NAME="UI Import Customer"><PARENT>Sundry Debtors</PARENT></LEDGER>
 <VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>20260810</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>UI-IMP-1</VOUCHERNUMBER>
  <PARTYLEDGERNAME>UI Import Customer</PARTYLEDGERNAME>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>UI Import Customer</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>500.00</AMOUNT>
   <BILLALLOCATIONS.LIST><NAME>UI-IMP-BILL-1</NAME><TYPEOFBILL>New Ref</TYPEOFBILL><AMOUNT>500.00</AMOUNT></BILLALLOCATIONS.LIST>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>500.00</AMOUNT></ALLLEDGERENTRIES.LIST>
 </VOUCHER>
</TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
  const goodPath = "/tmp/r04_imp_good.xml";
  fs.writeFileSync(goodPath, goodXml);

  await page.goto(`${D.BASE}/company/${cid}/import`, { waitUntil: "networkidle" });
  await page.setInputFiles('input[type="file"]', goodPath);
  await page.click('button:has-text("Start Import")');
  await page.waitForSelector("text=Import complete", { timeout: 20000 });
  ok("balanced import: stats table shown", true, null);
  const bodyTxt = await page.textContent("body");
  ok("balanced import: 1 voucher reported", /Vouchers imported\s*1\b/.test(bodyTxt.replace(/([a-z])(\d)/i, "$1 $2")) || /Vouchers imported\s*<[^>]*>\s*1/.test(bodyTxt) || (bodyTxt.match(/Vouchers imported[\s\S]{0,6}/)?.[0] ?? "").includes("1"), bodyTxt.match(/Vouchers imported[\s\S]{0,12}/)?.[0]);

  // voucher visible in Day Book
  await page.goto(`${D.BASE}/company/${cid}/daybook`, { waitUntil: "networkidle" });
  await page.waitForSelector("table tbody tr");
  const dbTxt = await page.textContent("body");
  ok("imported voucher in Day Book", dbTxt.includes("UI-IMP-1"), null);

  // ---- unbalanced import via real file upload: rejected, error shown, no crash ----
  const badXml = `<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
<TALLYMESSAGE>
 <VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20260811</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>UI-BAD-1</VOUCHERNUMBER>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>400.00</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>600.00</AMOUNT></ALLLEDGERENTRIES.LIST>
 </VOUCHER>
</TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
  const badPath = "/tmp/r04_imp_bad.xml";
  fs.writeFileSync(badPath, badXml);

  await page.goto(`${D.BASE}/company/${cid}/import`, { waitUntil: "networkidle" });
  await page.setInputFiles('input[type="file"]', badPath);
  await page.click('button:has-text("Start Import")');
  await page.waitForSelector(".bg-red-50", { timeout: 20000 });
  const errTxt = await page.textContent(".bg-red-50");
  ok("unbalanced import rejected in UI", /balance/i.test(errTxt) || errTxt.includes("Voucher"), errTxt);
  ok("error names the voucher (UI-BAD-1)", errTxt.includes("UI-BAD-1"), errTxt);
  ok("no 'Import complete' shown for rejected import", !(await page.textContent("body")).includes("Import complete"), null);
  ok("no page crash (root still mounted)", (await page.locator("#root").count()) === 1 && errTxt.length > 0, null);
  ok("no uncaught page errors", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-04 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(2); });
