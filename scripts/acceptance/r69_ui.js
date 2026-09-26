// R-69 browser/API acceptance: non-bill-wise parties surface in Outstanding
// reports as an "On Account" bill (Tally parity).
//  A) receivables: a non-bill-wise debtor with a real balance appears (was
//     silently invisible before R-69);
//  B) the balance is ONE on_account bill = the party's net residual;
//  C) payables mirror it for a non-bill-wise creditor;
//  D) an on-account receipt reduces the On Account bill (application works);
//  E) bill-wise parties keep their named bills and are NOT double-counted
//     (covered base excludes the R-07 opening bill — migrated books stay honest);
//  F) asOf time-travel: a date before the posting shows nothing;
//  G) the Outstanding UI (receivables view) renders the On Account row.
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
    name: `R69 OnAcct ${stamp}`, stateCode: "27",
    fyStart: "2026-04-01", booksBegin: "2026-04-01",
  });
  const cid = D.cid();
  ok("company created", !!cid, cid);

  const g = {};
  for (const grp of await D.getJson(`/api/c/${cid}/groups`)) g[grp.name] = grp.id;

  // non-bill-wise debtor + creditor, sales/purchase ledgers
  const debtor = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: {
    name: "Walk-in Debtor", groupId: g["Sundry Debtors"], // no billWise
  } })).json());
  const creditor = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: {
    name: "Casual Creditor", groupId: g["Sundry Creditors"], // no billWise
  } })).json());
  const salesL = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: "Local Sales", groupId: g["Sales Accounts"] } })).json());
  const purchL = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: "Local Purchases", groupId: g["Purchase Accounts"] } })).json());
  ok("masters created (non-bill-wise debtor + creditor)", !!debtor?.id && !!creditor?.id && !!salesL?.id && !!purchL?.id);

  const post = async (body) => (await (await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: body })).json());
  const vt = Object.fromEntries((await D.getJson(`/api/c/${cid}/voucher-types`)).map((t) => [t.name, t.id]));

  // sale 1180 on the NON-bill-wise debtor
  const sale = await post({ voucherTypeId: vt["Sales"], date: "2026-04-10", partyLedgerId: debtor.id,
    entries: [{ ledgerId: salesL.id, amount: -1180 }, { ledgerId: debtor.id, amount: 1180 }] });
  ok("sale posted on non-bill-wise debtor", !!sale?.id, sale);
  // purchase 700 on the NON-bill-wise creditor
  const purch = await post({ voucherTypeId: vt["Purchase"], date: "2026-04-11", partyLedgerId: creditor.id,
    entries: [{ ledgerId: purchL.id, amount: 700 }, { ledgerId: creditor.id, amount: -700 }] });
  ok("purchase posted on non-bill-wise creditor", !!purch?.id, purch);

  // ---- A/B: receivables show the debtor as On Account -----------------------
  let rec = await D.getJson(`/api/c/${cid}/reports/receivables`);
  const dParty = (rec?.parties || []).find((p) => p.ledgerId === debtor.id);
  ok("receivables list the non-bill-wise debtor (pre-R-69: invisible)", !!dParty, rec);
  const dBill = dParty?.bills?.find((b) => b.billType === "on_account");
  ok("debtor balance is ONE On Account bill = 1180", !!dBill && dParty.bills.length === 1 && Math.round(Number(dBill.amount)) === 1180 && Math.round(Number(dParty.total)) === 1180, dParty);

  // ---- C: payables mirror it -------------------------------------------------
  const pay = await D.getJson(`/api/c/${cid}/reports/payables`);
  const cParty = (pay?.parties || []).find((p) => p.ledgerId === creditor.id);
  const cBill = cParty?.bills?.find((b) => b.billType === "on_account");
  ok("payables list the non-bill-wise creditor as On Account = -700 (mirrored sign)", !!cBill && Math.round(Number(cBill.amount)) === -700 && Math.round(Number(cParty.total)) === -700, cParty);

  // ---- D: an on-account receipt reduces the On Account bill ------------------
  const cash = (await D.getJson(`/api/c/${cid}/ledgers`)).find((l) => l.name === "Cash");
  const receipt = await post({ voucherTypeId: vt["Receipt"], date: "2026-04-20",
    entries: [{ ledgerId: cash.id, amount: 500 }, { ledgerId: debtor.id, amount: -500 }] });
  ok("receipt posted (500 against the debtor)", !!receipt?.id, receipt);
  rec = await D.getJson(`/api/c/${cid}/reports/receivables`);
  const d2 = (rec?.parties || []).find((p) => p.ledgerId === debtor.id);
  ok("On Account bill reduced to 680 after the receipt", !!d2 && Math.round(Number(d2.total)) === 680, d2);

  // ---- E: bill-wise party keeps named bills, no double-count -----------------
  const bwise = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: {
    name: "Bill-wise Buyer", groupId: g["Sundry Debtors"], billWise: true,
  } })).json());
  const sale2 = await post({ voucherTypeId: vt["Sales"], date: "2026-04-12", partyLedgerId: bwise.id, reference: "BW-1",
    entries: [
      { ledgerId: salesL.id, amount: -2000 },
      { ledgerId: bwise.id, amount: 2000, bills: [{ billType: "new_ref", billName: "BW-1", amount: 2000 }] },
    ] });
  ok("sale posted on bill-wise buyer (ref BW-1)", !!sale2?.id, sale2);
  rec = await D.getJson(`/api/c/${cid}/reports/receivables`);
  const bParty = (rec?.parties || []).find((p) => p.ledgerId === bwise.id);
  ok("bill-wise buyer keeps exactly one named bill BW-1 = 2000, no phantom On Account", !!bParty && bParty.bills.length === 1 && bParty.bills[0].billName === "BW-1" && Math.round(Number(bParty.total)) === 2000, bParty);

  // opening balance on a NON-bill-wise debtor must appear ONCE (as the R-07
  // opening bill), never duplicated by the R-69 residual pass
  const openCo = (await (await page.request.post(`${BASE}/api/companies`, { data: {
    name: `R69 Opening ${stamp}`, stateCode: "27",
    financialYearStart: "2026-04-01", booksBeginFrom: "2026-04-01",
  } })).json());
  await D.openCompany(`R69 Opening ${stamp}`);
  const cid2 = D.cid();
  const g2 = {};
  for (const grp of await D.getJson(`/api/c/${cid2}/groups`)) g2[grp.name] = grp.id;
  const openDebtor = (await (await page.request.post(`${BASE}/api/c/${cid2}/ledgers`, { data: {
    name: "Migrated Party", groupId: g2["Sundry Debtors"], openingBalance: 9000, // no billWise
  } })).json());
  ok("company 2: migrated debtor with 9000 opening (non-bill-wise)", !!openDebtor?.id, openDebtor);
  const rec2 = await D.getJson(`/api/c/${cid2}/reports/receivables`);
  const oParty = (rec2?.parties || []).find((p) => p.ledgerId === openDebtor.id);
  ok("opening shows once as the Opening Balance bill = 9000, no duplicate On Account", !!oParty && oParty.bills.length === 1 && oParty.bills[0].billType === "opening" && Math.round(Number(oParty.total)) === 9000, oParty);

  // ---- F: asOf before the postings shows nothing -----------------------------
  const recEarly = await D.getJson(`/api/c/${cid}/reports/receivables?to=2026-04-01`);
  ok("asOf 2026-04-01 (before postings) lists nothing", (recEarly?.parties || []).length === 0 && Number(recEarly?.total) === 0, recEarly);

  // ---- G: the receivables UI renders the On Account row ----------------------
  await page.goto(`${BASE}/company/${cid}/reports/receivables`);
  await page.waitForSelector("table", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
  const viewText = (await page.locator("main").textContent().catch(() => "")) || "";
  ok("Outstanding receivables view shows Walk-in Debtor", viewText.includes("Walk-in Debtor"), viewText.slice(0, 200));
  ok("view shows the corrected outstanding 680 for the party row", viewText.includes("680"), viewText.slice(0, 200));

  ok("zero page errors across the R-69 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-69 RESULT: ${pass} passed, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
