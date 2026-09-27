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
//  H) Mirrored flow: Purchase Order → Purchase invoice against it → Credit
//     Note against the same PO — payables appear only from the invoice
//     (creditor totals negative), CN stock is inward (+qty) and counts toward
//     PO fulfilment in the Order Book.
//  I) UI mirror of H: the PO and the Credit Note are driven through the real
//     VoucherScreen (Ctrl+A saves; the Against-Order picker populates on alter
//     only — its query is edit-gated), with the same end-state assertions.
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
  const supplier = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: `R74 Supplier ${stamp}`, groupId: g["Sundry Creditors"], billWise: true } })).json());
  const purchL = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: "R74 Local Purchases", groupId: g["Purchase Accounts"] } })).json());

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

  // ---- H) Mirrored flow: Purchase Order → Purchase → Credit Note ---------------
  // Mirror of section F on the buy side, plus a Credit Note against the PO.
  // Verified semantics: payables totals are NEGATIVE for creditors (debit-
  // positive convention — receivables assert +300 in section F); CN stock is
  // INWARD (+qty, STOCK_FLOW CN:+1 — engine.py's add_in mirror; the outward
  // purchase-return document is the Debit Note, −1); and the Order Book
  // measures PO fulfilment at +qty, so the CN's +4 COUNTS as fulfilment.
  // Note: section F's sale (−12) ran against only +10 on hand — R-06's
  // availability guard is company-opt-in, so the honest closing before H is −2.
  const poTry = await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: {
    voucherTypeId: vt["Purchase Order"], date: "2026-04-24", partyLedgerId: supplier.id,
    entries: [{ ledgerId: purchL.id, amount: 400 }, { ledgerId: supplier.id, amount: -400 }],
    inventoryEntries: [{ itemId: item.id, qty: 16, rate: 25, amount: 400, kind: "order" }],
  } });
  ok("Purchase Order with ledger entries is refused (commitments only)", poTry.status() === 400, await poTry.text());
  const po = await post({
    voucherTypeId: vt["Purchase Order"], date: "2026-04-24", partyLedgerId: supplier.id,
    entries: [],
    inventoryEntries: [{ itemId: item.id, qty: 16, rate: 25, amount: 400, kind: "order" }],
  });
  const poBack = await get(`/api/c/${cid}/vouchers/${po.id}`);
  ok("Purchase Order saved (party + commitment, zero ledger rows)",
     !!po.id && poBack.entries.length === 0 && poBack.inventoryEntries.length === 1,
     { entries: poBack.entries.length, inv: poBack.inventoryEntries.length });
  const payAfterPO = await get(`/api/c/${cid}/reports/payables`);
  ok("Purchase Order created NO payable", !payAfterPO.parties.some((p) => p.ledgerName === `R74 Supplier ${stamp}`), payAfterPO.parties);
  const stockAfterPO = (await get(`/api/c/${cid}/reports/stock-summary?to=2026-04-25`)).find((s) => s.itemId === item.id || s.name === "R74 Widget");
  ok("Purchase Order moved NO stock (closing still F's oversold −2; the PO's 16 absent)",
     stockAfterPO && Math.abs(stockAfterPO.closingQty - -2) < 0.0001 && Math.abs(stockAfterPO.closingValue - 0) < 0.01, stockAfterPO);

  // Purchase invoice against the PO (12 of 16) — payable + inward stock now
  const pinv = await post({
    voucherTypeId: vt["Purchase"], date: "2026-04-26", partyLedgerId: supplier.id, orderVoucherId: po.id,
    entries: [
      { ledgerId: purchL.id, amount: 300 },
      { ledgerId: supplier.id, amount: -300 },
    ],
    inventoryEntries: [{ itemId: item.id, qty: 12, rate: 25, amount: 300, kind: "stock" }],
  });
  ok("Purchase invoice against PO saved", !!pinv.id && pinv.orderVoucherId === po.id, pinv);
  const payAfterInv = await get(`/api/c/${cid}/reports/payables`);
  ok("payable appears only from the invoice (creditor −300)",
     (() => { const p = payAfterInv.parties.find((x) => x.ledgerName === `R74 Supplier ${stamp}`); return p && Math.abs(p.total - -300) < 0.01; })(),
     payAfterInv.parties);
  const stockAfterInv = (await get(`/api/c/${cid}/reports/stock-summary?to=2026-04-27`)).find((s) => s.itemId === item.id || s.name === "R74 Widget");
  ok("Purchase invoice moved stock in (−2 + 12 = 10 qty)",
     stockAfterInv && Math.abs(stockAfterInv.closingQty - 10) < 0.0001, stockAfterInv);
  const obPo = await get(`/api/c/${cid}/reports/order-book`);
  const poLine = (obPo.orders || []).find((o) => o.id === po.id)?.lines?.[0];
  ok("Order Book mirrors: PO ordered 16 / fulfilled 12 / pending 4",
     poLine && poLine.orderedQty === 16 && poLine.fulfilledQty === 12 && poLine.pendingQty === 4, obPo.orders);

  // Credit Note against the same PO: supplier is DEBITED (payable shrinks),
  // stock comes IN (+qty — the CN sign; a purchase return's outward doc is the
  // Debit Note), and the Order Book counts +qty toward the PO's fulfilment —
  // pending drops 4 → 0.
  const cn = await post({
    voucherTypeId: vt["Credit Note"], date: "2026-04-28", partyLedgerId: supplier.id, orderVoucherId: po.id,
    entries: [
      { ledgerId: purchL.id, amount: -100 },
      { ledgerId: supplier.id, amount: 100 },
    ],
    inventoryEntries: [{ itemId: item.id, qty: 4, rate: 25, amount: 100, kind: "stock" }],
  });
  const cnBack = await get(`/api/c/${cid}/vouchers/${cn.id}`);
  ok("Credit Note against PO saved with +qty (STOCK_FLOW CN:+1) and the order link",
     !!cn.id && cn.orderVoucherId === po.id && cnBack.inventoryEntries[0].qty === 4,
     cnBack.inventoryEntries[0]);
  const payAfterCN = await get(`/api/c/${cid}/reports/payables`);
  ok("Credit Note reduces the payable 300 → 200 (creditor −200)",
     (() => { const p = payAfterCN.parties.find((x) => x.ledgerName === `R74 Supplier ${stamp}`); return p && Math.abs(p.total - -200) < 0.01; })(),
     payAfterCN.parties);
  const stockAfterCN = (await get(`/api/c/${cid}/reports/stock-summary?to=2026-04-29`)).find((s) => s.itemId === item.id || s.name === "R74 Widget");
  ok("Credit Note stock comes IN (−2 + 12 + 4 = 14 qty)",
     stockAfterCN && Math.abs(stockAfterCN.closingQty - 14) < 0.0001, stockAfterCN);
  const obPo2 = await get(`/api/c/${cid}/reports/order-book`);
  const poLine2 = (obPo2.orders || []).find((o) => o.id === po.id)?.lines?.[0];
  ok("Order Book counts the CN toward PO fulfilment: 16 / 16 / pending 0",
     poLine2 && poLine2.orderedQty === 16 && poLine2.fulfilledQty === 16 && poLine2.pendingQty === 0, obPo2.orders);

  // ---- I) UI mirror of H — PO + Credit Note through the real VoucherScreen ----
  // Order types render an inventory grid but NO party picker in the UI
  // (hasParty excludes orders — the commitment is item-first), and the
  // Against-Order picker only populates on ALTER (its query is edit-gated),
  // so the CN is saved first and the order attached on alter. Ctrl+A saves
  // and returns to the Day Book. April dates keep the as-of windows honest.
  await page.goto(`${BASE}/company/${cid}/voucher/${vt["Purchase Order"]}/new`);
  await page.waitForSelector("text=Ledger Entries");
  await D.sleep(400);
  ok("Purchase Order form opens inventory-only (no Party A/c field)",
     (await page.locator('xpath=//span[text()="Party A/c"]/following::input[1]').count()) === 0, null);
  const poInvTable = page.locator("table").first();
  // Order forms start with an EMPTY inventory grid (no template row, unlike
  // invoice types) — add the row explicitly.
  if ((await poInvTable.locator("tbody tr").count()) === 0) { await page.click('button:has-text("+ Add Item")'); await D.sleep(150); }
  await D.pickAhead(poInvTable.locator("tbody tr").nth(0).locator("input").first(), "R74 Widget");
  const poNums = poInvTable.locator("tbody tr").nth(0).locator('input[type="number"]');
  await poNums.nth(0).fill("16");   // qty
  await poNums.nth(1).fill("25");   // rate
  await page.fill("#v-date", "2026-04-24");
  await D.sleep(300);
  const poShown = await poInvTable.locator("tbody tr").nth(0).locator("td.num").first().textContent();
  ok("PO line amounts to 400 (16 × 25)", /400/.test(poShown ?? ""), poShown);
  await page.keyboard.press("Control+a");
  await page.waitForURL("**/daybook", { timeout: 8000 });
  const vlistUi = await get(`/api/c/${cid}/vouchers`);
  const poUi = vlistUi.find((v) => v.typeName === "Purchase Order" && !v.isCancelled && !v.isOptional && String(v.id) !== String(po.id));
  ok("Ctrl+A saved the Purchase Order from the UI form", !!poUi, vlistUi.filter((v) => v.typeName === "Purchase Order").map((v) => v.number));
  const poUiBack = await get(`/api/c/${cid}/vouchers/${poUi.id}`);
  ok("UI-saved PO carries zero ledger rows and an order-kind line (qty 16)",
     poUiBack.entries.length === 0 && poUiBack.inventoryEntries.length === 1
     && poUiBack.inventoryEntries[0].kind === "order" && poUiBack.inventoryEntries[0].qty === 16,
     { e: poUiBack.entries.length, inv: poUiBack.inventoryEntries[0] });
  const obUi1 = await get(`/api/c/${cid}/reports/order-book`);
  const poUiLine1 = (obUi1.orders || []).find((o) => o.id === poUi.id)?.lines?.[0];
  ok("Order Book lists the UI PO at 16 ordered / 0 fulfilled / 16 pending",
     poUiLine1 && poUiLine1.orderedQty === 16 && poUiLine1.fulfilledQty === 0 && poUiLine1.pendingQty === 16, obUi1.orders);

  // Credit Note through the UI: party pick auto-inserts the supplier row at
  // the grid top (amount filled LAST — run.js's balancing convention); the
  // Against Order is attached on ALTER because the picker is edit-gated.
  await page.goto(`${BASE}/company/${cid}/voucher/${vt["Credit Note"]}/new`);
  await page.waitForSelector("text=Ledger Entries");
  await D.sleep(400);
  const partyField2 = page.locator('xpath=//span[text()="Party A/c"]/following::input[1]');
  await D.pickAhead(partyField2, `R74 Supplier ${stamp}`);
  const cnLtable = page.locator("table").filter({ hasText: "Ledger" }).last();
  const cnPartyRowName = await cnLtable.locator("tbody tr").nth(0).locator("input").first().inputValue();
  ok("party pick auto-inserted the supplier row at the entries-grid top",
     cnPartyRowName.includes(`R74 Supplier`), cnPartyRowName);
  const cnInvTable = page.locator("table").first();
  if ((await cnInvTable.locator("tbody tr").count()) === 0) { await page.click('button:has-text("+ Add Item")'); await D.sleep(150); }
  await D.pickAhead(cnInvTable.locator("tbody tr").nth(0).locator("input").first(), "R74 Widget");
  const cnNums = cnInvTable.locator("tbody tr").nth(0).locator('input[type="number"]');
  await cnNums.nth(0).fill("4");    // qty (client signs it +4 on save — STOCK_FLOW CN:+1)
  await cnNums.nth(1).fill("25");   // rate
  await page.click('button:has-text("+ Add Ledger")');
  await D.sleep(150);
  await D.pickAhead(cnLtable.locator("tbody tr").nth(1).locator("input").first(), "R74 Local Purchases");
  await cnLtable.locator("tbody tr").nth(1).locator('input[type="number"]').nth(1).fill("100"); // Cr 100
  await cnLtable.locator("tbody tr").nth(0).locator('input[type="number"]').nth(0).fill("100"); // party Dr 100 (last)
  await page.fill("#v-date", "2026-04-30");
  await D.sleep(300);
  const cnShown = await cnInvTable.locator("tbody tr").nth(0).locator("td.num").first().textContent();
  ok("CN line amounts to 100 (4 × 25)", /100/.test(cnShown ?? ""), cnShown);
  await page.keyboard.press("Control+a");
  await page.waitForURL("**/daybook", { timeout: 8000 });
  const vlistUi2 = await get(`/api/c/${cid}/vouchers`);
  const cnUi = vlistUi2.find((v) => v.typeName === "Credit Note" && !v.isCancelled && !v.isOptional && String(v.id) !== String(cn.id));
  ok("Ctrl+A saved the Credit Note from the UI form", !!cnUi, vlistUi2.filter((v) => v.typeName === "Credit Note").map((v) => v.number));

  // Alter: the Against-Order picker is populated only in edit mode
  await page.goto(`${BASE}/company/${cid}/voucher/${cnUi.id}/edit`);
  await page.waitForSelector("text=Ledger Entries");
  await D.sleep(700);
  const aoSelect = page.locator('xpath=//span[text()="Against Order"]/following::select[1]');
  const poOption = await aoSelect.locator(`option[value="${poUi.id}"]`).count();
  ok("alter form's Against-Order picker offers the UI-saved PO", poOption === 1, { poUiId: poUi.id });
  await aoSelect.selectOption(String(poUi.id));
  await D.sleep(200);
  await page.keyboard.press("Control+a");
  await page.waitForURL("**/daybook", { timeout: 8000 });
  const cnUiBack = await get(`/api/c/${cid}/vouchers/${cnUi.id}`);
  ok("Against Order attached on alter and saved (orderVoucherId set)",
     cnUiBack.orderVoucherId === poUi.id, { link: cnUiBack.orderVoucherId, want: poUi.id });
  ok("UI CN stored the signed truth: +4 qty stock row, supplier credited +100",
     cnUiBack.inventoryEntries[0].qty === 4 && cnUiBack.inventoryEntries[0].kind === "stock"
     && cnUiBack.entries.some((e) => e.ledgerId === supplier.id && e.amount === 100)
     && cnUiBack.entries.some((e) => e.ledgerId === purchL.id && e.amount === -100),
     { inv: cnUiBack.inventoryEntries[0], entries: cnUiBack.entries });
  const obUi2 = await get(`/api/c/${cid}/reports/order-book`);
  const poUiLine2 = (obUi2.orders || []).find((o) => o.id === poUi.id)?.lines?.[0];
  const poApiLine2 = (obUi2.orders || []).find((o) => o.id === po.id)?.lines?.[0];
  ok("Order Book after the UI CN: UI PO 16/4/12; H's API PO untouched at 16/16/0",
     poUiLine2 && poUiLine2.fulfilledQty === 4 && poUiLine2.pendingQty === 12
     && poApiLine2 && poApiLine2.fulfilledQty === 16 && poApiLine2.pendingQty === 0,
     obUi2.orders);
  const payAfterUi = await get(`/api/c/${cid}/reports/payables`);
  ok("UI CN booked through the real form: supplier total now −100 (−200 + 100)",
     (() => { const p = payAfterUi.parties.find((x) => x.ledgerName === `R74 Supplier ${stamp}`); return p && Math.abs(p.total - -100) < 0.01; })(),
     payAfterUi.parties);
  const stockAfterUi = (await get(`/api/c/${cid}/reports/stock-summary?to=2026-04-30`)).find((s) => s.itemId === item.id || s.name === "R74 Widget");
  ok("UI CN stock comes IN too (−2 + 12 + 4 + 4 = 18 qty)",
     stockAfterUi && Math.abs(stockAfterUi.closingQty - 18) < 0.0001, stockAfterUi);

  ok("zero page errors across the R-74 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-74 RESULT: ${pass} passed, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
