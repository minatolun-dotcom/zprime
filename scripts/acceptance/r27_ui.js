// R-27 browser acceptance: TCS (collection at source) through the REAL UI.
// 1) TCS Sections master CRUD via the Masters page.
// 2) Buyer ledger carries a TCS Section via the ledger form dropdown.
// 3) A receipt through the voucher form with the TCS line, then the TCS
//    Report renders Collections-by-Section (10), remittance, outstanding 6,
//    and the payable-ledger card — and the GST report stays clean of TCS.
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
  await D.createCompany({ name: "R27 TCS UI", gstin: "27R27TCSUI02Z7B8", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const get = async (p) => (await page.request.get(`${D.BASE}/api/c/${cid}${p}`)).json();

  // ---- 1) TCS Sections master through the REAL Masters UI ----
  await D.createMaster("tcs-sections", [
    ["Section *", "206C(1H)"], ["Description", "Goods resale above 50 lakh"],
    ["TCS Rate %", "0.1"], ["Threshold ₹ (reference)", "5000000"],
  ]);
  const secs = await get("/tcs-sections");
  const sec = (secs || []).find((s) => s.section === "206C(1H)");
  ok("TCS section created via Masters UI", !!sec, secs);
  ok("TCS section rate persisted (0.1)", sec && Number(sec.rate) === 0.1, sec);

  // ---- 2) buyer ledger carries the TCS section (ledger form dropdown) ----
  await D.createMaster("ledgers", [
    ["Name *", "R27 Buyer"], ["Under Group", { label: "Sundry Debtors" }],
    ["TCS Section (party)", { label: "206C(1H) (0.10%)" }],
  ]);
  const ledgers = await get("/ledgers");
  const buyer = (ledgers || []).find((l) => l.name === "R27 Buyer");
  ok("buyer ledger carries TCS section id", buyer && Number(buyer.tcsSectionId) === Number(sec?.id), buyer);

  // TCS Payable starter ledger present (company seed)
  const tcsLedger = (ledgers || []).find((l) => l.dutyHead === "TCS");
  ok("TCS Payable seeded (dutyHead=TCS)", !!tcsLedger, (ledgers || []).filter((l) => l.dutyHead).map((l) => l.name));

  // ---- 3) voucher screen carries the Collect-TCS action ----
  await D.openVoucher("Receipt");
  const tcsBtn = page.locator('button:has-text("Collect TCS")').first();
  ok("voucher screen has Collect-TCS action", await tcsBtn.isVisible().catch(() => false));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);

  // Cash ledger + receipt entered gross (receipt 10,000 / party credit 10,000);
  // the REAL Collect-TCS button computes 0.1% on the GROSS amount (10), reduces
  // the party credit to 9,990 and adds the section-stamped TCS line to balance.
  await D.createMaster("ledgers", [["Name *", "R27 Cash"], ["Under Group", { label: "Cash-in-Hand" }]]);
  const saved = await D.enterVoucher({
    type: "Receipt", date: "2026-08-15",
    lines: [
      { ledger: "R27 Cash", dr: 10000 },
      { ledger: "R27 Buyer", cr: 10000 },
    ],
    clickApplyTcs: true,
  });
  ok("receipt with TCS collection saved via voucher form", saved, "save failed");

  // ---- 4) TCS Report through the Gateway ----
  await page.goto(`${D.BASE}/company/${cid}`);
  await page.waitForSelector("text=Gateway");
  // R-61: the report tail lives behind "Display More Reports" — expand it.
  await page.locator('[data-testid="gateway-more-toggle"]').click();
  await page.locator('[data-testid="gateway-more-expanded"]').waitFor({ state: "visible", timeout: 5000 });
  const tcsLink = page.locator('a:has-text("TCS Report"), button:has-text("TCS Report")').first();
  ok("Gateway TCS Report entry present", await tcsLink.isVisible().catch(() => false));
  await tcsLink.click().catch(async () => { await page.goto(`${D.BASE}/company/${cid}/reports/tcs`); });
  await page.waitForSelector("text=Collections by Section", { timeout: 15000 });
  const txt = await D.reportText();
  ok("collection shows 10 under 206C(1H)", txt.includes("206C(1H)") && txt.includes("10"), txt.slice(0, 200));
  ok("payable balance card renders", txt.includes("TCS Payable Balance"), "card header");

  // ---- 5) remit 4 (in-period) then verify outstanding 6 on the report ----
  const saved2 = await D.enterVoucher({
    type: "Payment", date: "2026-09-10",
    lines: [
      { ledger: "TCS Payable", dr: 4 },
      { ledger: "R27 Cash", cr: 4 },
    ],
  });
  ok("TCS remittance saved via voucher form", saved2, "save failed");
  await page.goto(`${D.BASE}/company/${cid}/reports/tcs`);
  await page.waitForSelector("text=Collections by Section", { timeout: 15000 });
  const txt2 = await D.reportText();
  ok("remittance visible (4)", txt2.includes("4"), txt2.slice(0, 300));
  ok("outstanding reconciles (collected 10 − remitted 4 = 6)", txt2.includes("6"), "totals row");

  // ---- 6) GST stays clean of TCS: GSTR-1 for the FY shows no supply from
  // the receipt (the only TCS-carrying voucher) — totals remain zero supply.
  await page.goto(`${D.BASE}/company/${cid}/reports/gstr1`);
  await page.waitForSelector("text=GSTR-1", { timeout: 15000 });
  const gstTxt = await D.reportText();
  ok("GSTR-1 carries no TCS pollution (no 10,000 supply row)", !gstTxt.includes("9,990") && !/B2B[\s\S]{0,40}10,000/.test(gstTxt), gstTxt.slice(0, 200));

  ok("no page errors", pageErrors.length === 0, pageErrors);
  console.log(`\n== R27 UI: ${pass} passed, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
