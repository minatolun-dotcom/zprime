// R-36 browser acceptance: arrow-key grid navigation — the voucher grid moves
// like a spreadsheet.
// Prereqs: fresh compose stack at localhost:3000 (admin/admin123), R-36 client
// built into the image.
//
// Contract under test (approved Option A):
//  - ArrowDown/ArrowUp move focus within the SAME column across rows in the
//    entries grid and the inventory grid (real key presses).
//  - Column preserved: Dr → next-row Dr, ledger → next-row ledger, etc.
//  - The disabled bill cell (non-bill-wise ledger) is skipped, never focused.
//  - TypeAhead dropdown arrows still walk the highlight when matches are open
//    (and do NOT move the grid cell); with zero matches arrows move the cell.
//  - Modifier chords (Alt/Ctrl+Arrow) are no-ops for the grid.
//  - Enter on the last amount row STILL adds a row (advertised affordance);
//    ArrowDown on the last row does NOT add one.
//  - End-to-end: a voucher entered arrow-first saves cleanly.
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
  await D.createCompany({ name: "R36 Arrows UI", gstin: "27R36ARROWSU4X1", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const api = async (method, path, body) => {
    const r = await page.request[method](`${D.BASE}/api${path}`, body !== undefined ? { data: body } : undefined);
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status(), j };
  };

  const grps = Object.fromEntries(((await api("get", `/c/${cid}/groups`)).j ?? []).map((x) => [x.name, x.id]));
  const led = async (name, groupId, extra = {}) => (await api("post", `/c/${cid}/ledgers`, { name, groupId, ...extra })).j;
  const exp = await led("R36 Expenses", grps["Indirect Expenses"]);
  const rent = await led("R36 Rent", grps["Indirect Expenses"]);
  const misc = await led("R36 Misc", grps["Indirect Expenses"]);
  const cashOk = ((await api("get", `/c/${cid}/ledgers`)).j ?? []).find((l) => l.name === "Cash");
  ok("fixtures ready (3 expense ledgers + Cash)", !!exp?.id && !!rent?.id && !!misc?.id && !!cashOk?.id, [exp?.id, rent?.id, misc?.id, cashOk?.id]);

  const focused = async () => {
    return page.evaluate(() => {
      const el = document.activeElement;
      return { col: el?.getAttribute("data-col") ?? null, row: el?.closest("tr") ? Array.from(el.closest("tr").parentElement.children).indexOf(el.closest("tr")) : null, tag: el?.tagName };
    });
  };

  // ================================================================
  // 1) Entries grid: same-column Down/Up across three rows
  // ================================================================
  await D.openVoucher("Payment");
  const lt = page.locator("table").filter({ hasText: "Ledger" }).last();
  while ((await lt.locator("tbody tr").count()) < 4) { await page.click('button:has-text("+ Add Ledger")'); await D.sleep(120); } // 3 data rows + Total
  const row0 = lt.locator("tbody tr").nth(0);
  await row0.locator("input").first().click();
  await D.pickAhead(row0.locator("input").first(), "R36 Rent");
  await row0.locator('input[data-col="dr"]').fill("100");
  await page.locator('input[data-col="dr"]').nth(0).focus();
  await page.keyboard.press("ArrowDown");
  let f = await focused();
  ok("ArrowDown moves Dr → next row's Dr", f.col === "dr" && f.row === 1, f);
  await page.keyboard.press("ArrowDown");
  f = await focused();
  ok("ArrowDown again reaches row 2's Dr", f.col === "dr" && f.row === 2, f);
  await page.keyboard.press("ArrowUp");
  f = await focused();
  ok("ArrowUp returns to row 1's Dr (same column)", f.col === "dr" && f.row === 1, f);
  // Up from row 1's Dr skips nothing to row 0's Dr
  await page.keyboard.press("ArrowUp");
  f = await focused();
  ok("ArrowUp reaches row 0's Dr", f.col === "dr" && f.row === 0, f);

  // Ledger column movement too. NOTE: a ledger cell holding matching text
  // opens the TypeAhead dropdown on focus, and arrows then own the dropdown
  // (by design) — so clear the cell text first to make matches zero and let
  // arrows reach the grid.
  await row0.locator("input").first().fill("");
  await row0.locator("input").first().focus();
  await D.sleep(150);
  await page.keyboard.press("ArrowDown");
  f = await focused();
  ok("ArrowDown moves ledger → next row's ledger (dropdown closed/empty)", f.col === "ledger" && f.row === 1, f);
  await page.keyboard.press("ArrowUp");
  f = await focused();
  ok("ArrowUp returns to row 0's ledger", f.col === "ledger" && f.row === 0, f);

  // ================================================================
  // 2) Disabled bill cell is skipped, never focused
  // ================================================================
  await lt.locator("tbody tr").nth(0).locator('input[data-col="dr"]').focus();
  // walk down through rows: from row0 dr, Down → row1 dr. Bill cells are
  // disabled (none of R36 ledgers are billWise) — Down from ledger col must
  // skip them and land on the next row's ledger, never the bill input.
  await lt.locator("tbody tr").nth(0).locator('input[data-col="ledger"]').fill("");
  await lt.locator("tbody tr").nth(0).locator('input[data-col="ledger"]').focus();
  await D.sleep(150);
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
  f = await focused();
  ok("walk Down 3× from ledger stays on ledger column (bill disabled skipped)", f.col === "ledger" && f.row === 2, f);

  // ================================================================
  // 3) ArrowDown on last row does NOT add a row; Enter does (regression anchor)
  // ================================================================
  const before = await lt.locator("tbody tr").count();
  await lt.locator("tbody tr").nth(2).locator('input[data-col="dr"]').focus();
  await page.keyboard.press("ArrowDown");
  const afterDown = await lt.locator("tbody tr").count();
  ok("ArrowDown on last row does NOT add a row", afterDown === before, { before, afterDown });
  f = await focused();
  ok("and focus stays on the last row's Dr", f.col === "dr" && f.row === 2, f);
  await page.keyboard.press("Enter");
  await D.sleep(300);
  const afterEnter = await lt.locator("tbody tr").count();
  ok("Enter on last amount row STILL adds a row (advertised affordance)", afterEnter === before + 1, { before, afterEnter });
  f = await focused();
  ok("focus lands on the new row's ledger cell", f.col === "ledger" && f.row === 3, f);

  // ================================================================
  // 4) Modifier chords are grid no-ops
  // ================================================================
  await lt.locator("tbody tr").nth(0).locator('input[data-col="dr"]').focus();
  await page.keyboard.press("Control+ArrowDown");
  f = await focused();
  ok("Ctrl+ArrowDown is a no-op for the grid", f.col === "dr" && f.row === 0, f);
  await page.keyboard.press("Alt+ArrowDown");
  f = await focused();
  ok("Alt+ArrowDown is a no-op for the grid", f.col === "dr" && f.row === 0, f);

  // ================================================================
  // 5) TypeAhead interplay: dropdown arrows own the highlight; zero-match arrows move the cell
  // ================================================================
  await lt.locator("tbody tr").nth(1).locator('input[data-col="ledger"]').focus();
  await page.keyboard.type("R36", { delay: 12 }); // matches open (3 ledgers)
  await D.sleep(250);
  const dd = lt.locator("tbody tr").nth(1).locator("div.absolute");
  ok("TypeAhead dropdown open with matches", (await dd.count()) === 1, await dd.count());
  const hiBefore = await page.evaluate(() => document.activeElement?.closest("tr") ? Array.from(document.activeElement.closest("tr").parentElement.children).indexOf(document.activeElement.closest("tr")) : null);
  await page.keyboard.press("ArrowDown");
  await D.sleep(150);
  const stillTypeahead = await page.evaluate(() => document.activeElement?.getAttribute("data-col"));
  ok("ArrowDown with dropdown open stays in the TypeAhead (no cell move)", stillTypeahead === "ledger" && (await focused()).row === hiBefore, { stillTypeahead, row: await focused() });
  // blur to close the dropdown (click the narration input), clear the cell text
  // (matching text would legitimately reopen the dropdown on focus), then
  // arrows must move the cell again
  await page.click('input[placeholder^="Being"]');
  await D.sleep(250);
  await lt.locator("tbody tr").nth(1).locator('input[data-col="ledger"]').fill("");
  await lt.locator("tbody tr").nth(1).locator('input[data-col="ledger"]').focus();
  await D.sleep(200);
  await D.sleep(150);
  await page.keyboard.press("ArrowDown");
  f = await focused();
  ok("ArrowDown with dropdown closed moves the cell", f.col === "ledger" && f.row === 2, f);

  // ================================================================
  // 6) Inventory grid: same-column Down on qty → next row's qty
  // ================================================================
  const unit = (await api("post", `/c/${cid}/units`, { name: "Pieces", symbol: "pcs" })).j; // unitId is NOT NULL on stock_items
  const items = (await api("post", `/c/${cid}/stock-items`, { name: "R36 Widget", unitId: unit.id, gstRate: 18, taxability: "taxable", standardCost: 50, standardSalePrice: 80 })).j;
  const item2 = (await api("post", `/c/${cid}/stock-items`, { name: "R36 Gadget", unitId: unit.id, gstRate: 18, taxability: "taxable", standardCost: 30, standardSalePrice: 60 })).j;
  ok("stock items created", !!items?.id && !!item2?.id, [items?.id, item2?.id]);

  await D.openVoucher("Delivery Note");
  await page.fill("#v-date", "2026-06-05");
  const it = page.locator("table").filter({ hasText: "Qty" }).last();
  await page.click('button:has-text("+ Add Item")'); await D.sleep(150);
  const r0 = it.locator("tbody tr").nth(0);
  await D.pickAhead(r0.locator("input").first(), "R36 Widget");
  await r0.locator('input[data-col="qty"]').fill("2");
  const r1 = it.locator("tbody tr").nth(1);
  await D.pickAhead(r1.locator("input").first(), "R36 Gadget");
  await r1.locator('input[data-col="qty"]').focus();
  await page.keyboard.press("ArrowUp");
  f = await focused();
  ok("inventory: ArrowUp from row-1 qty → row-0 qty (same column)", f.col === "qty" && f.row === 0, f);
  await page.keyboard.press("ArrowDown");
  f = await focused();
  ok("inventory: ArrowDown returns to row-1 qty", f.col === "qty" && f.row === 1, f);
  // selects (godown) are never targets: from qty, Up must not land on a select
  const tag = (await focused()).tag;
  ok("inventory arrows never focus a select", tag === "INPUT", tag);

  // ================================================================
  // 7) End-to-end: arrow-first voucher saves cleanly
  // ================================================================
  await D.openVoucher("Payment");
  const lt2 = page.locator("table").filter({ hasText: "Ledger" }).last();
  while ((await lt2.locator("tbody tr").count()) < 4) { await page.click('button:has-text("+ Add Ledger")'); await D.sleep(120); }
  const q0 = lt2.locator("tbody tr").nth(0);
  await D.pickAhead(q0.locator("input").first(), "R36 Rent");
  await q0.locator('input[data-col="dr"]').fill("250");
  await q0.locator('input[data-col="dr"]').focus();
  await page.keyboard.press("ArrowDown"); // row 1 dr
  await page.keyboard.type("150");
  // same-column guarantee: Up from row-1 Dr goes back to row-0 Dr (never sideways)
  await page.keyboard.press("ArrowUp");
  f = await focused();
  ok("ArrowUp from row-1 Dr returns to row-0 Dr (same-column invariant)", f.col === "dr" && f.row === 0, f);
  await D.pickAhead(page.locator("tbody tr").nth(1).locator("input").first(), "R36 Misc");
  const q1 = lt2.locator("tbody tr").nth(1);
  await q1.locator('input[data-col="dr"]').fill("150");
  const q2 = lt2.locator("tbody tr").nth(2);
  await D.pickAhead(q2.locator("input").first(), "Cash");
  await q2.locator('input[data-col="cr"]').fill("400");
  await D.sleep(200);
  await page.keyboard.press("Control+a");
  await page.waitForURL("**/daybook", { timeout: 8000 });
  ok("arrow-first voucher saves end-to-end", page.url().includes("/daybook"), page.url());

  ok("no page errors", pageErrors.length === 0, pageErrors);
  console.log(`\n== R36 UI: ${pass} passed, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
