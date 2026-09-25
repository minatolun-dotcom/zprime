// R-64 browser acceptance: keyboard correctness + input safety + focus.
//  A) D-1: physical F2 on the voucher screen focuses the date input;
//  B) D-2: voucher F-keys are global — F5 opens Payment from Reports and
//     Masters; suppressed while a voucher is open in the editor (safety);
//  C) D-4: Alt+1 ≡ Alt+F1 (documented alias) on the Day Book;
//  D) input safety: plain letters (C A V K R U W) typed into party/narration/
//     master-search inputs enter text and NEVER navigate;
//  E) dialog safety: with the Go To overlay open, page letters are consumed
//     by the overlay (nothing behind navigates);
//  F) focus anchor: after a chord navigation (Alt+O), focus lands on the page
//     heading, not BODY.
// Prereqs: compose stack at localhost:3000 (admin/admin123) with the built
// client (docker compose build app && docker compose up -d app).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 200)}`); }
};

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  await D.createCompany({ name: `R64 Keys ${Date.now().toString(36)}`, gstin: "27R64KEYSU8K6", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created", !!cid, cid);
  const gw = `${D.BASE}/company/${cid}`;
  const focusedId = () => page.evaluate(() => document.activeElement && ((document.activeElement.id || document.activeElement.tagName)));

  // ---- A) D-1: F2 on the voucher screen ----
  await page.goto(gw, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Gateway of zprime", { timeout: 15000 });
  await page.keyboard.press("F5");
  await page.waitForURL("**/voucher/**", { timeout: 8000 });
  await page.waitForSelector("#v-date", { timeout: 8000 });
  await D.sleep(300);
  await page.keyboard.press("F2");
  await D.sleep(250);
  ok("D-1: physical F2 on the voucher focuses the Date input", (await focusedId()) === "v-date", await focusedId());

  // ---- B) D-2: global F-keys, with editor suppression ----
  await page.goto(`${gw}/reports/trial-balance`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="date"]', { timeout: 10000 });
  await page.keyboard.press("F8");
  await page.waitForURL("**/voucher/**", { timeout: 8000 });
  ok("D-2: F8 opens Sales from a report (global layer)", page.url().includes("/voucher/"), page.url());
  const salesUrl = page.url();

  await page.goto(`${gw}/masters/ledgers`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("table tbody tr", { timeout: 10000 });
  await page.keyboard.press("F5");
  await page.waitForURL("**/voucher/**", { timeout: 8000 });
  ok("D-2: F5 opens Payment from a masters page", page.url().includes("/voucher/"), page.url());

  // suppression: on an open voucher editor, F8 must NOT navigate away
  await page.goto(salesUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#v-date", { timeout: 8000 });
  await D.sleep(300);
  await page.keyboard.press("F8");
  await D.sleep(500);
  ok("D-2 safety: F-key suppressed while a voucher is open in the editor", page.url() === salesUrl, { now: page.url(), was: salesUrl });
  await page.keyboard.press("Escape");
  await D.sleep(500);

  // ---- C) D-4: Alt+1 ≡ Alt+F1 (Reports' detailed/condensed toggle).
  // Seeded TB groups show detail rows only when Alt+F1 detailed is ON, so
  // the toggle is observable on a seeded company. ----
  await page.goto(`${gw}/reports/trial-balance`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="date"]', { timeout: 10000 });
  await D.sleep(500);
  // The observable state is the rail chip label ("Detailed" ⇄ "Condensed") —
  // an empty seeded TB has no rows for the toggle to reveal.
  const chipLabel = () => page.locator('aside button:has-text("etailed"), aside button:has-text("ondensed")').first().textContent();
  const before = await chipLabel();
  await page.keyboard.press("Alt+1");
  await D.sleep(500);
  const after = await chipLabel();
  ok("D-4: Alt+1 ≡ Alt+F1 toggles the report detail level (rail chip flips)", before !== after, { before, after });

  // ---- D) input safety: letters never navigate while typing ----
  await page.goto(`${gw}/masters/ledgers`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[placeholder*="earch" i], input[type="text"]', { timeout: 10000 });
  const search = page.locator('input[placeholder*="earch" i], input[type="text"]').first();
  for (const letter of ["c", "a", "v", "k", "r", "u", "w", "R", "K"]) {
    await search.click();
    await page.keyboard.press(letter);
  }
  const typed = await search.inputValue();
  ok("input safety: CAVKRUW + R/K typed into master search = text, no navigation", typed === "cavkruwRK" && page.url().includes("/masters/ledgers"), { typed, url: page.url() });

  await page.goto(gw, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Gateway of zprime", { timeout: 15000 });
  await page.keyboard.press("F5"); // Payment voucher
  await page.waitForURL("**/voucher/**", { timeout: 8000 });
  await page.waitForSelector("#v-party, input[id*='party' i]", { timeout: 8000 }).catch(() => {});
  const party = page.locator("#v-ref").first();
  if (await party.isVisible().catch(() => false)) {
    await party.click();
    await page.keyboard.type("Ramesh", { delay: 40 });
    const val = await party.inputValue().catch(() => "");
    ok("input safety: typing 'Ramesh' into Ref/Party enters text, never navigates", val.includes("Ramesh") && page.url().includes("/voucher/"), { val, url: page.url() });
  } else {
    const narr = page.locator('input[placeholder="Being…"]').first();
    await narr.click();
    await page.keyboard.type("Ramesh", { delay: 40 });
    const val = await narr.inputValue().catch(() => "");
    ok("input safety: typing 'Ramesh' into narration enters text, never navigates", val.includes("Ramesh") && page.url().includes("/voucher/"), { val, url: page.url() });
  }

  // ---- E) dialog safety: GoTo consumes keys; nothing behind navigates ----
  await page.goto(gw, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Gateway of zprime", { timeout: 15000 });
  await page.keyboard.press("Alt+g");
  await page.waitForSelector('[data-testid="goto-input"]', { timeout: 5000 });
  await page.keyboard.press("k");
  await D.sleep(300);
  ok("dialog safety: with GoTo open, plain K types into the overlay (no Day Book nav)",
    page.url().endsWith(`/company/${cid}`) && (await page.locator('[data-testid="goto-input"]').inputValue()) === "k",
    { url: page.url() });
  await page.keyboard.press("Escape");
  await D.sleep(250);
  ok("dialog safety: Esc closes the overlay without history-back", page.url().endsWith(`/company/${cid}`), page.url());

  // quick-create modal layering (voucher): Esc closes only the modal
  await page.keyboard.press("F5");
  await page.waitForURL("**/voucher/**", { timeout: 8000 });
  await page.waitForSelector("#v-date", { timeout: 8000 });
  await page.keyboard.press("Alt+c");
  await page.waitForSelector('[data-testid="quick-ledger-modal"]', { timeout: 5000 });
  await page.keyboard.press("Escape");
  await D.sleep(300);
  ok("dialog safety: Esc closes the quick-create modal, voucher stays",
    page.url().includes("/voucher/") && !(await page.locator('[data-testid="quick-ledger-modal"]').isVisible().catch(() => false)), page.url());

  // ---- F) focus anchor after chord navigation ----
  await page.goto(gw, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Gateway of zprime", { timeout: 15000 });
  await page.keyboard.press("Alt+o");
  await page.waitForURL("**/reports/chart-of-accounts**", { timeout: 8000 });
  await D.sleep(400);
  const focusTag = await page.evaluate(() => document.activeElement?.tagName);
  ok("focus anchor: after Alt+O navigation focus is on the page heading or main region (not BODY)", focusTag === "H1" || focusTag === "MAIN", focusTag);

  ok("no page errors during R-64 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-64 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
