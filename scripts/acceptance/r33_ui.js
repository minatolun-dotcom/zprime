// R-33 browser acceptance: the TDS threshold advisory through the REAL UI.
// 1) fixtures via API: 194J aggregate section (₹50,000 threshold) + expense
//    ledger carrying it; FY base seeded over the threshold (20,000 + 52,000 =
//    72,000) so the advisory is actionable before the operator types anything;
// 2) a fresh Payment voucher on the UI: "− Deduct TDS" fires the non-blocking
//    fetch — the amber ⚠ banner appears with the section, the FY figure and
//    the "TDS/TCS due" wording — AND the voucher still saves normally
//    (advisory is a nudge, never a gate);
// 3) a section with NO threshold recorded (threshold 0): the advisory is
//    honestly filtered out — no banner, no guessing — while the helper still
//    computes the deduction.
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
  await D.createCompany({ name: "R33 Threshold UI", gstin: "27R33THRESHU1X9", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const api = async (method, path, body) => {
    const r = await page.request[method](`${D.BASE}/api${path}`, body !== undefined ? { data: body } : undefined);
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status(), j };
  };

  // ---- fixtures: 194J aggregate section + expense ledger carrying it ----
  const sec = (await api("post", `/c/${cid}/tds-sections`, { section: "194J", description: "Professional fees", rate: 10, threshold: 50000, thresholdMode: "aggregate" })).j;
  ok("194J section created (aggregate, threshold 50000)", !!sec?.id, sec);
  const noThr = (await api("post", `/c/${cid}/tds-sections`, { section: "194I", description: "Rent (no threshold recorded)", rate: 10 })).j;
  ok("194I section created with NO threshold (defaults 0)", !!noThr?.id, noThr);
  const grps = Object.fromEntries(((await api("get", `/c/${cid}/groups`)).j ?? []).map((x) => [x.name, x.id]));
  const prof = (await api("post", `/c/${cid}/ledgers`, { name: "R33 UI Prof Fees", groupId: grps["Indirect Expenses"], tdsSectionId: sec.id })).j;
  const rent = (await api("post", `/c/${cid}/ledgers`, { name: "R33 UI Rent", groupId: grps["Indirect Expenses"], tdsSectionId: noThr.id })).j;
  ok("expense ledgers with TDS sections created", !!prof?.id && !!rent?.id, (prof?.id, rent?.id));
  const ledgers = Object.fromEntries(((await api("get", `/c/${cid}/ledgers`)).j ?? []).map((l) => [l.name, l.id]));
  ok("TDS Payable + Cash seeded in the new company", !!ledgers["TDS Payable"] && !!ledgers["Cash"], Object.keys(ledgers).filter((n) => /TDS|Cash/.test(n)));

  // ---- seed the FY base OVER the threshold (nothing blocked server-side) ----
  const vts = (await api("get", `/c/${cid}/voucher-types`)).j ?? [];
  const payType = vts.find((t) => t.name === "Payment")?.id;
  const pay = (date, amt) => api("post", `/c/${cid}/vouchers`, { voucherTypeId: payType, date, entries: [
    { ledgerId: prof.id, amount: amt },
    { ledgerId: ledgers["TDS Payable"], amount: -Math.round(amt * 0.1), tdsSectionId: sec.id },
    { ledgerId: ledgers["Cash"], amount: -(amt - Math.round(amt * 0.1)) },
  ] });
  ok("below-threshold payment posts normally", (await pay("2026-04-10", 20000)).status === 200);
  ok("over-threshold payment ALSO posts normally (nothing blocked)", (await pay("2026-05-10", 52000)).status === 200);

  // ---- UI: fresh Payment; Deduct TDS fires the advisory fetch ----
  await D.openVoucher("Payment");
  await page.fill("#v-date", "2026-06-01");
  const ltable = page.locator("table").filter({ hasText: "Ledger" }).last();
  const row0 = ltable.locator("tbody tr").nth(0);
  await D.pickAhead(row0.locator("input").first(), "R33 UI Prof Fees");
  await row0.locator('input[type="number"]').nth(0).fill("10000");
  await page.click('button:has-text("+ Add Ledger")'); await D.sleep(150);
  const row1 = ltable.locator("tbody tr").nth(1);
  // Cash NET of TDS (Tally-style): Deduct TDS adds the ₹1,000 duty credit on
  // top — 10,000 Dr = 9,000 Cr cash + 1,000 Cr TDS Payable — the helper does
  // not rebalance the operator's cash line.
  await D.pickAhead(row1.locator("input").first(), "Cash");
  await row1.locator('input[type="number"]').nth(1).fill("9000");
  await D.sleep(200);

  await page.locator('button:has-text("Deduct TDS")').first().click();
  await page.waitForSelector("div.bg-amber-50", { timeout: 10000 });
  const bannerText = (await page.locator("div.bg-amber-50").innerText().catch(() => "")) || "";
  ok("amber advisory appears on Deduct TDS", /⚠/.test(bannerText) && /194J/.test(bannerText), bannerText);
  ok("advisory wording: FY base + over-threshold action", /72,000/.test(bannerText) && /TDS\/TCS due/.test(bannerText), bannerText);

  // ---- nothing blocks: the voucher saves normally through the advisory ----
  await page.keyboard.press("Control+a");
  await page.waitForURL("**/daybook", { timeout: 12000 });
  ok("voucher with advisory saves normally (non-blocking)", true);

  // ---- threshold 0 → honest absence: no banner, no guessing ----
  await D.openVoucher("Payment");
  await page.fill("#v-date", "2026-06-02");
  const lt2 = page.locator("table").filter({ hasText: "Ledger" }).last();
  const r0 = lt2.locator("tbody tr").nth(0);
  await D.pickAhead(r0.locator("input").first(), "R33 UI Rent");
  await r0.locator('input[type="number"]').nth(0).fill("8000");
  await page.click('button:has-text("+ Add Ledger")'); await D.sleep(150);
  const r1 = lt2.locator("tbody tr").nth(1);
  await D.pickAhead(r1.locator("input").first(), "Cash");
  await r1.locator('input[type="number"]').nth(1).fill("8000");
  await D.sleep(200);

  await page.locator('button:has-text("Deduct TDS")').first().click();
  await page.waitForSelector("div.bg-amber-50", { timeout: 10000 });
  // 194J is STILL over (82,000 now) so its advisory legitimately shows again;
  // the honest filter is about 194I: no threshold → never over/near → absent.
  const banner2 = (await page.locator("div.bg-amber-50").innerText().catch(() => "")) || "";
  ok("no-threshold section never enters the advisory banner", /194J/.test(banner2) && !/194I/.test(banner2) && !/no threshold recorded/.test(banner2), banner2);
  // the helper itself still computed the deduction (TDS line present at 10%)
  const grid = await D.readGrid();
  ok("Deduct TDS still computed (₹800 duty line) without a threshold", grid.some((r) => r.name === "TDS Payable" && r.cr === 800), grid);
  await page.keyboard.press("Escape");
  await D.sleep(400);

  ok("no page errors", pageErrors.length === 0, pageErrors);
  console.log(`\n== R33 UI: ${pass} passed, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
