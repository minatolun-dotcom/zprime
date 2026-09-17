// R-10 browser acceptance: duplicate-submission protection through the REAL UI.
// 1) double-accept (Ctrl+A pressed twice in rapid succession — the exact
//    keyboard-first accident) produces exactly ONE posted voucher, not two;
// 2) the client's savingRef hotkey guard means the second press never even
//    fires a second POST (observed via request counting);
// 3) re-opening the voucher screen is a NEW business event (fresh idempotency
//    key) and legitimately posts a second voucher — protection must not
//    swallow real work;
// 4) books stay balanced throughout.
// Prereqs: fresh compose stack at localhost:3000 (admin/admin123).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 160)}`); }
};

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  let postCount = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/c\/\d+\/vouchers$/.test(r.url())) postCount++;
  });

  await D.login();
  await D.createCompany({ name: "R10 UI Idem", gstin: "27R10UI000A1B2", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  // seeded Cash exists; create a second ledger for distinct voucher legs
  const get = async (path) => (await page.request.get(`${D.BASE}/api/c/${cid}${path}`)).json();
  const groups = await get("/groups");
  const g = Object.fromEntries(groups.map((x) => [x.name, x.id]));
  const rExp = await page.request.post(`${D.BASE}/api/c/${cid}/ledgers`, { data: { name: "R10 Office Exp", groupId: g["Indirect Expenses"] } });
  ok("expense ledger created", rExp.status() === 200, await rExp.text());

  // ---- 1) double-accept: Ctrl+A twice back-to-back on a fresh Payment ----
  await D.openVoucher("Payment");
  const pg = D.page();
  await pg.fill("#v-date", "2026-04-05");
  const ltable = pg.locator("table").filter({ hasText: "Ledger" }).last();
  const r0 = ltable.locator("tbody tr").nth(0);
  await D.pickAhead(r0.locator("input").first(), "R10 Office Exp");
  await r0.locator('input[type="number"]').nth(0).fill("500");   // Dr
  await pg.click('button:has-text("+ Add Ledger")');
  await D.sleep(150);
  const r1 = ltable.locator("tbody tr").nth(1);
  await D.pickAhead(r1.locator("input").first(), "Cash");
  await r1.locator('input[type="number"]').nth(1).fill("500");   // Cr

  postCount = 0;
  await pg.keyboard.press("Control+a");
  await pg.keyboard.press("Control+a"); // the accident: immediate second accept
  const banner = pg.locator(".bg-red-50").first();
  ok("no error banner on double-accept", !(await banner.isVisible().catch(() => false)),
    (await banner.isVisible().catch(() => false)) ? await banner.textContent() : null);
  await pg.waitForURL("**/daybook", { timeout: 12000 });
  await D.sleep(600);

  const vouchers = await get("/vouchers");
  const pays = vouchers.filter((v) => v.typeName === "Payment");
  ok("double-accept posted exactly ONE voucher (API)", pays.length === 1, pays.map((v) => [v.id, v.number]));
  ok(`client savingRef guard held: ${postCount} POST fired (<=1)`, postCount <= 1, postCount);
  const rows = await D.daybookRows();
  ok("Day Book shows the one Payment", rows.filter((r) => r[1] === "Payment").length === 1,
    rows.filter((r) => r[1] === "Payment"));

  // ---- 2) fresh form = new business event: second payment posts ----
  await D.openVoucher("Payment");
  await pg.fill("#v-date", "2026-04-06");
  const t0 = ltable.locator("tbody tr").nth(0);
  await D.pickAhead(t0.locator("input").first(), "R10 Office Exp");
  await t0.locator('input[type="number"]').nth(0).fill("200");
  await pg.click('button:has-text("+ Add Ledger")');
  await D.sleep(150);
  const t1 = ltable.locator("tbody tr").nth(1);
  await D.pickAhead(t1.locator("input").first(), "Cash");
  await t1.locator('input[type="number"]').nth(1).fill("200");
  await pg.keyboard.press("Control+a");
  await pg.waitForURL("**/daybook", { timeout: 12000 });
  await D.sleep(600);

  const after = (await get("/vouchers")).filter((v) => v.typeName === "Payment");
  ok("fresh form posts the second voucher (no over-protection)", after.length === 2, after.map((v) => [v.id, v.number]));
  ok("second voucher has its own number", new Set(after.map((v) => v.number)).size === 2, after.map((v) => v.number));

  // ---- 3) books balanced ----
  await D.openReport("trial-balance", { from: "2026-04-01", to: "2026-04-30" });
  const trs = await D.reportRows();
  const tot = [...trs].reverse().find((r) => r[0] === "Totals");
  const nums = tot ? tot.slice(1).map((s) => D.inrNum(s) || 0) : [];
  ok("TB still balanced after both saves", nums.length >= 2 && nums[0] === nums[1], nums);

  ok("no page errors during R-10 UI flow", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-10 UI scenario: ${pass} ok, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
