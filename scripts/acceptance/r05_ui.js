// R-05 browser acceptance: credit notes surface correctly in the GSTR-1 UI.
// Sale -> B2B row; credit note -> CDNR section with positive magnitudes;
// net supplies card shows taxable NET of the note. No crash.
//
// Approved scope extension (v1.5.0): the Apply-GST helper must leave the
// voucher balanced (party row re-balanced) so Ctrl+A saves immediately —
// Tally behaviour. Verified as a real save, not just a grid read.
//
// Prereqs: fresh compose stack at localhost:3000 (admin/admin123).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 200)}`); }
};
const N = (s) => { const m = String(s).match(/-?[\d,]+(?:\.\d+)?/); return m ? parseFloat(m[0].replace(/,/g, "")) : null; };

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  await D.createCompany({ name: "R05 UI GST", gstin: "27R05UI000A1B2", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  // masters via the real master forms (createMaster throws on failure — self-asserting)
  await D.createMaster("ledgers", [["Name", "R05 UI Sales"], ["Under", { label: "Sales Accounts" }], ["Taxability", { label: "Taxable" }]]);
  ok("sales ledger created (taxable)", true, null);
  await D.createMaster("ledgers", [["Name", "R05 UI Customer"], ["Under", { label: "Sundry Debtors" }], ["GSTIN", "27R05CU0000C1Z5"]]);
  ok("customer ledger created (GSTIN)", true, null);

  // ---- scope extension: Apply-GST party-balance ----
  // Real user flow: open Sales (F8), pick party, one income line ( taxable
  // income = credit 10,000 ), click Apply GST, then Ctrl+A to save.
  // Before the fix the party row kept its pre-GST amount and the save was
  // rejected with "Voucher does not balance — difference 1800.00".
  await D.openVoucher("Sales");
  {
    const partyField = page.locator('xpath=//span[text()="Party A/c"]/following::input[1]');
    await D.pickAhead(partyField, "R05 UI Customer");
    const ltable = page.locator("table").filter({ hasText: "Ledger" }).last();
    while ((await ltable.locator("tbody tr").count()) < 2) {
      await page.click('button:has-text("+ Add Ledger")');
      await D.sleep(120);
    }
    const row1 = ltable.locator("tbody tr").nth(1);
    await D.pickAhead(row1.locator("input").first(), "R05 UI Sales");
    await row1.locator('input[type="number"]').nth(1).fill("10000"); // Cr 10,000
    await page.locator('button:has-text("Apply GST")').first().click();
    await D.sleep(400);
  }
  // Attempt the save with the app's own accept hotkey; the party-balance fix
  // must make it succeed. (Interim builds between v1.4.0 and the fix are
  // covered by the same assertion — they fail here with the balance banner.)
  await page.keyboard.press("Control+a");
  const saved = await page.waitForURL("**/daybook", { timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  if (!saved) {
    const banner = await page.locator(".bg-red-50").first().textContent().catch(() => "");
    ok("Apply-GST leaves voucher balanced (Ctrl+A saves)", false, (banner || "").trim());
    await page.keyboard.press("Escape");
    await D.sleep(300);
  } else {
    ok("Apply-GST leaves voucher balanced (Ctrl+A saves)", true, null);
  }

  // ---- GSTR-1 flow on a clean, explicitly-balanced sale + credit note ----
  await D.enterVoucher({
    type: "Sales", date: "2026-07-05", party: "R05 UI Customer",
    lines: [
      { ledger: "R05 UI Customer", dr: 11800 },
      { ledger: "R05 UI Sales", cr: 10000 },
      { ledger: "CGST", cr: 900 },
      { ledger: "SGST/UTGST", cr: 900 },
    ],
  });
  ok("sale posted via UI (Dr 11800 = Cr 10000+900+900)", true, null);

  // credit note 2,000 against it (party Cr 2360 incl. duty 180/180)
  await D.enterVoucher({
    type: "Credit Note", date: "2026-07-20", party: "R05 UI Customer",
    lines: [
      { ledger: "R05 UI Customer", cr: 2360 },
      { ledger: "R05 UI Sales", dr: 2000 },
      { ledger: "CGST", dr: 180 },
      { ledger: "SGST/UTGST", dr: 180 },
    ],
  });
  ok("credit note posted via UI", true, null);

  // GSTR-1 UI
  await D.openReport("gstr1", { from: "2026-07-01", to: "2026-07-31" });
  const body = await D.reportText();
  ok("B2B section shows the sale (gross 10,000)", body.includes("10,000"), null);
  ok("CDNR section present", body.includes("CDNR"), null);
  ok("CDNR row shows the note (2,000, positive)", /CDNR[\s\S]*2,000/.test(body), null);
  ok("net supplies card present", body.includes("Net outward supplies"), null);
  const blocks = await D.cardBlocks("table.report-table");
  const netBlock = blocks.map((b) => b.replace(/\n/g, " ")).find((t) => t.includes("Net"));
  ok("net taxable = 8,000 (10,000 − 2,000)", netBlock && N(netBlock) === 8000, netBlock);
  ok("no page errors", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-05 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(2); });
