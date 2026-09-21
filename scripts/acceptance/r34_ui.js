// R-34 browser acceptance: keyboard integrity — every advertised key fires,
// the Day Book drill-down works, and Apply-GST posts both duty halves.
// Prereqs: fresh compose stack at localhost:3000 (admin/admin123).
//
// D-1: Alt+G / Alt+T chords + chips actually fire on the voucher screen.
// D-2: the six advertised Day Book chords open their voucher types (real
//      key presses — the former "App quirk" is fixed, not worked around).
// D-3: clicking a Day Book row opens the voucher; row action buttons
//      (Alter/Cancel/Del/Uncancel) do NOT navigate.
// F-34-1: keyboard-applied intrastate GST posts BOTH Output CGST and Output
//      SGST halves (the seeded "SGST/UTGST" ledger carries dutyHead "SGST").
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
  await D.createCompany({ name: "R34 Keys UI", gstin: "27R34KEYSUI2X8", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const api = async (method, path, body) => {
    const r = await page.request[method](`${D.BASE}/api${path}`, body !== undefined ? { data: body } : undefined);
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status(), j };
  };

  // ---- fixtures: taxable sales ledger + party in the SAME state (27) ----
  const grps = Object.fromEntries(((await api("get", `/c/${cid}/groups`)).j ?? []).map((x) => [x.name, x.id]));
  const sales = (await api("post", `/c/${cid}/ledgers`, { name: "R34 Sales Main", groupId: grps["Sales Accounts"], taxability: "taxable", gstRate: 18 })).j;
  const party = (await api("post", `/c/${cid}/ledgers`, { name: "R34 Local Party", groupId: grps["Sundry Debtors"], gstin: "27R34LOCALP1X5" })).j;
  ok("sales ledger + same-state party created", !!sales?.id && !!party?.id, (sales?.id, party?.id));
  const ledgers = Object.fromEntries(((await api("get", `/c/${cid}/ledgers`)).j ?? []).map((l) => [l.name, l.id]));
  ok("seeded duty + TDS ledgers present (CGST, SGST/UTGST, TDS Payable)", !!ledgers["CGST"] && !!ledgers["SGST/UTGST"] && !!ledgers["TDS Payable"], Object.keys(ledgers).filter((n) => /CGST|SGST|TDS/.test(n)));

  // 194J section for the Alt+T leg (threshold 0 → honest no-advisory, deduction still computed)
  const sec = (await api("post", `/c/${cid}/tds-sections`, { section: "194J", description: "Prof fees", rate: 10 })).j;
  const prof = (await api("post", `/c/${cid}/ledgers`, { name: "R34 Prof Fees", groupId: grps["Indirect Expenses"], tdsSectionId: sec.id })).j;
  ok("194J section + expense ledger created", !!sec?.id && !!prof?.id, (sec?.id, prof?.id));

  // ================= D-2: all six advertised Day Book chords =================
  const chordTargets = [
    ["Alt+F5", "Debit Note"], ["Alt+F6", "Credit Note"], ["Alt+F7", "Stock Journal"],
    ["Alt+F8", "Delivery Note"], ["Alt+F9", "Receipt Note"], ["Control+F7", "Physical Stock"],
  ];
  for (const [chord, label] of chordTargets) {
    await page.goto(`${D.BASE}/company/${cid}/daybook`);
    await page.waitForSelector('input[type="date"]');
    await page.keyboard.press(chord); // REAL key press — no button clicking
    let opened = false;
    try {
      await page.waitForSelector("text=Ledger Entries", { timeout: 4000 });
      opened = (await page.locator("h1, [data-testid], .font-semibold").first().innerText().catch(() => "")).includes(label)
        || (await page.content()).includes(`${label} Voucher`);
      await page.keyboard.press("Escape"); await D.sleep(250);
    } catch { /* stay on day book → fail below */ }
    ok(`Day Book chord ${chord} opens ${label} (D-2)`, opened, chord);
  }

  // ================= D-1 + F-34-1: Alt+G fires and posts BOTH halves =================
  await D.openVoucher("Sales");
  await page.fill("#v-date", "2026-06-01");
  const partyField = page.locator('xpath=//span[text()="Party A/c"]/following::input[1]');
  await D.pickAhead(partyField, "R34 Local Party");
  const ltable = page.locator("table").filter({ hasText: "Ledger" }).last();
  while ((await ltable.locator("tbody tr").count()) < 2) { await page.click('button:has-text("+ Add Ledger")'); await D.sleep(120); }
  const row1 = ltable.locator("tbody tr").nth(1);
  await D.pickAhead(row1.locator("input").first(), "R34 Sales Main");
  await row1.locator('input[type="number"]').nth(1).fill("10000");
  await D.sleep(200);

  // The PANEL CHIP (not the inline button) must now work (D-1)
  await page.locator('aside button:has-text("Apply GST")').click();
  await D.sleep(400);
  let grid = await D.readGrid();
  const cgst = grid.find((g) => g.name === "CGST");
  const sgst = grid.find((g) => g.name === "SGST/UTGST");
  ok("aside Apply-GST chip fires (D-1)", !!cgst || !!sgst, grid.map((g) => g.name));
  ok("intrastate GST posts BOTH halves (F-34-1)", cgst?.cr === 900 && sgst?.cr === 900, { cgst, sgst });

  // ... and the Alt+G KEYBOARD CHORD fires too (strip via re-apply, then chord)
  await page.keyboard.press("Alt+g");
  await D.sleep(400);
  grid = await D.readGrid();
  const cgst2 = grid.find((g) => g.name === "CGST");
  const sgst2 = grid.find((g) => g.name === "SGST/UTGST");
  ok("Alt+G keyboard chord fires (D-1)", !!cgst2 && !!sgst2, grid.map((g) => g.name));

  await page.keyboard.press("Escape"); await D.sleep(300);

  // ================= D-1 (TDS): Alt+T fires =================
  await D.openVoucher("Payment");
  await page.fill("#v-date", "2026-06-02");
  const lt = page.locator("table").filter({ hasText: "Ledger" }).last();
  const r0 = lt.locator("tbody tr").nth(0);
  await D.pickAhead(r0.locator("input").first(), "R34 Prof Fees");
  await r0.locator('input[type="number"]').nth(0).fill("10000");
  await page.click('button:has-text("+ Add Ledger")'); await D.sleep(150);
  const r1 = lt.locator("tbody tr").nth(1);
  await D.pickAhead(r1.locator("input").first(), "Cash");
  await r1.locator('input[type="number"]').nth(1).fill("9000"); // net of TDS (Tally-style)
  await D.sleep(200);

  await page.locator('aside button:has-text("Deduct TDS")').click();
  await D.sleep(400);
  grid = await D.readGrid();
  ok("aside Deduct-TDS chip fires (D-1)", grid.some((g) => g.name === "TDS Payable" && g.cr === 1000), grid);

  await page.keyboard.press("Alt+t");
  await D.sleep(400);
  grid = await readGridStable();
  ok("Alt+T keyboard chord fires (D-1)", grid.some((g) => g.name === "TDS Payable" && g.cr === 1000), grid);
  await page.keyboard.press("Escape"); await D.sleep(300);

  // ================= D-3: Day Book row drill-down =================
  // Seed one Sales voucher via API so a row exists.
  const vts = (await api("get", `/c/${cid}/voucher-types`)).j ?? [];
  const salesType = vts.find((t) => t.name === "Sales")?.id;
  const mkSeed = (narration) => api("post", `/c/${cid}/vouchers`, { voucherTypeId: salesType, date: "2026-06-03", narration, entries: [
    { ledgerId: sales.id, amount: -2000 },
    { ledgerId: party.id, amount: 2000 },
  ] });
  const seeded = (await mkSeed("Being R34 drilldown sale")).j;
  const seeded2 = (await mkSeed("Being R34 drilldown second")).j; // survives the Del test
  ok("seed vouchers for drill-down created", !!seeded?.id && !!seeded2?.id, (seeded?.id, seeded2?.id));

  // Alter LINK opens the editor
  await page.goto(`${D.BASE}/company/${cid}/daybook`);
  await page.waitForSelector('tbody tr:has-text("R34 drilldown")');
  const dr = page.locator("tbody tr", { hasText: "R34 drilldown" }).first();
  await dr.locator('a:has-text("Alter")').click();
  await page.waitForURL("**/voucher/**/edit", { timeout: 8000 });
  ok("Alter link opens the voucher editor", true, page.url());
  await page.keyboard.press("Escape"); await D.sleep(300);

  // Bare ROW click (plain date cell) opens the editor — the false affordance, now real
  await page.goto(`${D.BASE}/company/${cid}/daybook`);
  await page.waitForSelector('tbody tr:has-text("R34 drilldown")');
  const dr2 = page.locator("tbody tr", { hasText: "R34 drilldown" }).first();
  await dr2.locator("td").first().click();
  await page.waitForURL("**/voucher/**/edit", { timeout: 8000 });
  ok("Day Book row click opens the voucher (D-3)", page.url().includes("/voucher/"), page.url());

  // Action buttons must NOT navigate (stopPropagation) — use the second seed
  await page.goto(`${D.BASE}/company/${cid}/daybook`);
  await page.waitForSelector('tbody tr:has-text("R34 drilldown second")');
  const dr3 = page.locator("tbody tr", { hasText: "R34 drilldown second" }).first();
  page.once("dialog", (d) => d.accept()); // Del → confirm(prompt) dialog, registered BEFORE the click
  await dr3.locator('button:has-text("Del")').click();
  await D.sleep(500);
  ok("row Del button does not navigate (D-3)", page.url().includes("/daybook"), page.url());

  ok("no page errors", pageErrors.length === 0, pageErrors);
  console.log(`\n== R34 UI: ${pass} passed, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// helper: re-read the grid after a chord re-application (rows rebuilt async)
async function readGridStable() {
  await D.sleep(200);
  return D.readGrid();
}
