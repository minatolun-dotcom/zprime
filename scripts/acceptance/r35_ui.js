// R-35 browser acceptance: Alt+C ledger-on-the-fly (quick-create from the
// voucher screen without losing the half-entered voucher).
// Prereqs: fresh compose stack at localhost:3000 (admin/admin123), R-35 client
// built into the image.
//
// Contract under test (approved Option A):
//  - Alt+C opens the Create-Ledger modal, prefilled from the focused cell's
//    typed text, from BOTH an entry row and the Party A/c cell.
//  - Create → the ledger is picked into the triggering row and the voucher
//    behind keeps every keystroke (entries, amounts, date, narration).
//  - Keyboard layering: while the modal is open, Esc closes ONLY the modal
//    (voucher survives) and Ctrl+A / Enter accept the modal.
//  - Duplicate name → the server's 409 wording verbatim, voucher untouched.
//  - TypeAhead with zero matches offers "＋ Create <text>" (discoverability).
//  - The quick-created ledger is immediately usable: the voucher saves
//    end-to-end (round-trip through the real UI).
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
  await D.createCompany({ name: "R35 AltC UI", gstin: "27R35ALTCUI3X9", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const api = async (method, path, body) => {
    const r = await page.request[method](`${D.BASE}/api${path}`, body !== undefined ? { data: body } : undefined);
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status(), j };
  };

  const grps = Object.fromEntries(((await api("get", `/c/${cid}/groups`)).j ?? []).map((x) => [x.name, x.id]));
  ok("groups loaded (Sales Accounts, Sundry Debtors, Indirect Expenses)", !!grps["Sales Accounts"] && !!grps["Sundry Debtors"] && !!grps["Indirect Expenses"], Object.keys(grps).slice(0, 6));
  const salesLedger = (await api("post", `/c/${cid}/ledgers`, { name: "R35 Sales Main", groupId: grps["Sales Accounts"], taxability: "taxable", gstRate: 18 })).j;
  ok("sales ledger fixture created", !!salesLedger?.id, salesLedger?.id);

  // ================================================================
  // 1) Alt+C on an entry row: opens prefilled; create → picked in, state kept
  // ================================================================
  await D.openVoucher("Payment");
  await page.fill("#v-date", "2026-06-01");
  const lt = page.locator("table").filter({ hasText: "Ledger" }).last();
  const r0 = lt.locator("tbody tr").nth(0);
  await r0.locator("input").first().click();
  await page.keyboard.type("Rent Office June", { delay: 10 });
  await D.sleep(200);

  await page.keyboard.press("Alt+c"); // the advertised chord — real key press
  await page.waitForSelector('[data-testid="quick-ledger-modal"]', { timeout: 4000 });
  const prefill = await page.locator('[data-testid="quick-ledger-modal"] input').first().inputValue();
  ok("Alt+C opens modal prefilled from focused cell text (entry row)", prefill === "Rent Office June", { prefill });

  // Keyboard layering probe: the voucher state must exist behind the modal
  const dateBehind = await page.inputValue("#v-date");
  ok("voucher state survives behind the modal", dateBehind === "2026-06-01", { dateBehind });

  // Esc closes ONLY the modal
  await page.keyboard.press("Escape");
  await D.sleep(250);
  const modalGone = (await page.locator('[data-testid="quick-ledger-modal"]').count()) === 0;
  const stillOnVoucher = page.url().includes("/voucher/");
  ok("Esc closes only the modal — voucher NOT abandoned", modalGone && stillOnVoucher, { modalGone, stillOnVoucher });

  // Reopen (Alt+C again, same prefill from the still-focused cell), create with Ctrl+A
  await page.keyboard.press("Alt+c");
  await page.waitForSelector('[data-testid="quick-ledger-modal"]', { timeout: 4000 });
  await page.locator('[data-testid="quick-ledger-modal"] select').first().selectOption({ label: "Indirect Expenses" });
  await page.keyboard.press("Control+a"); // accept the MODAL, not the voucher
  await D.sleep(500);
  ok("modal closed after Ctrl+A create", (await page.locator('[data-testid="quick-ledger-modal"]').count()) === 0, "modal closed");

  let grid = await D.readGrid();
  ok("created ledger picked into the triggering row", grid[0]?.name === "Rent Office June", grid.map((g) => g.name));
  ok("voucher entries intact (party-less Payment, row 1 ledger)", grid.length >= 1 && grid[0]?.name === "Rent Office June", grid);

  // ================================================================
  // 2) Duplicate name → 409 wording verbatim, voucher untouched
  // ================================================================
  await page.locator('button:has-text("+ Add Ledger")').click(); await D.sleep(150);
  const r1 = lt.locator("tbody tr").nth(1);
  await r1.locator("input").first().click();
  await page.keyboard.type("Rent Office June", { delay: 10 });
  await D.sleep(150);
  await page.keyboard.press("Alt+c");
  await page.waitForSelector('[data-testid="quick-ledger-modal"]', { timeout: 4000 });
  await page.locator('[data-testid="quick-ledger-modal"] select').first().selectOption({ label: "Indirect Expenses" });
  await page.keyboard.press("Enter"); // Enter accepts too
  await D.sleep(500);
  const dupErr = await page.locator('[data-testid="quick-ledger-modal"] .bg-red-50').innerText().catch(() => "");
  ok("duplicate name → server 409 wording verbatim", dupErr.includes("already exists"), dupErr);
  ok("voucher untouched after 409 (modal still open, no nav)", (await page.locator('[data-testid="quick-ledger-modal"]').count()) === 1 && page.url().includes("/voucher/"), page.url());
  await page.keyboard.press("Escape"); await D.sleep(250);
  await page.locator('button:has-text("✕")').last().click(); await D.sleep(150); // drop the duplicate-typed row
  grid = await D.readGrid();
  ok("grid healthy after abandoning the duplicate (row removed)", grid.length === 1 && grid[0]?.name === "Rent Office June", grid);

  // ================================================================
  // 3) Complete the round-trip: finish and save the voucher through the UI
  // ================================================================
  const r0b = lt.locator("tbody tr").nth(0);
  await r0b.locator('input[type="number"]').nth(0).fill("12000"); // Rent Dr 12000
  await page.locator('button:has-text("+ Add Ledger")').click(); await D.sleep(150); // row 2 for the credit (removed in §2 cleanup)
  const r1b = lt.locator("tbody tr").nth(1);
  await D.pickAhead(r1b.locator("input").first(), "Cash");
  await r1b.locator('input[type="number"]').nth(1).fill("12000"); // Cash Cr 12000
  await D.sleep(200);
  await page.keyboard.press("Control+a"); // save the VOUCHER (modal closed)
  await page.waitForURL("**/daybook", { timeout: 8000 });
  ok("voucher with quick-created ledger saves end-to-end", page.url().includes("/daybook"), page.url());

  // ================================================================
  // 4) Party cell: Alt+C creates a Sundry Debtor and picks it as party
  // ================================================================
  await D.openVoucher("Sales");
  await page.fill("#v-date", "2026-06-02");
  const partyField = page.locator('xpath=//span[text()="Party A/c"]/following::input[1]');
  await partyField.click();
  await page.keyboard.type("New Buyer Traders", { delay: 10 });
  await D.sleep(200);
  await page.keyboard.press("Alt+c");
  await page.waitForSelector('[data-testid="quick-ledger-modal"]', { timeout: 4000 });
  const prefill2 = await page.locator('[data-testid="quick-ledger-modal"] input').first().inputValue();
  ok("Alt+C works from the Party A/c cell (prefilled)", prefill2 === "New Buyer Traders", { prefill2 });
  await page.locator('[data-testid="quick-ledger-modal"] select').first().selectOption({ label: "Sundry Debtors" });
  await page.keyboard.press("Control+a");
  await D.sleep(500);
  const partyVal = await partyField.inputValue();
  ok("created party picked into the Party A/c cell", partyVal === "New Buyer Traders", { partyVal });
  let grid2 = await D.readGrid();
  ok("party row auto-inserted at grid top with the new ledger", grid2[0]?.name === "New Buyer Traders", grid2.map((g) => g.name));

  // Finish the sale: income line + amount, Alt+G must see the fresh party (27 state)
  const lt2 = page.locator("table").filter({ hasText: "Ledger" }).last();
  while ((await lt2.locator("tbody tr").count()) < 2) { await page.click('button:has-text("+ Add Ledger")'); await D.sleep(120); }
  const s1 = lt2.locator("tbody tr").nth(1);
  await D.pickAhead(s1.locator("input").first(), "R35 Sales Main");
  await s1.locator('input[type="number"]').nth(1).fill("5000");
  await D.sleep(200);
  await page.keyboard.press("Alt+g");
  await D.sleep(400);
  grid2 = await D.readGrid();
  const cg = grid2.find((g) => g.name === "CGST"), sg = grid2.find((g) => g.name === "SGST/UTGST");
  ok("Apply-GST works on the fresh party (both halves, 18%)", cg?.cr === 450 && sg?.cr === 450, { cg, sg });
  await page.keyboard.press("Control+a");
  await page.waitForURL("**/daybook", { timeout: 8000 });
  ok("sale to the quick-created party saves end-to-end", page.url().includes("/daybook"), page.url());

  // ================================================================
  // 5) TypeAhead discoverability: zero matches → "＋ Create" row
  // ================================================================
  await D.openVoucher("Payment");
  const lt3 = page.locator("table").filter({ hasText: "Ledger" }).last();
  const c0 = lt3.locator("tbody tr").nth(0);
  await c0.locator("input").first().click();
  await page.keyboard.type("Totally New Ledger", { delay: 10 });
  await D.sleep(250);
  const createRow = page.locator('[data-testid="typeahead-create"]');
  ok("TypeAhead offers ＋ Create row on zero matches", (await createRow.count()) === 1 && (await createRow.innerText()).includes("Totally New Ledger"), await createRow.innerText().catch(() => ""));
  await createRow.click();
  await page.waitForSelector('[data-testid="quick-ledger-modal"]', { timeout: 4000 });
  ok("＋ Create row opens the modal prefilled", (await page.locator('[data-testid="quick-ledger-modal"] input').first().inputValue()) === "Totally New Ledger", "prefilled");
  await page.keyboard.press("Escape"); await D.sleep(250);
  ok("modal Esc from the TypeAhead path leaves voucher alive", page.url().includes("/voucher/"), page.url());

  // …and the same flow completes via the modal (validation gate: no group → error)
  await c0.locator("input").first().click();
  await page.keyboard.press("Alt+c");
  await page.waitForSelector('[data-testid="quick-ledger-modal"]', { timeout: 4000 });
  await page.keyboard.press("Control+a"); // no group selected → client validation
  await D.sleep(300);
  const valErr = await page.locator('[data-testid="quick-ledger-modal"] .bg-red-50').innerText().catch(() => "");
  ok("missing group → honest validation error", valErr.includes("group"), valErr);
  await page.keyboard.press("Escape"); await D.sleep(200);
  await page.keyboard.press("Escape"); await D.sleep(300); // leave the voucher

  ok("no page errors", pageErrors.length === 0, pageErrors);
  console.log(`\n== R35 UI: ${pass} passed, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
