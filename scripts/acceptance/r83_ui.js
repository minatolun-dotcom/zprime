// R-83 browser acceptance: Option A invoice-face completeness pack (operator-
// approved findings F-83-4 + F-83-6 from R-83_INVESTIGATION.md, TallyPrime
// parity).
//  A) Invoice details (F-83-4): collapsed by default on Sales; expanding shows
//     Party (buyer address override, consignee ship-to) / Dispatch (doc no,
//     through, destination, carrier LR-RR, vehicle, ports, marks, packages) /
//     Order (buyer order no/date, payment terms, other refs, delivery terms);
//     values persist through save + reload (alter screen auto-expands).
//  B) Invoice face: after save, the printable face shows Ship-to + the
//     dispatch/order rows; an untouched voucher renders NO details block
//     (off-state byte-stable) and keeps the master's Billed-to address;
//     emptying the section clears invoiceDetails (edit is full-body).
//  C) Open-bills picker (F-83-6): open bills of a bill-wise party appear in
//     the Against Bill column on a Receipt allocation row; picking one
//     allocates against the REAL bill — Bills Receivable shows the residual,
//     no dangling duplicate.
//  D) Party balance inline (F-83-6): "Balancing:" line beside the Party A/c
//     row on Sales with the live Dr outstanding.
//  E) Negative cash warning (F-83-6): over-payment fires the advisory strip
//     AND the save still succeeds; the API response carries warnings[].
// Prereqs: compose stack at localhost:3000 (admin/admin123).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 260)}`); }
};
const ahead = (loc, text) => D.pickAhead(loc, text);

const BASE = D.BASE.replace(/\/$/, "");

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  const stamp = Date.now().toString(36);
  await D.createCompany({
    name: `R83 Invoice Details ${stamp}`, stateCode: "27",
    fyStart: "2026-04-01", booksBegin: "2026-04-01",
  });
  const cid = D.cid();
  ok("company created", !!cid, cid);

  const get = async (p) => (await page.request.get(`${BASE}${p}`)).json();
  const post = async (body) => {
    const res = await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: body });
    const j = await res.json();
    if (!res.ok()) throw new Error(`POST voucher failed: ${JSON.stringify(j).slice(0, 200)}`);
    return j;
  };
  const g = {};
  for (const grp of await get(`/api/c/${cid}/groups`)) g[grp.name] = grp.id;
  const vtList = await get(`/api/c/${cid}/voucher-types`);
  const vt = Object.fromEntries(vtList.map((t) => [t.name, t.id]));
  const ledgers = await get(`/api/c/${cid}/ledgers`);
  const cash = ledgers.find((l) => l.name === "Cash");

  const buyer = await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: `R83 Buyer ${stamp}`, groupId: g["Sundry Debtors"], billWise: true } })).json();
  const salesL = await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: "R83 Local Sales", groupId: g["Sales Accounts"] } })).json();
  const purchL = await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: "R83 Local Purchases", groupId: g["Purchase Accounts"] } })).json();

  // ---------------- A) invoice details: UI fields persist --------------------
  console.log("-- A) invoice details fields (Sales, via UI) --");
  await page.goto(`${BASE}/company/${cid}/voucher/${vt["Sales"]}/new`);
  await page.waitForSelector("text=Ledger Entries");
  ok("details section collapsed by default (off-state)",
     !(await page.locator('[data-testid="invoice-details-panel"]').isVisible().catch(() => false)));
  ok("toggle advertises the three screens",
     (await page.locator('[data-testid="toggle-invoice-details"]').textContent()).includes("Party / Dispatch / Order"));
  await page.click('[data-testid="toggle-invoice-details"]');
  await page.waitForSelector('[data-testid="invoice-details-panel"]');
  await page.fill('[data-testid="id-buyer-address"]', "14 M G Road, Bangalore 560001");
  await page.fill('[data-testid="id-consignee-name"]', "R83 Site Office");
  await page.fill('[data-testid="id-consignee-address"]', "Plot 7, Hosur Road");
  await page.fill('[data-testid="id-dispatch-doc"]', "DCL-881");
  await page.fill('[data-testid="id-dispatched-through"]', "BlueDart Surface");
  await page.fill('[data-testid="id-destination"]', "Hubli");
  await page.fill('[data-testid="id-carrier-lr"]', "LR-99120");
  await page.fill('[data-testid="id-vehicle-no"]', "KA01AB1234");
  await page.fill('[data-testid="id-marks"]', "PKT-1/10");
  await page.fill('[data-testid="id-packages"]', "10");
  await page.fill('[data-testid="id-buyer-order-no"]', "PO/2026/31");
  await page.fill('[data-testid="id-payment-terms"]', "30 days credit");
  await page.fill('[data-testid="id-delivery-terms"]', "FOR Hubli");

  const partyField = page.locator('xpath=//span[text()="Party A/c"]/following::input[1]');
  await ahead(partyField, `R83 Buyer ${stamp}`);
  const ltable = page.locator("table").filter({ hasText: "Ledger" }).last();
  await page.click('button:has-text("+ Add Ledger")');
  const row1 = ltable.locator("tbody tr").nth(1);
  await ahead(row1.locator("input").first(), "R83 Local Sales");
  await row1.locator('input[type="number"]').nth(1).fill("5000");
  const row0 = ltable.locator("tbody tr").nth(0);
  await row0.locator('input[type="number"]').nth(0).fill("5000");
  await page.keyboard.press("Control+a");
  await page.waitForURL("**/daybook", { timeout: 12000 });
  const vlist = await get(`/api/c/${cid}/vouchers`);
  const saleId = Math.max(...vlist.map((v) => v.id));
  const saleFull = await get(`/api/c/${cid}/vouchers/${saleId}`);
  ok("saved voucher is the details sale", saleFull.type?.name === "Sales" && saleFull.partyLedgerId === buyer.id, { id: saleId, type: saleFull.type?.name });
  const d = saleFull.invoiceDetails ?? {};
  ok("invoiceDetails stored (buyer/consignee/dispatch/order)",
     d.buyerAddress === "14 M G Road, Bangalore 560001" && d.consigneeName === "R83 Site Office" &&
     d.dispatchDocNo === "DCL-881" && d.dispatchedThrough === "BlueDart Surface" && d.destination === "Hubli" &&
     d.carrierLrRrNo === "LR-99120" && d.vehicleNo === "KA01AB1234" && d.marksContainerNo === "PKT-1/10" &&
     d.numberOfPackages === "10" && d.buyerOrderNo === "PO/2026/31" && d.modeTermsOfPayment === "30 days credit" &&
     d.termsOfDelivery === "FOR Hubli", d);

  // Reload in alter mode: fields restored + section auto-expanded when present
  await page.goto(`${BASE}/company/${cid}/voucher/${saleId}/edit`);
  await page.waitForSelector("text=Ledger Entries");
  ok("alter reload restores details + auto-expands",
     (await page.locator('[data-testid="invoice-details-panel"]').isVisible().catch(() => false)) &&
     (await page.locator('[data-testid="id-dispatch-doc"]').inputValue()) === "DCL-881" &&
     (await page.locator('[data-testid="id-buyer-order-no"]').inputValue()) === "PO/2026/31");

  // ---------------- B) printable face ---------------------------------------
  console.log("-- B) printable invoice face --");
  // InvoicePrint renders the face twice: the hidden print-only layer and the
  // on-screen preview card — target the LAST (visible) copy.
  await page.locator('[data-testid="invoice-ship-to"]').last().waitFor({ state: "visible", timeout: 8000 });
  const faceText = await page.locator('[data-testid="invoice-details-face"]').last().textContent();
  ok("face renders dispatch/order rows",
     faceText.includes("DCL-881") && faceText.includes("LR-99120") && faceText.includes("KA01AB1234") &&
     faceText.includes("BlueDart Surface") && faceText.includes("Hubli") && faceText.includes("PO/2026/31") &&
     faceText.includes("30 days credit") && faceText.includes("FOR Hubli"), faceText.slice(0, 220));
  const shipTo = await page.locator('[data-testid="invoice-ship-to"]').last().textContent();
  ok("ship-to column renders the consignee", shipTo.includes("R83 Site Office") && shipTo.includes("Hosur Road"), shipTo);
  const faceAll = await page.locator(".card.p-5").last().textContent();
  ok("buyer address override replaces the master address on the face",
     faceAll.includes("14 M G Road, Bangalore 560001"), faceAll.slice(0, 300));

  // Off-state: a plain voucher renders NO details block
  const plain = await post({
    voucherTypeId: vt["Sales"], date: "2026-04-12", partyLedgerId: buyer.id,
    entries: [{ ledgerId: buyer.id, amount: 1000 }, { ledgerId: salesL.id, amount: -1000 }],
  });
  await page.goto(`${BASE}/company/${cid}/voucher/${plain.id}/edit`);
  await page.waitForSelector("text=Ledger Entries");
  await page.waitForTimeout(500);
  ok("untouched voucher: NO details block on the face (off-state byte-stable)",
     !(await page.locator('[data-testid="invoice-details-face"]').isVisible().catch(() => false)) &&
     !(await page.locator('[data-testid="invoice-ship-to"]').isVisible().catch(() => false)));
  const plainFull = await get(`/api/c/${cid}/vouchers/${plain.id}`);
  ok("untouched voucher carries no invoiceDetails", plainFull.invoiceDetails == null, plainFull.invoiceDetails);

  // Edit path clears: expand empty section + save -> payload null (full-body edit)
  await page.click('[data-testid="toggle-invoice-details"]');
  await page.keyboard.press("Control+a");
  await page.waitForURL("**/daybook", { timeout: 12000 });
  const cleared = await get(`/api/c/${cid}/vouchers/${plain.id}`);
  ok("empty details edit clears invoiceDetails (omitted => null)", cleared.invoiceDetails == null, cleared.invoiceDetails);

  // ---------------- C) open-bills picker on a Receipt allocation row ---------
  console.log("-- C) open-bills picker during Receipt entry --");
  // buyer now has two open bills: the details sale (auto SALES-n) + plain.
  const openB = await get(`/api/c/${cid}/reports/party-open-bills?ledgerId=${buyer.id}`);
  ok("party-open-bills endpoint lists both open bills",
     openB.ledgerId === buyer.id && openB.bills.length >= 2 && openB.total > 0, openB);
  const targetBill = openB.bills[0];
  await page.goto(`${BASE}/company/${cid}/voucher/${vt["Receipt"]}/new`);
  await page.waitForSelector("text=Ledger Entries");
  const ltable2 = page.locator("table").filter({ hasText: "Ledger" }).last();
  const rrow0 = ltable2.locator("tbody tr").nth(0);
  await ahead(rrow0.locator("input").first(), "Cash");
  await page.click('button:has-text("+ Add Ledger")');
  const rrow1 = ltable2.locator("tbody tr").nth(1);
  await ahead(rrow1.locator("input").first(), `R83 Buyer ${stamp}`);
  const picker = page.locator(`[data-testid="bills-picker-${buyer.id}"]`).first();
  await picker.waitFor({ state: "visible", timeout: 8000 });
  const opts = await picker.locator("option").allTextContents();
  ok("picker lists the real open bills", opts.some((o) => o.includes(targetBill.billName)), opts);
  await picker.selectOption({ index: 1 }); // index 0 is the placeholder
  const billInput = rrow1.locator("td").nth(1).locator("input");
  ok("pick fills the Against Bill cell with the real bill name",
     (await billInput.inputValue()) === targetBill.billName, await billInput.inputValue());
  await rrow1.locator('input[type="number"]').nth(1).fill("300"); // party Cr 300
  await rrow0.locator('input[type="number"]').nth(0).fill("300"); // Cash Dr 300
  await page.keyboard.press("Control+a");
  await page.waitForURL("**/daybook", { timeout: 12000 });
  const after = await get(`/api/c/${cid}/reports/party-open-bills?ledgerId=${buyer.id}`);
  const target = after.bills.find((b) => b.billName === targetBill.billName);
  ok("allocation landed on the REAL bill (residual reduced, no duplicate)",
     target && Math.abs(Math.abs(target.amount) - Math.abs(targetBill.amount - 300)) < 0.01,
     { before: targetBill.amount, after: target?.amount });

  // ---------------- D) party balance inline on Sales -------------------------
  console.log("-- D) party balance inline on Sales --");
  await page.goto(`${BASE}/company/${cid}/voucher/${vt["Sales"]}/new`);
  await page.waitForSelector("text=Ledger Entries");
  await ahead(page.locator('xpath=//span[text()="Party A/c"]/following::input[1]'), `R83 Buyer ${stamp}`);
  await page.waitForSelector('[data-testid="party-balance-inline"]');
  const balText = await page.locator('[data-testid="party-balance-inline"]').textContent();
  ok("balance line shows the party's Dr outstanding as of today",
     balText.includes("Balancing:") && balText.includes(after.total.toLocaleString("en-IN")) && balText.includes("owes you"), balText);
  await page.keyboard.press("Escape");
  await page.waitForURL("**/daybook", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);

  // ---------------- E) negative cash warning ---------------------------------
  console.log("-- E) negative cash warning (advisory, save proceeds) --");
  await page.goto(`${BASE}/company/${cid}/voucher/${vt["Payment"]}/new`);
  await page.waitForSelector("text=Ledger Entries");
  const ptable = page.locator("table").filter({ hasText: "Ledger" }).last();
  const prow0 = ptable.locator("tbody tr").nth(0);
  await ahead(prow0.locator("input").first(), "R83 Local Purchases");
  await prow0.locator('input[type="number"]').nth(0).fill("75000");
  await page.click('button:has-text("+ Add Ledger")');
  const prow1 = ptable.locator("tbody tr").nth(1);
  await ahead(prow1.locator("input").first(), "Cash");
  await prow1.locator('input[type="number"]').nth(1).fill("75000");
  await page.waitForSelector('[data-testid="negative-cash-warning"]');
  const warnText = await page.locator('[data-testid="negative-cash-warning"]').textContent();
  // Balance-aware: Cash already holds +300 from section C's receipt, so the
  // projected shortage is 74,700 — the strip computes from the LIVE closing.
  ok("negative-cash advisory strip fires, balance-aware (75,000 − 300 in till)",
     warnText.includes("74,700") && warnText.includes("Cr") && warnText.includes("advisory"), warnText);
  await page.keyboard.press("Control+a");
  await page.waitForURL("**/daybook", { timeout: 12000 });
  ok("voucher SAVED despite the warning (advisory only)",
     (await get(`/api/c/${cid}/vouchers`)).some((v) => v.typeName === "Payment" && !v.isCancelled && !v.isOptional));

  // Server-side advisory: replay via API and read the warnings array
  const res2 = await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: {
    voucherTypeId: vt["Payment"], date: "2026-04-20",
    entries: [{ ledgerId: purchL.id, amount: 5000 }, { ledgerId: cash.id, amount: -5000 }],
  } });
  const j2 = await res2.json();
  ok("API save with negative cash returns warnings[] including the advisory",
     res2.ok() && Array.isArray(j2.warnings) && j2.warnings.some((w) => w.includes("Negative cash")), j2.warnings);

  ok("zero page errors across the suite", pageErrors.length === 0, pageErrors);
  D.record(fail === 0, "r83", `summary pass=${pass} fail=${fail}`);
  D.summary();
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error("FATAL", e);
  await D.shot("r83-fatal").catch(() => {});
  await D.close();
  process.exit(1);
});
