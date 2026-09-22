// R-43 browser acceptance: the F-42-1 hydration guard on the REAL voucher UI.
// Prereqs: fresh compose stack at localhost:3000 (admin/admin123), R-43 client
// built into the image.
//
// Contract under test (approved R-42 → R-43 scope):
//  - While a freshly mounted voucher screen's options query is on its INITIAL
//    fetch (no data yet), typing a ledger name that WILL match loaded data
//    must NOT offer "＋ Create" nor take the Enter→quick-create path
//    (v1.41 behavior opened the modal — the exact operator trap).
//    A non-interactive "Loading options…" hint shows instead.
//  - After options load, R-35 behavior is byte-identical: zero-match text
//    offers "＋ Create", Enter opens the modal prefilled, creation picks the
//    ledger into the triggering field.
//  - Cached mounts (warm query cache) never see the guard: the create row is
//    immediately available even on a just-opened voucher.
//  - Round-trip: a voucher saved with the guard active persists and reaches
//    the Day Book (no behavior change for authorized flows).
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
  await D.createCompany({ name: "R43 Guard UI", gstin: "27R43GUARDUI4K2", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const api = async (method, path, body) => {
    const r = await page.request[method](`${D.BASE}/api${path}`, body !== undefined ? { data: body } : undefined);
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status(), j };
  };

  // Fixtures: a buyer and a supplier that EXIST but will not be in the
  // TypeAhead options while the initial fetch is held.
  const grps = Object.fromEntries(((await api("get", `/c/${cid}/groups`)).j ?? []).map((x) => [x.name, x.id]));
  ok("seeded groups loaded", !!grps["Sundry Debtors"] && !!grps["Sundry Creditors"] && !!grps["Indirect Expenses"], Object.keys(grps).length);
  await api("post", `/c/${cid}/ledgers`, { name: "R43 Preexist Buyer", groupId: grps["Sundry Debtors"], gstReg: "none", taxability: "none" });
  await api("post", `/c/${cid}/ledgers`, { name: "R43 Preexist Supplier", groupId: grps["Sundry Creditors"], gstReg: "none", taxability: "none" });
  await api("post", `/c/${cid}/ledgers`, { name: "R43 Rent Expense", groupId: grps["Indirect Expenses"], taxability: "none" });

  const partyField = page.locator('xpath=//span[text()="Party A/c"]/following::input[1]');
  const modal = page.locator('[data-testid="quick-ledger-modal"]');
  const createRow = page.locator('[data-testid="typeahead-create"]');
  const loadingRow = page.locator('[data-testid="typeahead-loading"]');

  // ================================================================
  // 1) Hydration window: options fetch HELD → existing name must NOT
  //    offer create nor open the modal on Enter
  // ================================================================
  await page.route(`**/api/c/${cid}/ledgers?*`, async (route) => {
    await new Promise((r) => setTimeout(r, 1400));
    await route.continue();
  });
  await page.route(`**/api/c/${cid}/ledgers`, async (route) => {
    await new Promise((r) => setTimeout(r, 1400));
    await route.continue();
  });

  await D.openVoucher("Sales");
  await page.fill("#v-date", "2026-06-01");
  await partyField.click();
  await page.keyboard.type("R43 Preexist", { delay: 12 });
  await D.sleep(250);

  ok("hydration window: create row NOT offered (existing name, options still loading)",
    (await createRow.count()) === 0, "create row hidden while loading");
  ok("hydration window: Loading hint visible",
    await loadingRow.isVisible().catch(() => false), "loading hint shown");

  await page.keyboard.press("Enter");
  await D.sleep(700);
  ok("hydration window: Enter does NOT open quick-create (the F-42-1 trap)",
    (await modal.count()) === 0, "no modal during loading");

  // Restore the route; the held response lands and the options hydrate.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await D.sleep(1800); // held response (1.4s) resolves; query data arrives

  // The typed prefix now matches the loaded ledger — Enter picks it.
  const partyStillFocused = await partyField.evaluate((el) => el === document.activeElement);
  if (!partyStillFocused) await partyField.click();
  await page.keyboard.press("Enter");
  await D.sleep(300);
  const pickedVal = await partyField.inputValue();
  ok("after load: Enter picks the existing ledger (matching restored)",
    pickedVal.includes("R43 Preexist"), { pickedVal });

  // ================================================================
  // 2) Post-load regression: R-35 create path byte-identical
  // ================================================================
  await partyField.click();
  await partyField.fill("");
  await page.keyboard.type("R43 Unknown Vendor", { delay: 10 });
  await D.sleep(250);
  ok("after load: zero-match create row offered again", await createRow.isVisible().catch(() => false), "create row restored");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-testid="quick-ledger-modal"]', { timeout: 4000 });
  const prefill = await modal.locator("input").first().inputValue();
  ok("after load: Enter opens modal prefilled (R-35 contract)", prefill === "R43 Unknown Vendor", { prefill });
  await modal.locator("select").first().selectOption({ label: "Sundry Debtors" });
  await page.keyboard.press("Control+a"); // accept the MODAL
  await D.sleep(600);
  const partyAfter = await partyField.inputValue();
  ok("after load: created ledger picked into the party field",
    (await modal.count()) === 0 && partyAfter === "R43 Unknown Vendor", { partyAfter });
  // Abandon this Sales voucher (no amounts entered) — §2 is about the create path only.
  await page.keyboard.press("Escape");
  await D.sleep(400);

  // ================================================================
  // 3) Cached mounts never see the guard + round-trip save
  // ================================================================
  await D.openVoucher("Payment");
  // The very first keystrokes after mount: cache is warm (all-ledgers fetched
  // in §1/§2), so isLoading is false immediately — create row, not Loading.
  const row0 = page.locator("table").filter({ hasText: "Ledger" }).last().locator("tbody tr").nth(0);
  await row0.locator("input").first().click();
  await page.keyboard.type("R43 Nobody XYZ", { delay: 10 });
  await D.sleep(220);
  ok("cached mount: create row immediately available (no guard on warm cache)",
    (await createRow.isVisible().catch(() => false)) && !(await loadingRow.isVisible().catch(() => false)),
    { create: await createRow.isVisible().catch(() => false), loading: await loadingRow.isVisible().catch(() => false) });
  // Real save with the guard active in the tree: Supplier Dr / Cash Cr
  // (no Escape here — on this screen Esc would abandon the voucher;
  // pickAhead clears the typed probe text itself).
  await D.pickAhead(row0.locator("input").first(), "R43 Preexist Supplier");
  await row0.locator('input[type="number"]').nth(0).fill("3000");
  await page.locator('button:has-text("+ Add Ledger")').click(); await D.sleep(150);
  const row1 = page.locator("table").filter({ hasText: "Ledger" }).last().locator("tbody tr").nth(1);
  await D.pickAhead(row1.locator("input").first(), "Cash");
  await row1.locator('input[type="number"]').nth(1).fill("3000");
  await D.sleep(200);
  await page.keyboard.press("Control+a");
  await page.waitForURL("**/daybook", { timeout: 8000 });
  ok("round-trip: voucher with guard-active build saves to Day Book", page.url().includes("/daybook"), page.url());

  ok("no page errors across the suite", pageErrors.length === 0, pageErrors);

  console.log(`\nR-43 UI: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
