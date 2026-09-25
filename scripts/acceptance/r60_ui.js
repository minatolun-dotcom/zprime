// R-60 browser acceptance: cross-FY report comparison (Tally F12 "Prev Year").
// The server composes the prior window (same-length slice one year back; BS
// as-of one year back; no prior history → previous=null) and the three
// headline statements gain a Prev column behind one toggle (checkbox + F12,
// Tally's own slot). Proves: full-FY values, slice-window semantics (an
// Apr–Jun view compares the prior Apr–Jun), per-ledger TB join with an honest
// dash for ledgers that did not exist in the prior window, BS prior totals,
// the F12 hotkey, and the byte-honest off-state (no column at all).
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
  // April-begin FY spanning 2025-26 and 2026-27 (the R-57 fixture pattern).
  await D.createCompany({ name: `R60 Compare ${Date.now() % 100000}`, gstin: "27R60COMPAR7K3", stateCode: "27", fyStart: "2025-04-01", booksBegin: "2025-04-01" });
  const cid = D.cid();
  ok("company created", !!cid, cid);

  // Seed: one expense ledger + postings in BOTH FYs; a second expense ledger
  // posted ONLY in the current FY (its TB prev cell must be a dash).
  const api = async (method, path, body) => {
    const r = await page.request[method](`${D.BASE}/api${path}`, body !== undefined ? { data: body } : undefined);
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status(), j };
  };
  const grps = Object.fromEntries(((await api("get", `/c/${cid}/groups`)).j ?? []).map((x) => [x.name, x.id]));
  await api("post", `/c/${cid}/ledgers`, { name: "R60 Cash", groupId: grps["Cash-in-Hand"] });
  await api("post", `/c/${cid}/ledgers`, { name: "R60 Exp Old", groupId: grps["Indirect Expenses"] });
  await api("post", `/c/${cid}/ledgers`, { name: "R60 Exp New", groupId: grps["Indirect Expenses"] });
  const ledgers = (await api("get", `/c/${cid}/ledgers`)).j ?? [];
  const cash = ledgers.find((l) => l.name === "R60 Cash");
  const expOld = ledgers.find((l) => l.name === "R60 Exp Old");
  const expNew = ledgers.find((l) => l.name === "R60 Exp New");
  const payment = ((await api("get", `/c/${cid}/voucher-types`)).j ?? []).find((t) => t.name === "Payment");
  const post = (date, exp, amt) => api("post", `/c/${cid}/vouchers`, { voucherTypeId: payment.id, date, entries: [{ ledgerId: exp.id, amount: amt }, { ledgerId: cash.id, amount: -amt }] });
  ok("prior-FY voucher posted", (await post("2025-05-10", expOld, 500)).status === 200, "500 in FY 2025-26");
  ok("current-FY voucher posted (old ledger)", (await post("2026-05-10", expOld, 800)).status === 200, "800 in FY 2026-27");
  ok("current-FY voucher posted (new ledger)", (await post("2026-06-10", expNew, 200)).status === 200, "200 in FY 2026-27");

  const report = (key) => page.goto(`${D.BASE}/company/${cid}/reports/${key}`, { waitUntil: "domcontentloaded" });
  const toggle = () => page.locator('label:has-text("Prev Year") input');

  // ---- P&L, initial window: prev column beside the current one ----
  // (R-56 semantics: the report opens on books-begin → today, i.e. FY 2025-26
  // running — so the label pair is FY 2025-26 vs FY 2024-25, and the prior
  // window overlaps the books' first months, which contain the 500 voucher.)
  await report("profit-loss");
  await page.waitForSelector("table", { timeout: 15000 });
  await toggle().check();
  await page.waitForSelector('span:has-text("FY 2025-26 vs FY 2024-25")', { timeout: 10000 }).catch(() => {});
  ok("P&L header carries the label pair (FY 2025-26 vs FY 2024-25)",
    await page.locator('span:has-text("FY 2025-26 vs FY 2024-25")').first().isVisible().catch(() => false), "labels");
  const indRow = page.locator("tr", { hasText: "Indirect Expenses" }).filter({ has: page.locator("td") }).last();
  ok("P&L prior-year value rendered (current 1,500 — both FYs — beside prior 500)",
    (await indRow.textContent())?.includes("1,500") && (await indRow.textContent())?.includes("500"), await indRow.textContent());

  // ---- move into FY 2026-27: labels flip, values follow the window ----
  await page.locator('input[type="date"]').nth(0).fill("2026-04-01");
  await page.locator('input[type="date"]').nth(1).fill("2027-03-31");
  await D.sleep(900);
  ok("labels follow the moved window (FY 2026-27 vs FY 2025-26)",
    await page.locator('span:has-text("FY 2026-27 vs FY 2025-26")').first().isVisible().catch(() => false), "label");
  const indRow2 = page.locator("tr", { hasText: "Indirect Expenses" }).filter({ has: page.locator("td") }).last();
  ok("P&L prior-year value follows the window (current 1,000 beside prior 500)",
    (await indRow2.textContent())?.includes("1,000") && (await indRow2.textContent())?.includes("500"), await indRow2.textContent());

  // ---- F12 toggles the column off and on (Tally's slot) ----
  await page.keyboard.press("F12");
  await page.locator('span:has-text(" vs ")').first().waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
  ok("F12 hides the prev column", !(await page.locator('span:has-text(" vs ")').first().isVisible().catch(() => false)), "off");
  await page.keyboard.press("F12");
  await page.locator('span:has-text(" vs ")').first().waitFor({ timeout: 8000 }).catch(() => {});
  ok("F12 shows the prev column again", await page.locator('span:has-text(" vs ")').first().isVisible().catch(() => false), "on");

  // ---- Trial Balance: per-ledger join, honest dash for new ledgers ----
  await report("trial-balance");
  await page.waitForSelector("table", { timeout: 15000 });
  await toggle().check();
  await page.waitForSelector('th:has-text("Prev")', { timeout: 10000 }).catch(() => {});
  const oldRow = page.locator("tbody tr", { hasText: "R60 Exp Old" }).first();
  const newRow = page.locator("tbody tr", { hasText: "R60 Exp New" }).first();
  await oldRow.waitFor({ timeout: 8000 });
  ok("TB prior closing joined for the ledger that existed (500)", (await oldRow.textContent())?.includes("500"), await oldRow.textContent());
  ok("TB prior cell is a dash for a ledger that did not exist last year", (await newRow.textContent())?.includes("—"), await newRow.textContent());

  // ---- Balance Sheet: as-of prior column (leaf ledger row) ----
  await report("balance-sheet");
  await page.waitForSelector("table", { timeout: 15000 });
  await toggle().check();
  await page.waitForSelector('th:has-text("Prev")', { timeout: 10000 }).catch(() => {});
  ok("BS shows the Prev column", await page.locator('th:has-text("Prev")').first().isVisible().catch(() => false), "header");
  const cashRow = page.locator("tbody tr", { hasText: "Cash-in-Hand" }).filter({ has: page.locator("td") }).last();
  await cashRow.waitFor({ timeout: 8000 });
  ok("BS prior as-of value rendered (cash net 500 at the prior as-of date)", (await cashRow.textContent())?.includes("500"), await cashRow.textContent());

  // ---- off-state honesty: turning the toggle off removes the column ----
  await toggle().uncheck();
  await D.sleep(700);
  ok("toggle off → no prev column anywhere", (await page.locator('th:has-text("Prev")').count()) === 0, "count");

  ok("no page errors during R-60 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-60 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
