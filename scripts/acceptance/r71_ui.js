// R-71 browser acceptance: overdue bills highlight red/amber on the
// Outstanding views (Bills Receivable / Bills Payable).
//  A) a bill past its due date AND open in the debt direction renders with a
//     red row tint + an "overdue Nd" text marker (print-safe, color-free);
//  B) a future-due bill and a no-due-date bill stay clean;
//  C) a bill open in the NON-debt direction (customer advance, Cr) must NOT
//     flag even when its due date has passed;
//  D) payables mirror the logic (Cr− is the open-debt direction there);
//  E) the party header carries an "overdue" chip when any of its bills is;
//  F) the overdue marker is visible in print media;
//  G) zero page errors.
// Prereqs: compose stack at localhost:3000 (admin/admin123).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 240)}`); }
};

// The class string alone doesn't prove paint (a utility could be missing from the
// CSS bundle), so the overdue checks also assert the COMPUTED background color.
// Tailwind v4 renders red-50 as oklch(0.971 0.013 17.38): L≈0.97 light tint,
// tiny chroma, hue 10–25 = red. (Tailwind v3's rgb(254 242 242) would NOT match —
// this pins the v4 rendering the app actually ships.)
const RED_TINT = /^oklch\(0\.97\d? 0\.0\d+ (1\d|2[0-5])\.\d+\)$/;
const bgOf = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => "");

const BASE = D.BASE.replace(/\/$/, "");

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  const stamp = Date.now().toString(36);
  await D.createCompany({
    name: `R71 Overdue ${stamp}`, stateCode: "27",
    fyStart: "2026-04-01", booksBegin: "2026-04-01",
  });
  const cid = D.cid();
  ok("company created", !!cid, cid);

  const g = {};
  for (const grp of await D.getJson(`/api/c/${cid}/groups`)) g[grp.name] = grp.id;

  const buyer = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: {
    name: "Overdue Buyer", groupId: g["Sundry Debtors"], billWise: true,
  } })).json());
  const advBuyer = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: {
    name: "Advance Buyer", groupId: g["Sundry Debtors"], billWise: true,
  } })).json());
  const supplier = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: {
    name: "Overdue Supplier", groupId: g["Sundry Creditors"], billWise: true,
  } })).json());
  const salesL = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: "Local Sales", groupId: g["Sales Accounts"] } })).json());
  const purchL = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: "Local Purchases", groupId: g["Purchase Accounts"] } })).json());
  ok("masters created", !!buyer?.id && !!advBuyer?.id && !!supplier?.id && !!salesL?.id && !!purchL?.id);

  const post = async (body) => (await (await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: body })).json());
  const vt = Object.fromEntries((await D.getJson(`/api/c/${cid}/voucher-types`)).map((t) => [t.name, t.id]));
  const cash = (await D.getJson(`/api/c/${cid}/ledgers`)).find((l) => l.name === "Cash");

  // asOf = today (server's report default). Past due → overdue; future due → clean.
  const past = "2026-04-20", future = "2027-01-31";
  const s1 = await post({ voucherTypeId: vt["Sales"], date: "2026-04-10", partyLedgerId: buyer.id, reference: "OD-1",
    entries: [
      { ledgerId: salesL.id, amount: -1000 },
      { ledgerId: buyer.id, amount: 1000, bills: [{ billType: "new_ref", billName: "OD-1", amount: 1000, dueDate: past }] },
    ] });
  const s2 = await post({ voucherTypeId: vt["Sales"], date: "2026-04-12", partyLedgerId: buyer.id, reference: "OD-2",
    entries: [
      { ledgerId: salesL.id, amount: -500 },
      { ledgerId: buyer.id, amount: 500, bills: [{ billType: "new_ref", billName: "OD-2", amount: 500, dueDate: future }] },
    ] });
  const s3 = await post({ voucherTypeId: vt["Sales"], date: "2026-04-14", partyLedgerId: buyer.id, reference: "OD-3",
    entries: [
      { ledgerId: salesL.id, amount: -300 },
      { ledgerId: buyer.id, amount: 300, bills: [{ billType: "new_ref", billName: "OD-3", amount: 300 }] }, // no due date
    ] });
  ok("three bills posted (past-due 1000, future-due 500, no-due 300)", !!s1?.id && !!s2?.id && !!s3?.id, { s1, s2, s3 });

  // advance: receipt today with on_account allocation (Cr) — must never flag
  const r1 = await post({ voucherTypeId: vt["Receipt"], date: "2026-04-15", partyLedgerId: advBuyer.id,
    entries: [
      { ledgerId: cash.id, amount: 750 },
      { ledgerId: advBuyer.id, amount: -750, bills: [{ billType: "on_account", billName: "On Account", amount: -750, dueDate: past }] },
    ] });
  ok("advance receipt posted (Cr 750 with a past dueDate — must stay clean)", !!r1?.id, r1);

  // payables: purchase with a past-due bill (Cr− in payables = open debt)
  const p1 = await post({ voucherTypeId: vt["Purchase"], date: "2026-04-11", partyLedgerId: supplier.id, reference: "SUP-1",
    entries: [
      { ledgerId: purchL.id, amount: 2200 },
      { ledgerId: supplier.id, amount: -2200, bills: [{ billType: "new_ref", billName: "SUP-1", amount: -2200, dueDate: past }] },
    ] });
  ok("past-due purchase posted (payables)", !!p1?.id, p1);

  // ---- receivables view -------------------------------------------------------
  await page.goto(`${BASE}/company/${cid}/reports/receivables`);
  await page.waitForSelector("table.report-table", { timeout: 8000 });
  await page.waitForTimeout(400);

  const buyerCard = page.locator("div.card", { hasText: "Overdue Buyer" }).first();
  const buyerText = await buyerCard.textContent();
  ok("past-due bill row shows the 'overdue 1d+' marker with day count", /overdue \d+d/.test(buyerText), buyerText.slice(0, 300));
  const odRow = buyerCard.locator("tr", { hasText: "OD-1" });
  ok("past-due row carries the red tint (bg-red-50 class AND computed oklch red-50 paint)",
     ((await odRow.getAttribute("class").catch(() => "")) ?? "").includes("bg-red-50") && RED_TINT.test(await bgOf(odRow)),
     { cls: await odRow.getAttribute("class"), bg: await bgOf(odRow) });
  const futureRow = buyerCard.locator("tr", { hasText: "OD-2" });
  ok("future-due row stays clean (no red tint class, no red paint, no marker)",
     !((await futureRow.getAttribute("class").catch(() => "")) ?? "").includes("bg-red-50") && !RED_TINT.test(await bgOf(futureRow)) && !/overdue \d+d/.test(await futureRow.textContent()),
     { cls: await futureRow.getAttribute("class"), bg: await bgOf(futureRow), text: await futureRow.textContent() });
  const noDueRow = buyerCard.locator("tr", { hasText: "OD-3" });
  ok("no-due-date row stays clean (no red tint class, no red paint)",
     !((await noDueRow.getAttribute("class").catch(() => "")) ?? "").includes("bg-red-50") && !RED_TINT.test(await bgOf(noDueRow)),
     { cls: await noDueRow.getAttribute("class"), bg: await bgOf(noDueRow) });
  ok("party header shows the overdue chip", (await buyerCard.locator("button").first().textContent()).includes("overdue"));

  const advCard = page.locator("div.card", { hasText: "Advance Buyer" }).first();
  const advRow = advCard.locator("tr").first();
  const advRowClass = (await advRow.getAttribute("class").catch(() => "")) ?? "";
  ok("advance (Cr) with a past dueDate does NOT flag red (no tint class, no red paint, no marker)",
     !advRowClass.includes("bg-red-50") && !RED_TINT.test(await bgOf(advRow)) && !/overdue \d+d/.test(await advCard.textContent()),
     { advRowClass, bg: await bgOf(advRow), text: (await advCard.textContent()).slice(0, 200) });

  // ---- payables mirror ---------------------------------------------------------
  await page.goto(`${BASE}/company/${cid}/reports/payables`);
  await page.waitForSelector("table.report-table", { timeout: 8000 });
  await page.waitForTimeout(400);
  const suppCard = page.locator("div.card", { hasText: "Overdue Supplier" }).first();
  ok("payables: past-due purchase flags overdue (mirrored direction)", /overdue \d+d/.test(await suppCard.textContent()), (await suppCard.textContent()).slice(0, 240));
  const supRow = suppCard.locator("tr", { hasText: "SUP-1" });
  ok("payables: past-due row carries the red tint (bg-red-50 class AND computed oklch red-50 paint)",
     ((await supRow.getAttribute("class").catch(() => "")) ?? "").includes("bg-red-50") && RED_TINT.test(await bgOf(supRow)),
     { cls: await supRow.getAttribute("class"), bg: await bgOf(supRow) });

  // ---- print: marker text survives (color-independent) -------------------------
  await page.goto(`${BASE}/company/${cid}/reports/receivables`);
  await page.waitForSelector("table.report-table");
  await page.waitForTimeout(300);
  await page.emulateMedia({ media: "print" });
  const markerVisible = await page.locator("td", { hasText: /overdue \d+d/ }).first().isVisible().catch(() => false);
  await page.emulateMedia({ media: "screen" });
  ok("overdue marker visible in print media", markerVisible);

  ok("zero page errors across the R-71 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-71 RESULT: ${pass} passed, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
