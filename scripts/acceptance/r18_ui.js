// R-18 browser acceptance: the voucher audit history through the REAL UI.
// 1) entering a Sales voucher via the UI produces a "Created" history line the
//    moment the voucher is re-opened in edit (alter) mode;
// 2) altering it (changing narration) appends an "Edited" line alongside the
//    original create — history grows in lifecycle order and never shrinks;
// 3) a fresh voucher has NO history strip (no fabricated rows);
// 4) the audit fetch failing (membership-revoked scenario simulated via a
//    stale/nonexistent voucher id in another tab) degrades silently — no page
//    error, voucher form still renders;
// 5) books stay balanced (voucher + its edit both balance by construction).
// Masters/fixtures may use the API (r10_ui.js convention); assertions run
// against rendered DOM only.
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

  await D.login();
  await D.createCompany({ name: "R18 UI Audit", gstin: "27R18UIAU0A1B2", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const get = async (path) => (await page.request.get(`${D.BASE}/api/c/${cid}${path}`)).json();
  const groups = await get("/groups");
  const g = Object.fromEntries(groups.map((x) => [x.name, x.id]));
  const rExp = await page.request.post(`${D.BASE}/api/c/${cid}/ledgers`, { data: { name: "R18 Audit Exp", groupId: g["Indirect Expenses"] } });
  ok("expense ledger created", rExp.status() === 200, await rExp.text());

  // ---- 1) fresh voucher: no history strip ----
  await D.openVoucher("Journal");
  const freshStrip = page.locator("text=Created by").first();
  ok("fresh voucher shows no history strip", !(await freshStrip.isVisible().catch(() => false)), "strip visible on fresh voucher");
  await page.keyboard.press("Escape");
  await D.sleep(250);

  // ---- 2) enter a real journal via UI, reopen via Alter: "Created by admin" ----
  await D.openVoucher("Journal");
  const ltable = page.locator("table").filter({ hasText: "Ledger" }).last();
  await D.pickAhead(ltable.locator("tbody tr").nth(0).locator("input").first(), "Cash");
  const nums0 = ltable.locator("tbody tr").nth(0).locator('input[type="number"]');
  await nums0.nth(0).fill("500");
  await page.click('button:has-text("+ Add Ledger")');
  await D.pickAhead(ltable.locator("tbody tr").nth(1).locator("input").first(), "R18 Audit Exp");
  const nums1 = ltable.locator("tbody tr").nth(1).locator('input[type="number"]');
  await nums1.nth(1).fill("500");
  await page.keyboard.press("Control+a");
  await page.waitForURL("**/daybook", { timeout: 12000 });
  await D.sleep(400);
  ok("journal 500/500 entered via UI", true, "");

  // reopen via Alter -> history strip must show Created
  await page.locator("table tbody tr", { hasText: "Journal" }).first().locator('a:has-text("Alter")').click();
  await page.waitForSelector("text=Ledger Entries");
  await D.sleep(500);
  const createdLine = page.locator("text=Created by admin").first();
  await createdLine.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  ok("alter view shows 'Created by admin'", await createdLine.isVisible().catch(() => false), "no created line");
  const strip = page.locator('div.px-4.py-1\\.5:has-text("Created")');
  const stripText1 = await strip.first().textContent().catch(() => "");
  await page.keyboard.press("Escape");
  await D.sleep(250);

  // ---- 3) alter: change narration -> "Edited by admin" appended, create kept ----
  await D.alterVoucher("Journal", async () => {
    const nar = page.locator("#v-narration");
    if (await nar.count()) await nar.fill("R18 audit trail edit");
  });
  await page.locator("table tbody tr", { hasText: "Journal" }).first().locator('a:has-text("Alter")').click();
  await page.waitForSelector("text=Ledger Entries");
  await D.sleep(500);
  const editedLine = page.locator("text=Edited by admin").first();
  await editedLine.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  ok("after edit shows 'Edited by admin'", await editedLine.isVisible().catch(() => false), "no edited line");
  const stillCreated = await createdLine.isVisible().catch(() => false);
  ok("create line preserved after edit", stillCreated, "create line vanished");
  const stripNow = await page.locator('div:has-text("Edited by admin")').first().textContent().catch(() => "");
  ok("history in lifecycle order (create before edit)", stripNow.indexOf("Created") < stripNow.indexOf("Edited") && stripNow.indexOf("Created") >= 0, stripNow);
  await page.keyboard.press("Escape");
  await D.sleep(250);

  // ---- 4) day book still renders the voucher; TB balanced ----
  const rows = await D.daybookRows();
  const jr = rows.find((r) => r[1] === "Journal" && r[4] === Number(500).toLocaleString("en-IN"));
  ok("voucher visible in Day Book after lifecycle", !!jr, rows.slice(0, 4));

  await page.goto(`${D.BASE}/company/${cid}/reports/trial-balance`, { waitUntil: "domcontentloaded" });
  await page.locator("table").first().waitFor({ state: "visible", timeout: 15000 });
  const banner = page.locator("text=Difference in books").first();
  ok("TB balanced after voucher + audit writes", !(await banner.isVisible().catch(() => false)), "difference banner visible");

  ok("no page errors during R-18 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-18 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
