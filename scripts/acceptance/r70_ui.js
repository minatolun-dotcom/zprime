// R-70 browser acceptance: bill-name labels render PER BILL on the
// Outstanding (Bills Receivable / Payable) views — Tally's bill-wise display.
//  A) every party card shows its bill table WITHOUT any click (default open);
//  B) the "On Account" synthetic bill renders with its label + amount (the
//     R-69 row), as does "Opening Balance" (R-07);
//  C) named bills (new_ref) render their bill name + due date;
//  D) collapsing a party hides its bills, re-expanding restores them;
//  E) print media keeps the bill rows visible (they are the report's body);
//  F) CSV export still carries one row per bill;
//  G) zero page errors.
// Prereqs: compose stack at localhost:3000 (admin/admin123).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 240)}`); }
};

const BASE = D.BASE.replace(/\/$/, "");

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  const stamp = Date.now().toString(36);
  await D.createCompany({
    name: `R70 BillRows ${stamp}`, stateCode: "27",
    fyStart: "2026-04-01", booksBegin: "2026-04-01",
  });
  const cid = D.cid();
  ok("company created", !!cid, cid);

  const g = {};
  for (const grp of await D.getJson(`/api/c/${cid}/groups`)) g[grp.name] = grp.id;

  // non-bill-wise debtor (R-69 On Account row) + bill-wise debtor (named bills)
  const walkin = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: {
    name: "Walk-in Debtor", groupId: g["Sundry Debtors"],
  } })).json());
  const bwise = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: {
    name: "Bill-wise Buyer", groupId: g["Sundry Debtors"], billWise: true,
  } })).json());
  const salesL = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: "Local Sales", groupId: g["Sales Accounts"] } })).json());
  ok("masters created", !!walkin?.id && !!bwise?.id && !!salesL?.id);

  const post = async (body) => (await (await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: body })).json());
  const vt = Object.fromEntries((await D.getJson(`/api/c/${cid}/voucher-types`)).map((t) => [t.name, t.id]));

  // sale on the non-bill-wise party → On Account row
  const s1 = await post({ voucherTypeId: vt["Sales"], date: "2026-04-10", partyLedgerId: walkin.id,
    entries: [{ ledgerId: salesL.id, amount: -1180 }, { ledgerId: walkin.id, amount: 1180 }] });
  ok("sale posted on non-bill-wise debtor (→ On Account)", !!s1?.id, s1);

  // named-bill sale on the bill-wise party (due date 2026-05-10)
  const s2 = await post({ voucherTypeId: vt["Sales"], date: "2026-04-12", partyLedgerId: bwise.id, reference: "BW-1",
    entries: [
      { ledgerId: salesL.id, amount: -2000 },
      { ledgerId: bwise.id, amount: 2000, bills: [{ billType: "new_ref", billName: "BW-1", amount: 2000, dueDate: "2026-05-10" }] },
    ] });
  ok("named-bill sale posted (BW-1, due 2026-05-10)", !!s2?.id, s2);

  // opening balance party (R-07 Opening Balance row)
  const opener = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: {
    name: "Migrated Party", groupId: g["Sundry Debtors"], openingBalance: 9000,
  } })).json());
  ok("migrated debtor with 9000 opening created", !!opener?.id, opener);

  // ---- API expectation anchor ------------------------------------------------
  const rec = await D.getJson(`/api/c/${cid}/reports/receivables`);
  ok("API: 3 parties with bills", (rec?.parties || []).length === 3 && rec.parties.every((p) => p.bills.length >= 1), rec?.parties?.map((p) => [p.ledgerName, p.bills.length]));

  // ---- A/B/C: the view renders bill rows without any click -------------------
  await page.goto(`${BASE}/company/${cid}/reports/receivables`);
  await page.waitForSelector("table.report-table", { timeout: 8000 });
  await page.waitForTimeout(400);

  const cardFor = (name) => page.locator("div.card", { hasText: name }).first();
  const main = page.locator("main");
  const text = () => main.textContent().catch(() => "");

  // all three parties + their bills visible at once (default open)
  const t0 = await text();
  ok("Walk-in Debtor card visible with On Account label — no click needed", t0.includes("Walk-in Debtor") && /on account/i.test(t0), t0.slice(0, 240));
  ok("Bill-wise Buyer card visible with named bill BW-1 — no click needed", t0.includes("Bill-wise Buyer") && t0.includes("BW-1"), t0.slice(0, 240));
  ok("Migrated Party card visible with Opening Balance label — no click needed", t0.includes("Migrated Party") && /opening balance/i.test(t0), t0.slice(0, 240));

  // amounts per bill row
  const walkinCard = cardFor("Walk-in Debtor");
  ok("On Account row shows 1,180", (await walkinCard.textContent()).includes("1,180"));
  const bwiseCard = cardFor("Bill-wise Buyer");
  ok("BW-1 row shows 2,000", (await bwiseCard.textContent()).includes("2,000"));
  ok("BW-1 row shows its due date", (await bwiseCard.textContent()).includes("10-05-2026"), await bwiseCard.textContent());

  // ---- D: collapse/expand still works ----------------------------------------
  await bwiseCard.locator("button").first().click();
  await page.waitForTimeout(250);
  ok("collapsing a party hides its bill rows", !(await bwiseCard.textContent()).includes("BW-1"));
  await bwiseCard.locator("button").first().click();
  await page.waitForTimeout(250);
  ok("re-expanding restores the bill rows", (await bwiseCard.textContent()).includes("BW-1"));

  // ---- E: print media keeps the bill rows -------------------------------------
  await page.emulateMedia({ media: "print" });
  const printVisible = await page.locator("table.report-table").first().isVisible().catch(() => false);
  await page.emulateMedia({ media: "screen" });
  ok("bill rows visible in print media (they are the report body)", printVisible);

  // ---- F: CSV export — one row per bill ---------------------------------------
  const dl = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
  await page.locator('button:has-text("Export CSV")').first().click().catch(() => {});
  const download = await dl;
  ok("CSV downloads", !!download);
  if (download) {
    const fs = require("fs");
    const csv = fs.readFileSync(await download.path(), "utf8");
    const billRows = csv.split("\r\n").filter((r) => r.includes("Walk-in Debtor") || r.includes("Bill-wise Buyer") || r.includes("Migrated Party"));
    ok("CSV: one row per bill (≥3 party-bill rows)", billRows.length >= 3, billRows);
    ok("CSV rows carry the bill names (On Account / BW-1 / Opening Balance)", /On Account/i.test(csv) && csv.includes("BW-1") && /Opening Balance/i.test(csv), billRows);
  }

  // payables view: empty company → clear-state (contract unchanged)
  ok("zero page errors across the R-70 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-70 RESULT: ${pass} passed, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
