// R-56 browser acceptance: multi-FY Option A — Tally's "change current period"
// model. A1) client defaults honour the STORED company financialYearStart
// (Gateway FY line, Day Book + report windows — F1 fix); A2) Alt+F2 session
// period: Gateway modal, localStorage persistence, Day Book/Reports follow,
// Reset to FY; A3) pre-books-begin voucher: accepted with a warning response
// and still visible in the Day Book window (F2 fix — no silent exclusion),
// openings count it; A4) future-dated voucher warns too.
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
  // A July-begin company — proves defaults are NOT hardcoded to April.
  await D.createCompany({ name: "R56 MultiFY", gstin: "27R56MULTIFY4K2", stateCode: "27", fyStart: "2025-07-01", booksBegin: "2025-07-01" });
  const cid = D.cid();
  ok("company created (FY begins 2025-07-01)", !!cid, cid);
  const gw = `${D.BASE}/company/${cid}`;

  const api = async (method, path, body) => {
    const r = await page.request[method](`${D.BASE}/api${path}`, body !== undefined ? { data: body } : undefined);
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status(), j };
  };
  const dates = () => page.locator('input[type="date"]').evaluateAll((els) => els.map((e) => e.value).filter(Boolean));

  // ---- A1) Gateway FY line honours the stored FY ----
  await page.goto(gw, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Gateway of zprime", { timeout: 15000 });
  await D.sleep(300);
  const fyText = await page.locator("aside").first().innerText();
  ok("Gateway FY line is 2025-07-01 → 2026-06-30 (stored FY, not April)", fyText.includes("2025-07-01") && fyText.includes("2026-06-30"), fyText.split("\n").slice(0, 6));
  ok("period line shows 'Full FY' before any session period", fyText.includes("Period: Full FY"), fyText.split("\n").slice(0, 6));

  // ---- A1) Day Book defaults to the stored FY ----
  await page.goto(`${gw}/daybook`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="date"]', { timeout: 15000 });
  await D.sleep(400);
  let dts = await dates();
  ok("Day Book default from = stored FY begin 2025-07-01 (to stays running today)", dts[0] === "2025-07-01", dts);

  // ---- A1) a report defaults to the stored FY ----
  await page.goto(`${gw}/reports/trial-balance`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="date"]', { timeout: 15000 });
  await D.sleep(400);
  dts = await dates();
  ok("Trial Balance default from = stored FY begin", dts[0] === "2025-07-01", dts);

  // ---- A2) Alt+F2 opens the modal on the Gateway ----
  await page.goto(gw, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Gateway of zprime", { timeout: 15000 });
  await D.sleep(300);
  await page.keyboard.press("Alt+F2");
  await D.sleep(300);
  ok("Alt+F2 opens the Change Period modal", await page.locator('[data-testid="period-modal"]').isVisible().catch(() => false));

  // Set the session period: 2025-07-01 → 2026-06-30 (the stored FY itself is
  // already that; to prove override we set a NARROWER period instead).
  await page.locator('[data-testid="period-modal"] input[type="date"]').nth(0).fill("2025-07-01");
  await page.locator('[data-testid="period-modal"] input[type="date"]').nth(1).fill("2025-12-31");
  await page.click('[data-testid="period-apply"]');
  await D.sleep(300);
  const afterApply = await page.locator("aside").first().innerText();
  ok("Gateway period line shows the applied session period", afterApply.includes("Period 01-07-2025 → 31-12-2025"), afterApply.split("\n").slice(0, 6));

  // localStorage persisted under zprime_period_<cid>
  const stored = await page.evaluate((c) => localStorage.getItem(`zprime_period_${c}`), cid);
  ok("session period persisted in localStorage", stored && JSON.parse(stored).from === "2025-07-01" && JSON.parse(stored).to === "2025-12-31", stored);

  // ---- A2) Day Book now defaults to the SESSION period ----
  await page.goto(`${gw}/daybook`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="date"]', { timeout: 15000 });
  await D.sleep(400);
  dts = await dates();
  ok("Day Book defaults to the session period", dts[0] === "2025-07-01" && dts[1] === "2025-12-31", dts);

  // ---- A2) Reports now default to the SESSION period ----
  await page.goto(`${gw}/reports/trial-balance`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="date"]', { timeout: 15000 });
  await D.sleep(400);
  dts = await dates();
  ok("Trial Balance defaults to the session period", dts[0] === "2025-07-01" && dts[1] === "2025-12-31", dts);

  // ---- A2) explicit date change on the page still wins (override) ----
  await page.locator('input[type="date"]').nth(1).fill("2025-09-30");
  await D.sleep(300);
  dts = await dates();
  ok("user-set end date overrides the session period", dts[0] === "2025-07-01" && dts[1] === "2025-09-30", dts);

  // ---- A2) Reset to FY clears the session period ----
  await page.goto(gw, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Gateway of zprime", { timeout: 15000 });
  await D.sleep(300);
  await page.keyboard.press("Alt+F2");
  await D.sleep(300);
  await page.click('button:has-text("Reset to FY")');
  await D.sleep(300);
  const cleared = await page.evaluate((c) => localStorage.getItem(`zprime_period_${c}`), cid);
  const afterReset = await page.locator("aside").first().innerText();
  ok("Reset to FY clears the stored session period", cleared === null || cleared === undefined, cleared);
  ok("period line back to 'Full FY'", afterReset.includes("Period: Full FY"), afterReset.split("\n").slice(0, 6));

  // ---- A3) pre-books-begin voucher: warned, saved, listed, counted in openings ----
  const grps = Object.fromEntries(((await api("get", `/c/${cid}/groups`)).j ?? []).map((x) => [x.name, x.id]));
  await api("post", `/c/${cid}/ledgers`, { name: "R56 Cash", groupId: grps["Cash-in-Hand"] });
  await api("post", `/c/${cid}/ledgers`, { name: "R56 Exp", groupId: grps["Indirect Expenses"] });
  const preBooks = "2025-05-10"; // books begin 2025-07-01
  const typeRows = (await api("get", `/c/${cid}/voucher-types`)).j ?? [];
  const paymentType = typeRows.find((t) => t.name === "Payment");
  const ledgers = (await api("get", `/c/${cid}/ledgers`)).j ?? [];
  const cash = ledgers.find((l) => l.name === "R56 Cash");
  const exp = ledgers.find((l) => l.name === "R56 Exp");
  const body = {
    voucherTypeId: paymentType.id,
    date: preBooks,
    narration: "R56 pre-books voucher",
    entries: [
      { ledgerId: exp.id, amount: 400 },
      { ledgerId: cash.id, amount: -400 },
    ],
  };
  const res = await api("post", `/c/${cid}/vouchers`, body);
  ok("pre-books voucher accepted (200)", res.status === 200, { status: res.status, j: res.j });
  ok("pre-books voucher response carries a books-begin warning", Array.isArray(res.j?.warnings) && res.j.warnings.some((w) => String(w).includes("Books Begin")), res.j?.warnings);

  // visible in a Day Book window that includes its date
  await page.goto(`${gw}/daybook`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="date"]', { timeout: 15000 });
  await D.sleep(500);
  await page.locator('input[type="date"]').nth(0).fill("2025-05-01");
  await page.locator('input[type="date"]').nth(1).fill("2025-06-30");
  await D.sleep(900);
  const dayText = await D.reportText();
  ok("pre-books voucher still LISTS in the Day Book (F2: not silently excluded)", dayText.includes("R56 pre-books voucher"), dayText.slice(0, 400));

  // counted in openings: a window AFTER books-begin (2025-07) must open with
  // the pre-books voucher's 400 Dr — the exact F2 silent-exclusion scenario.
  const lv = (await api("get", `/c/${cid}/reports/ledger-vouchers/${exp.id}?from=2025-07-01&to=2025-07-31`)).j;
  ok("pre-books voucher counted in ledger opening (opening = 400)", lv && Math.abs(Number(lv.opening) - 400) < 0.02, { opening: lv?.opening });

  // ---- A4) future-dated voucher warns too ----
  const futureRes = await api("post", `/c/${cid}/vouchers`, { ...body, date: "2027-01-15", narration: "R56 future voucher", entries: body.entries.map((e) => ({ ...e, amount: e.amount === 400 ? 60 : -60 })) });
  ok("future-dated voucher accepted with a future-date warning", futureRes.status === 200 && Array.isArray(futureRes.j?.warnings) && futureRes.j.warnings.some((w) => String(w).includes("future")), { status: futureRes.status, warnings: futureRes.j?.warnings });

  // ---- A2) session period respected on a DIFFERENT company (isolation) ----
  await D.createCompany({ name: "R56 Second", gstin: "27R56SECOND6P3", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid2 = D.cid();
  ok("second company created", !!cid2 && cid2 !== cid, { cid, cid2 });
  await page.goto(`${D.BASE}/company/${cid2}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Gateway of zprime", { timeout: 15000 });
  await D.sleep(300);
  const aside2 = await page.locator("aside").first().innerText();
  ok("second company shows its own FY line (April)", aside2.includes("2026-04-01") && aside2.includes("2027-03-31"), aside2.split("\n").slice(0, 6));
  ok("second company has no session period (per-company isolation)", aside2.includes("Period: Full FY"), aside2.split("\n").slice(0, 6));

  ok("no page errors during R-56 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-56 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
