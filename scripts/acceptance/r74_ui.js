// R-74 browser acceptance: voucher feature batch (operator-approved
// F-73-1..F-73-7 from R-73_INVESTIGATION.md, TallyPrime parity).
//  A) Optional drafts (F-73-1): Ctrl+L parks a voucher — no serial number
//     consumed, excluded from TB/outstanding/stock, Day Book Optional badge,
//     Accept posts it and stamps the real number; drafts delete freely and
//     cannot be cancelled.
//  B) Duplicate (F-73-2): Alt+2 loads a copy into a fresh form.
//  C) Zero-value opt-in (F-73-7): rejected by default, allowed when the
//     voucher type opts in.
//  D) Per-line narration (F-73-6): stored and reloaded on alter.
//  E) Item discount (F-73-3): amount books NET of discount; % persisted.
//  F) Orders (F-73-4): order moves no stock, creates no bills; invoice
//     against order links; Order Book shows ordered/fulfilled/pending.
//  G) Banking (F-73-5): txn type persists; BRS view reconciles + identity.
// Prereqs: compose stack at localhost:3000 (admin/admin123).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 260)}`); }
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
    name: `R74 Voucher Features ${stamp}`, stateCode: "27",
    fyStart: "2026-04-01", booksBegin: "2026-04-01",
  });
  const cid = D.cid();
  ok("company created", !!cid, cid);

  const g = {};
  for (const grp of await D.getJson(`/api/c/${cid}/groups`)) g[grp.name] = grp.id;
  const post = async (body) => {
    const res = await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: body });
    const j = await res.json();
    if (!res.ok()) throw new Error(`POST voucher failed: ${JSON.stringify(j).slice(0, 200)}`);
    return j;
  };
  const get = async (p) => (await page.request.get(`${BASE}${p}`)).json();
  const vtList = await get(`/api/c/${cid}/voucher-types`);
  const vt = Object.fromEntries(vtList.map((t) => [t.name, t.id]));
  ok("Sale Order + Purchase Order types seeded (migration backfill)",
     !!vt["Sale Order"] && !!vt["Purchase Order"], vtList.map((t) => t.name));
  const ledgers = await get(`/api/c/${cid}/ledgers`);
  const cash = ledgers.find((l) => l.name === "Cash");
  const buyer = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: `R74 Buyer ${stamp}`, groupId: g["Sundry Debtors"], billWise: true } })).json());
  const salesL = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: "R74 Local Sales", groupId: g["Sales Accounts"] } })).json());

  // ---- A) Optional draft lifecycle (API + UI) ---------------------------------
  const draft = await post({
    voucherTypeId: vt["Sales"], date: "2026-04-10", partyLedgerId: buyer.id, isOptional: true,
    entries: [
      { ledgerId: salesL.id, amount: -777 },
      { ledgerId: buyer.id, amount: 777 },
    ],
  });
  ok("draft saved (isOptional)", draft.isOptional === true && /^OPT-/.test(draft.number), { n: draft.number });
  ok("draft number did not consume the serial counter",
     (await get(`/api/c/${cid}/vouchers/next-number?voucherTypeId=${vt["Sales"]}&date=2026-04-11`)).number === "1",
     await get(`/api/c/${cid}/vouchers/next-number?voucherTypeId=${vt["Sales"]}&date=2026-04-11`));
  const tb = await get(`/api/c/${cid}/reports/trial-balance`);
  ok("draft excluded from Trial Balance",
     !tb.rows.some((r) => Math.abs(Math.abs(r.totalDebit - r.totalCredit) - 777) < 0.01 && (r.ledgerName || "").includes(`R74 Buyer`)),
     { rows: tb.rows.length });
  const rec = await get(`/api/c/${cid}/reports/receivables`);
  const bp = rec.parties.find((p) => p.ledgerName === `R74 Buyer ${stamp}`);
  ok("draft excluded from Bills Receivable", !bp || Math.abs(bp.total) < 0.005, bp);

  // UI: Ctrl+L parks a balanced half-entered voucher
  await page.goto(`${BASE}/company/${cid}/voucher/${vt["Journal"]}/new`);
  await page.waitForSelector("text=Ledger Entries");
  await D.sleep(300);
  const ltable = page.locator("table").filter({ hasText: "Ledger" }).last();
  await D.pickAhead(ltable.locator("tbody tr").nth(0).locator("input").first(), "R74 Local Sales");
  await ltable.locator("tbody tr").nth(0).locator('input[type="number"]').nth(0).fill("123");
  await page.click('button:has-text("+ Add Ledger")');
  await D.sleep(150);
  await D.pickAhead(ltable.locator("tbody tr").nth(1).locator("input").first(), "Cash");
  await ltable.locator("tbody tr").nth(1).locator('input[type="number"]').nth(1).fill("123");
  await page.keyboard.press("Control+l");
  await D.sleep(800);
  // Day Book hides drafts by default (Tally behaviour) — flip the lens to
  // "Optional only" to see the parked voucher, its provisional number and badge.
  await page.selectOption('[data-testid="daybook-draft-view"]', "only");
  await D.sleep(400);
  const draftRow = page.locator("table tbody tr", { hasText: "OPT-" }).first();
  const draftRowText = (await draftRow.textContent().catch(() => "")) ?? "";
  ok("Ctrl+L parks the voucher with a provisional OPT-n number and Optional badge",
     /OPT-/.test(draftRowText) && draftRowText.includes("Optional"), draftRowText.slice(0, 160));

  // Day Book Accept posts it and stamps the real number
  await page.locator("table tbody tr", { hasText: "OPT-" }).first().locator('[data-testid="accept-draft"]').click();
  await D.sleep(1200);
  await page.selectOption('[data-testid="daybook-draft-view"]', "both");
  await D.sleep(400);
  const vlist = await get(`/api/c/${cid}/vouchers`);
  const after = vlist.find((v) => v.typeName === "Journal" && v.isOptional === false);
  ok("Day Book Accept posts the draft (isOptional=false, serial number stamped)",
     !!after && after.number === "1", { after: after && { n: after.number, o: after.isOptional }, draftsLeft: vlist.filter((v) => v.isOptional).map((v) => v.number) });

  // posted voucher now consumed number 1; drafts still excluded from TB
  const tb2 = await get(`/api/c/${cid}/reports/trial-balance`);
  ok("accepted draft now IN the Trial Balance (Sales Dr 123)",
     tb2.rows.some((r) => (r.name || "").includes("R74 Local Sales") && Math.abs((r.totalDebit ?? r.debit ?? 0) - 123) < 0.01), tb2.rows.slice(0, 4));

  // cancel refused on a draft; delete free
  const draft2 = await post({
    voucherTypeId: vt["Journal"], date: "2026-04-12", isOptional: true,
    entries: [{ ledgerId: salesL.id, amount: -50 }, { ledgerId: cash.id, amount: 50 }],
  });
  const cancelRes = await page.request.post(`${BASE}/api/c/${cid}/vouchers/${draft2.id}/cancel`, { data: {} });
  ok("cancelling a draft is refused", cancelRes.status() === 409, await cancelRes.text());
  const delRes = await page.request.delete(`${BASE}/api/c/${cid}/vouchers/${draft2.id}`);
  ok("a draft deletes freely", delRes.ok(), await delRes.text());

  // ---- B) Duplicate (Ctrl+D — Tally's Alt+2 collides with zprime's Alt-digit alias) ----
  const saleForDup = await post({
    voucherTypeId: vt["Sales"], date: "2026-04-14", partyLedgerId: buyer.id, reference: "DUP-SRC",
    entries: [
      { ledgerId: salesL.id, amount: -300 },
      { ledgerId: buyer.id, amount: 300 },
    ],
  });
  await page.goto(`${BASE}/company/${cid}/voucher/${saleForDup.id}/edit`);
  await page.waitForSelector("text=Ledger Entries");
  await page.keyboard.press("Control+d");
  await D.sleep(700);
  const dupUrlOk = /\/voucher\/\d+\/new/.test(page.url());
  const dupParty = await page.locator('xpath=//span[text()="Party A/c"]/following::input[1]').inputValue();
  ok("Ctrl+D opens a fresh voucher prefilled with the source body",
     dupUrlOk && dupParty.includes(`R74 Buyer`), { dupUrlOk, dupParty });

  // ---- C) Zero-value entries (F-73-7) ------------------------------------------
  const zeroTry = await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: {
    voucherTypeId: vt["Journal"], date: "2026-04-15",
    entries: [{ ledgerId: salesL.id, amount: 0 }, { ledgerId: cash.id, amount: 0 }],
  } });
  ok("zero-value entries rejected by default", zeroTry.status() === 400, await zeroTry.text());
  // opt the type in via the masters API
  await page.request.put(`${BASE}/api/c/${cid}/voucher-types/${vt["Journal"]}`, { data: { allowZeroValueEntries: true } });
  const [jt] = (await get(`/api/c/${cid}/voucher-types`)).filter((t) => t.id === vt["Journal"]);
  ok("zero-value opt-in persisted on the type", jt.allowZeroValueEntries === true, jt);
  const zeroOk = await post({
    voucherTypeId: vt["Journal"], date: "2026-04-15",
    entries: [{ ledgerId: salesL.id, amount: 0 }, { ledgerId: cash.id, amount: 0 }],
  });
  ok("zero-value entries accepted once the type opts in", !!zeroOk.id, zeroOk);
  await page.request.put(`${BASE}/api/c/${cid}/voucher-types/${vt["Journal"]}`, { data: { allowZeroValueEntries: false } });

  // ---- D) Per-line narration (F-73-6) ------------------------------------------
  const narr = await post({
    voucherTypeId: vt["Journal"], date: "2026-04-16",
    entries: [
      { ledgerId: salesL.id, amount: -100, narration: "consulting line" },
      { ledgerId: cash.id, amount: 100, narration: "cash received" },
    ],
  });
  const narrBack = await get(`/api/c/${cid}/vouchers/${narr.id}`);
  ok("per-line narration stored and returned",
     narrBack.entries[0].narration === "consulting line" && narrBack.entries[1].narration === "cash received",
     narrBack.entries.map((e) => e.narration));

  // ---- E) Item discount (F-73-3) — via UI grid (Disc % column) ------------------
  const item = (await (await page.request.post(`${BASE}/api/c/${cid}/stock-items`, { data: {
    name: `R74 Widget`, unitId: (await get(`/api/c/${cid}/units`))[0].id, gstRate: "18", taxability: "taxable",
  } })).json());
  const discBuyer = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: `R74 Disc Buyer`, groupId: g["Sundry Debtors"], billWise: true } })).json());
  await page.goto(`${BASE}/company/${cid}/voucher/${vt["Sales"]}/new`);
  await page.waitForSelector("text=Ledger Entries");
  await D.sleep(400);
  const invTable = page.locator("table").first();
  await D.pickAhead(invTable.locator("tbody tr").nth(0).locator("input").first(), "R74 Widget");
  const invNums = invTable.locator("tbody tr").nth(0).locator('input[type="number"]');
  await invNums.nth(0).fill("10");   // qty
  await invNums.nth(1).fill("100");  // rate
  await invNums.nth(2).fill("10");   // disc % → amount 900
  const shownAmount = await invTable.locator("tbody tr").nth(0).locator("td.num").first().textContent();
  ok("discount % nets the line amount (10 × 100 @ 10% → 900)", /900/.test(shownAmount ?? ""), shownAmount);
  // persistence check via API (the display netting is asserted above):
  // qty 10 @ rate 100 with discountPct 10 books amount 900 (NET).
  const discSale = await post({
    voucherTypeId: vt["Sales"], date: "2026-04-17", partyLedgerId: discBuyer.id,
    entries: [
      { ledgerId: salesL.id, amount: -900 },
      { ledgerId: discBuyer.id, amount: 900 },
    ],
    inventoryEntries: [{ itemId: item.id, qty: 10, rate: 100, amount: 900, discountPct: 10, kind: "stock" }],
  });
  const discBack = await get(`/api/c/${cid}/vouchers/${discSale.id}`);
  ok("discounted voucher persists discountPct and the NET amount",
     discBack.inventoryEntries[0].discountPct === 10 && discBack.inventoryEntries[0].amount === 900,
     discBack.inventoryEntries[0]);
  const stockVal = (await get(`/api/c/${cid}/reports/stock-summary?to=2026-04-18`)).find((s) => s.name === "R74 Widget");
  ok("stock values the discounted inward at 900 (net, not gross 1000)",
     stockVal && Math.abs(stockVal.closingValue - 900) < 0.01, stockVal);

  // ---- F) Orders (F-73-4) — commitments only, Tally parity -----------------------
  const orderTry = await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: {
    voucherTypeId: vt["Sale Order"], date: "2026-04-18", partyLedgerId: buyer.id,
    entries: [{ ledgerId: salesL.id, amount: -500 }, { ledgerId: buyer.id, amount: 500 }],
    inventoryEntries: [{ itemId: item.id, qty: 20, rate: 25, amount: 500, kind: "order" }],
  } });
  ok("order with ledger entries is refused (commitments only — Tally parity)", orderTry.status() === 400, await orderTry.text());
  const so = await post({
    voucherTypeId: vt["Sale Order"], date: "2026-04-18", partyLedgerId: buyer.id,
    entries: [],
    inventoryEntries: [{ itemId: item.id, qty: 20, rate: 25, amount: 500, kind: "order" }],
  });
  const soBack = await get(`/api/c/${cid}/vouchers/${so.id}`);
  ok("Sale Order saved (party + inventory commitment, zero ledger rows)", !!so.id && soBack.entries.length === 0 && soBack.inventoryEntries.length === 1, { entries: soBack.entries.length, inv: soBack.inventoryEntries.length });
  const stockAfterOrder = (await get(`/api/c/${cid}/reports/stock-summary?to=2026-04-19`)).find((s) => s.itemId === item.id || s.name === "R74 Widget");
  ok("order moved NO stock (closing = the discounted sale's 10@900 only; the order's 20 absent)",
     stockAfterOrder && Math.abs(stockAfterOrder.closingQty - 10) < 0.0001 && Math.abs(stockAfterOrder.closingValue - 900) < 0.01, stockAfterOrder);
  const recAfterOrder = await get(`/api/c/${cid}/reports/receivables`);
  ok("order created NO receivable (the earlier posted sale's 300 stands alone)",
     (() => { const p = recAfterOrder.parties.find((x) => x.ledgerName === `R74 Buyer ${stamp}`); return p && Math.abs(p.total - 300) < 0.01; })(),
     recAfterOrder.parties);

  // invoice against the order (partially: 12 of 20)
  const inv2 = await post({
    voucherTypeId: vt["Sales"], date: "2026-04-20", partyLedgerId: buyer.id, orderVoucherId: so.id,
    entries: [
      { ledgerId: salesL.id, amount: -300 },
      { ledgerId: buyer.id, amount: 300 },
    ],
    inventoryEntries: [{ itemId: item.id, qty: -12, rate: 25, amount: 300, kind: "stock" }],
  });
  ok("invoice against order saved", !!inv2.id && inv2.orderVoucherId === so.id, inv2);
  const ob = await get(`/api/c/${cid}/reports/order-book`);
  const obLine = (ob.orders || []).find((o) => o.id === so.id)?.lines?.[0];
  ok("Order Book shows ordered 20 / fulfilled 12 / pending 8",
     obLine && obLine.orderedQty === 20 && obLine.fulfilledQty === 12 && obLine.pendingQty === 8, ob.orders);

  // ---- G) Banking (F-73-5) --------------------------------------------------------
  const pay = await post({
    voucherTypeId: vt["Payment"], date: "2026-04-22",
    entries: [{ ledgerId: cash.id, amount: -200 }, { ledgerId: salesL.id, amount: 200 }],
    chequeNumber: "100234", bankTxnType: "upi",
  });
  ok("Payment saved with bankTxnType=upi", pay.bankTxnType === "upi", pay.bankTxnType);
  const cr = await get(`/api/c/${cid}/cheque-register`);
  ok("Cheque Register carries the txn type", cr.some((r) => r.chequeNumber === "100234" && r.txnType === "upi"), cr);
  // BRS: reconcile the payment leg, then check the identity
  const brsBefore = await get(`/api/c/${cid}/bank-reconciliation?asOf=2026-04-30`);
  const leg = brsBefore.items.find((i) => i.voucherId === pay.id);
  ok("BRS lists the payment as un-cleared", !!leg && leg.reconciled === false, leg);
  const recCall = await page.request.patch(`${BASE}/api/c/${cid}/vouchers/${pay.id}/reconcile`, { data: { reconciled: true, date: "2026-04-25" } });
  ok("reconcile endpoint marks the leg", recCall.ok(), await recCall.text());
  const brsAfter = await get(`/api/c/${cid}/bank-reconciliation?asOf=2026-04-30`);
  ok("BRS identity: statement = book closing − un-cleared",
     Math.abs(brsAfter.bookClosing - brsAfter.outstandingTotal - brsAfter.balanceAsPerStatement) < 0.01
     && brsAfter.items.find((i) => i.voucherId === pay.id)?.reconciled === true,
     { b: brsAfter.bookClosing, o: brsAfter.outstandingTotal, s: brsAfter.balanceAsPerStatement });

  // UI: BRS view renders with picker + rows
  await page.goto(`${BASE}/company/${cid}/reports/bank-reconciliation`);
  await page.waitForSelector("table.report-table", { timeout: 8000 });
  ok("Bank Reconciliation view renders (picker + table)",
     (await page.locator("select").count()) > 0 && /Balance as per statement/.test(await page.locator("body").textContent()), null);
  // Order Book view renders
  await page.goto(`${BASE}/company/${cid}/reports/order-book`);
  await page.waitForSelector("table.report-table", { timeout: 8000 });
  const obText = await page.locator("body").textContent();
  ok("Order Book view renders with pending qty", /8/.test(obText) && /Pending/.test(obText), null);

  ok("zero page errors across the R-74 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-74 RESULT: ${pass} passed, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
