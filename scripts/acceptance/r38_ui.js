// R-38 browser acceptance: the FY per-payee threshold table on the REAL TDS
// and TCS report pages (R-37's data, R-38's surface).
// Prereqs: fresh compose stack at localhost:3000 (admin/admin123), R-38 client
// built into the image.
//
// Contract under test (approved Option A):
//  - "FY Threshold Status (per payee)" card renders on the TDS report page,
//    one block per section, one row per payee, driven by the payload the page
//    already fetches.
//  - Status math mirrors the server: aggregate mode → fyAmount vs threshold
//    (near = 80% band); single mode → maxSingle. Over is amber-strong,
//    near amber, under slate.
//  - PAN column honest: "on file" with GSTIN, "not recorded" without (plus
//    the amber note on the over-row when PAN is missing).
//  - Section rollup line labeled "across payees" when >1 payee.
//  - Honest empty states: no-threshold section wording; empty fyAggregates.
//  - TCS page renders the same card (collection wording) and stays clean.
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 240)}`); }
};

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  await D.createCompany({ name: "R38 PayeeTbl UI", gstin: "27R38PAYETB5X2", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const api = async (method, path, body) => {
    const r = await page.request[method](`${D.BASE}/api${path}`, body !== undefined ? { data: body } : undefined);
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status(), j };
  };

  const grps = Object.fromEntries(((await api("get", `/c/${cid}/groups`)).j ?? []).map((x) => [x.name, x.id]));
  const sec = (await api("post", `/c/${cid}/tds-sections`, { section: "194J", description: "Prof fees", rate: 10, threshold: 50000, thresholdMode: "aggregate" })).j;
  const led = async (name, extra = {}) => (await api("post", `/c/${cid}/ledgers`, { name, groupId: grps["Indirect Expenses"], tdsSectionId: sec.id, ...extra })).j;
  const payeeA = await led("R38 Architect A", { gstin: "27R38ARCHPA6X3Z1" }); // PAN on file
  const payeeB = await led("R38 Consultant B");                                // no GSTIN
  const tdsLed = (await api("post", `/c/${cid}/ledgers`, { name: "R38 TDS Payable", groupId: grps["Duties & Taxes"], dutyHead: "TDS" })).j;
  const ledgersAll = (await api("get", `/c/${cid}/ledgers`)).j ?? [];
  const cash = ledgersAll.find((l) => l.name === "Cash");
  ok("fixtures ready (194J ₹50k, two payees, TDS ledger, Cash)", !!sec?.id && !!payeeA?.id && !!payeeB?.id && !!tdsLed?.id && !!cash?.id, [sec?.id, payeeA?.id, payeeB?.id]);

  const vts = (await api("get", `/c/${cid}/voucher-types`)).j ?? [];
  const paymentTypeId = vts.find((t) => t.name === "Payment")?.id;
  const pay = (ledRow, amt, date) => api("post", `/c/${cid}/vouchers`, { voucherTypeId: paymentTypeId, date,
    entries: [{ ledgerId: ledRow.id, amount: amt }, { ledgerId: tdsLed.id, amount: -Math.round(amt / 10), tdsSectionId: sec.id }, { ledgerId: cash.id, amount: -(amt - Math.round(amt / 10)) }] });

  // A: ₹40k (near, 80% of 50k). B: ₹72k (over). — mirrors the R-37 Python scenario
  await pay(payeeA, 40000, "2026-04-20");
  await pay(payeeB, 72000, "2026-04-25");
  const tdsResp = (await api("get", `/c/${cid}/reports/tds?from=2026-04-01&to=2026-06-30`)).j;
  const agg = (tdsResp.fyAggregates ?? []).find((s) => s.section === "194J");
  ok("fixture sanity: fyAggregates carry 194J with 2 payees", !!agg && (agg.payees ?? []).length === 2 && Math.abs(agg.fyAmount - 112000) < 0.01, agg);

  // ---- TDS report page through the real UI ----
  await page.goto(`${D.BASE}/company/${cid}/reports/tds`);
  await page.waitForSelector("text=Deductions by Section", { timeout: 15000 });
  await page.waitForSelector("text=FY Threshold Status (per payee)", { timeout: 8000 });
  ok("FY Threshold Status card renders on the TDS report page", true, "card header");

  // The Card renders as a bordered div; grab the full card content via its
  // unique header, then read the WHOLE card by scoping to the header's parent.
  const cardText = await page.evaluate(() => {
    const hdr = Array.from(document.querySelectorAll("div")).find((d) => d.textContent?.trim() === "FY Threshold Status (per payee)");
    return hdr?.parentElement?.innerText ?? "";
  });
  ok("section block shows threshold and FY aggregate", cardText.includes("194J") && cardText.includes("50,000") && cardText.includes("1,12,000"), cardText.slice(0, 400));
  ok("payee A row present with PAN on file", cardText.includes("R38 Architect A") && cardText.includes("on file"), cardText.slice(0, 500));
  ok("payee B row present with PAN not recorded", cardText.includes("R38 Consultant B") && cardText.includes("not recorded"), cardText.slice(0, 500));
  ok("payee B shows OVER status", /OVER/i.test(cardText), cardText.slice(0, 600));
  ok("payee A shows near-threshold status", cardText.includes("near threshold"), cardText.slice(0, 600));
  ok("rollup line says across payees", cardText.includes("across payees"), cardText.slice(0, 700));
  ok("advisory-only footer present", cardText.includes("nothing is withheld or blocked"), cardText.slice(-300));

  // Status colors: the OVER badge carries the amber-strong class family
  const overBadge = page.locator("span.text-amber-700", { hasText: "OVER" }).first();
  ok("OVER badge styled amber-strong (R-33 advisory family)", await overBadge.isVisible().catch(() => false), "badge");

  // ---- TCS report page: same card, collection wording, honest empty state ----
  await page.goto(`${D.BASE}/company/${cid}/reports/tcs`);
  await page.waitForSelector("text=Collections by Section", { timeout: 15000 });
  const tcsText = await page.evaluate(() => {
    const hdrs = Array.from(document.querySelectorAll("div")).filter((d) => d.textContent?.trim() === "FY Threshold Status (per payee)");
    const hdr = hdrs[hdrs.length - 1];
    return hdr?.parentElement?.innerText ?? "";
  });
  ok("TCS card shows the collection wording and empty-state honesty", tcsText.includes("collection") && (tcsText.includes("No section declarations with FY collection activity") || tcsText.includes("no threshold recorded")), tcsText.slice(0, 400));

  ok("no page errors", pageErrors.length === 0, pageErrors);
  console.log(`\n== R38 UI: ${pass} passed, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
