// R-54 browser acceptance: TallyPrime shortcut parity (Option A + Option B).
// A1) every seeded voucher F-key works at the Gateway (rail + keyboard F4/F6/F7);
// A2) Alt+D deletes the open voucher (confirm dialog); A3) Alt+X cancels it;
// A4) F3 = change company (Shell-level, works on the breadcrumbless Gateway);
// A5) +/- step the report period; B1) Alt+G Go To palette: opens everywhere,
// type-to-filter, Enter navigates, Esc closes WITHOUT history-back; B2)
// Alt+J = apply-GST (moved off Alt+G, Tally's statutory-adjustment slot).
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
  await D.createCompany({ name: "R54 Parity", gstin: "27R54PARITY9K2", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created", !!cid, cid);
  const gw = `${D.BASE}/company/${cid}`;

  const api = async (method, path, body) => {
    const r = await page.request[method](`${D.BASE}/api${path}`, body !== undefined ? { data: body } : undefined);
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status(), j };
  };

  const gateway = async () => {
    await page.goto(gw, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=Gateway of zprime", { timeout: 15000 });
    await D.sleep(300);
  };

  // ---- A1) data-driven Gateway F-keys: rail + keyboard ----
  await gateway();
  const railKeys = await page.evaluate(() =>
    [...document.querySelectorAll("aside .fkey-chip")].map((el) => el.textContent.trim())
  );
  ok("Gateway rail carries every seeded F-key", ["F4", "F5", "F6", "F7", "F8", "F9"].every((k) => railKeys.includes(k)), railKeys);
  const openedUrls = [];
  for (const key of ["F4", "F6", "F7"]) {
    await gateway();
    await page.keyboard.press(key);
    await D.sleep(600);
    // voucher URLs carry the type's ID, not its name — assert the screen + distinct ids
    openedUrls.push(page.url());
    ok(`Gateway ${key} opens a voucher screen from anywhere`, /\/voucher\/\d+\/new$/.test(page.url()), page.url());
  }
  ok("each F-key opened a distinct voucher type (distinct ids)", new Set(openedUrls.map((u) => u.split("/").slice(-2)[0])).size === 3, openedUrls);

  // ---- B1) Alt+G Go To from the bare Gateway ----
  await gateway();
  await page.keyboard.press("Alt+g");
  await D.sleep(300);
  ok("Alt+G opens Go To on the Gateway", await page.locator('[data-testid="goto-input"]').isVisible().catch(() => false));
  await page.fill('[data-testid="goto-input"]', "trial");
  await page.waitForFunction(
    () => {
      const b = document.querySelector('[data-testid="goto-results"] button');
      return !!b && !!b.textContent && b.textContent.includes("Trial Balance");
    },
    { timeout: 5000 }
  );
  const firstHit = await page.locator('[data-testid="goto-results"] button').first().textContent().catch(() => "");
  ok("Go To type-to-filter finds Trial Balance", (firstHit ?? "").includes("Trial Balance"), firstHit);
  await page.keyboard.press("Enter");
  await D.sleep(600);
  ok("Go To Enter navigates to the report", page.url().includes("/reports/trial-balance"), page.url());

  // ---- B1) Esc closes Go To WITHOUT history-back; trail stays intact ----
  await gateway(); // clean SPA stack: Gateway is the current entry
  await page.keyboard.press("F8"); // Gateway -> voucher (history entry)
  await D.sleep(600);
  ok("F8 opened a voucher (history setup)", /\/voucher\/\d+\/new$/.test(page.url()), page.url());
  await page.keyboard.press("Alt+g");
  await D.sleep(300);
  ok("Alt+G opens Go To from a voucher screen", await page.locator('[data-testid="goto-input"]').isVisible().catch(() => false));
  await page.fill('[data-testid="goto-input"]', "day book");
  await page.waitForFunction(
    () => {
      const b = document.querySelector('[data-testid="goto-results"] button');
      return !!b && !!b.textContent && b.textContent.includes("Day Book");
    },
    { timeout: 5000 }
  );
  await page.keyboard.press("Enter");
  await D.sleep(600);
  ok("Go To navigates voucher screen -> Day Book", page.url().includes("/daybook"), page.url());
  await page.keyboard.press("Alt+g");
  await D.sleep(300);
  await page.keyboard.press("Escape");
  await D.sleep(300);
  ok("Esc closes Go To (palette gone, page unchanged)",
    !(await page.locator('[data-testid="goto-input"]').isVisible().catch(() => false)) && page.url().includes("/daybook"), page.url());
  await page.keyboard.press("Escape"); // genuine history-back must still work
  await D.sleep(500);
  ok("Esc after Go To still history-backs (to the voucher)", /\/voucher\/\d+\/new$/.test(page.url()), page.url());

  // ---- A4) F3 = change company, works on the breadcrumbless Gateway ----
  await gateway();
  await page.keyboard.press("F3");
  await D.sleep(700);
  ok("F3 at the Gateway opens company select", page.url().endsWith("/companies"), page.url());
  await page.goBack();
  await D.sleep(500);
  ok("browser Back from companies returns to the Gateway", new RegExp(`/company/${cid}$`).test(page.url()), page.url());

  // ---- A5) +/- step the report period (range length kept) ----
  await page.goto(`${D.BASE}/company/${cid}/reports/trial-balance`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="date"]');
  await D.sleep(400);
  const dates = () => page.locator('input[type="date"]').evaluateAll((els) => els.map((e) => e.value).filter(Boolean));
  const before = await dates();
  const dayMs = 86400000;
  const shifted = (a, b, dir) => a.length === b.length && a.every((v, i) =>
    Math.round((new Date(b[i]).getTime() - new Date(v).getTime()) / dayMs) === dir);
  await page.keyboard.press("-");
  await D.sleep(300);
  const afterMinus = await dates();
  ok("- steps the period back one day (range kept)", shifted(before, afterMinus, -1), { before, afterMinus });
  await page.keyboard.press("+");
  await D.sleep(300);
  const afterPlus = await dates();
  ok("+ steps the period forward (back to the original)", shifted(afterMinus, afterPlus, 1) && afterPlus[0] === before[0], { afterMinus, afterPlus });

  // ---- A3) Alt+X cancels the open voucher (confirm accepted) ----
  const day = "2026-06-10";
  const grpsA = Object.fromEntries(((await api("get", `/c/${cid}/groups`)).j ?? []).map((x) => [x.name, x.id]));
  await api("post", `/c/${cid}/ledgers`, { name: "R54 Cash", groupId: grpsA["Cash-in-Hand"] });
  await api("post", `/c/${cid}/ledgers`, { name: "R54 Exp", groupId: grpsA["Indirect Expenses"] });
  await D.enterVoucher({ type: "Payment", date: day, lines: [{ ledger: "R54 Cash", dr: 500 }, { ledger: "R54 Exp", cr: 500 }] });
  await D.sleep(400);
  const list = (await api("get", `/c/${cid}/vouchers?from=${day}&to=${day}`)).j;
  const vid = Array.isArray(list) ? list[0]?.id : null;
  ok("payment voucher exists for the action checks", !!vid, list);
  await page.goto(`${D.BASE}/company/${cid}/voucher/${vid}/edit`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Ledger Entries", { timeout: 15000 });
  await D.sleep(400);
  await page.once("dialog", (d) => d.accept());
  await page.keyboard.press("Alt+x");
  await D.sleep(900);
  const afterCancel = (await api("get", `/c/${cid}/vouchers/${vid}`)).j;
  ok("Alt+X cancels the voucher (isCancelled, row kept)", afterCancel?.isCancelled === true, afterCancel);
  ok("Alt+X returns to the Day Book", page.url().includes("/daybook"), page.url());

  // ---- A2) Alt+D deletes (uncancel first — R-02 frozen-state rule) ----
  await api("post", `/c/${cid}/vouchers/${vid}/uncancel`, {});
  await page.goto(`${D.BASE}/company/${cid}/voucher/${vid}/edit`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Ledger Entries", { timeout: 15000 });
  await D.sleep(400);
  await page.once("dialog", (d) => d.accept());
  await page.keyboard.press("Alt+d");
  await D.sleep(900);
  const afterDelete = (await api("get", `/c/${cid}/vouchers?from=${day}&to=${day}`)).j;
  ok("Alt+D deleted the voucher (gone from the books)", Array.isArray(afterDelete) && !afterDelete.some((r) => r.id === vid), afterDelete);
  ok("Alt+D returns to the Day Book", page.url().includes("/daybook"), page.url());

  // ---- B2) Alt+J applies GST (r34 fixture pattern); Alt+G is Go To now ----
  const grps = Object.fromEntries(((await api("get", `/c/${cid}/groups`)).j ?? []).map((x) => [x.name, x.id]));
  await api("post", `/c/${cid}/ledgers`, { name: "R54 Sales Main", groupId: grps["Sales Accounts"], taxability: "taxable", gstRate: 18 });
  await api("post", `/c/${cid}/ledgers`, { name: "R54 Local Party", groupId: grps["Sundry Debtors"], gstin: "27R54LOCALP1X5" });
  // r34 recipe: fill the voucher, fire the chord on the UNSAVED screen.
  await D.openVoucher("Sales");
  await page.fill("#v-date", "2026-06-11");
  const partyField = page.locator('xpath=//span[text()="Party A/c"]/following::input[1]');
  await D.pickAhead(partyField, "R54 Local Party");
  const ltable = page.locator("table").filter({ hasText: "Ledger" }).last();
  while ((await ltable.locator("tbody tr").count()) < 2) { await page.click('button:has-text("+ Add Ledger")'); await D.sleep(120); }
  const row1 = ltable.locator("tbody tr").nth(1);
  await D.pickAhead(row1.locator("input").first(), "R54 Sales Main");
  await row1.locator('input[type="number"]').nth(1).fill("10000");
  await D.sleep(200);
  await page.keyboard.press("Alt+j");
  await D.sleep(500);
  const grid = await D.readGrid();
  const cgst = grid.find((g) => /CGST/i.test(g.name) && Math.abs((g.cr ?? 0) - 900) < 0.02);
  const sgst = grid.find((g) => /SGST/i.test(g.name) && Math.abs((g.cr ?? 0) - 900) < 0.02);
  ok("Alt+J applies GST — both halves at ₹900 (moved from Alt+G)", !!cgst && !!sgst, grid.map((g) => g.name));
  await page.keyboard.press("Alt+g");
  await D.sleep(300);
  ok("Alt+G on a voucher screen opens Go To (not apply-GST)", await page.locator('[data-testid="goto-input"]').isVisible().catch(() => false));
  await page.keyboard.press("Escape"); // close the palette
  await D.sleep(300);
  await page.keyboard.press("Escape"); // abandon the unsaved voucher
  await D.sleep(400);

  ok("no page errors during R-54 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-54 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
