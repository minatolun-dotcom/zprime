// R-20 browser acceptance: the company audit timeline through the REAL UI.
// 1) the Gateway "Audit Trail" card links to the new page and it renders;
// 2) a voucher entered via the API (fixture convention) appears as a
//    "Created" row linking to the voucher alter surface;
// 3) editing the voucher adds an "Edited" row above it (newest first);
// 4) deleting the voucher leaves an unlinked "(deleted)" row with the
//    snapshot detail — the trail outlives the row (R-18 semantics);
// 5) the action filter narrows the table (Edited hidden on action=create);
// 6) no page errors during the scenario.
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
  await D.createCompany({ name: "R20 UI Timeline", gstin: "27R20UITL0A1B2", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const auditUrl = `${D.BASE}/company/${cid}/audit`;

  // ---- 1) Gateway card -> page renders (R-53/R-61: Audit Trail is promoted
  //      to level 1 under the Utilities section — visible with no keypress) ----
  await D.sleep(300);
  const card = page.locator('a:has-text("Audit Trail")').first();
  ok("Gateway shows the Audit Trail card", await card.isVisible().catch(() => false), "card missing");
  await card.click();
  await page.waitForURL("**/audit", { timeout: 8000 });
  await page.locator("h1:has-text(\"Audit Trail\")").waitFor({ state: "visible", timeout: 8000 });
  const empty = page.locator("text=No audit events yet").first();
  ok("timeline page renders (empty state for a fresh company)", await empty.isVisible().catch(() => false), "no empty state");

  // ---- 2) fixture: Payment voucher via API -> Created row links to alter ----
  const get = async (path) => (await page.request.get(`${D.BASE}/api/c/${cid}${path}`)).json();
  const groups = await get("/groups");
  const g = Object.fromEntries(groups.map((x) => [x.name, x.id]));
  await page.request.post(`${D.BASE}/api/c/${cid}/ledgers`, { data: { name: "R20 Timeline Exp", groupId: g["Indirect Expenses"] } });
  const ledgers = await get("/ledgers");
  const L = Object.fromEntries(ledgers.map((x) => [x.name, x.id]));
  const vts = await get("/voucher-types");
  const payment = vts.find((v) => v.name === "Payment");
  const rv = await page.request.post(`${D.BASE}/api/c/${cid}/vouchers`, {
    data: { voucherTypeId: payment.id, date: "2026-06-05",
      entries: [{ ledgerId: L["R20 Timeline Exp"], amount: -120 }, { ledgerId: L["Cash"], amount: 120 }] },
  });
  ok("payment voucher created (fixture)", rv.status() === 200, await rv.text());
  const vid = (await rv.json()).id;

  await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
  await page.locator("table").first().waitFor({ state: "visible", timeout: 8000 });
  const createdBadge = page.locator("td span", { hasText: "Created" }).first();
  ok("Created row appears after voucher creation", await createdBadge.isVisible().catch(() => false), "no created badge");
  const vLink = page.locator(`a[href*="/voucher/${vid}/edit"]`).first();
  ok("voucher cell links to the alter surface", await vLink.isVisible().catch(() => false), "no voucher link");
  const byCell = page.locator("tr", { hasText: "Created" }).first().locator("td").last();
  ok("actor column shows admin", (await byCell.textContent().catch(() => "")).trim() === "admin", await byCell.textContent().catch(() => ""));

  // ---- 3) edit -> Edited row appears ABOVE the Created row (newest first) ----
  await page.request.put(`${D.BASE}/api/c/${cid}/vouchers/${vid}`, {
    data: { voucherTypeId: payment.id, date: "2026-06-06",
      entries: [{ ledgerId: L["R20 Timeline Exp"], amount: -150 }, { ledgerId: L["Cash"], amount: 150 }] },
  });
  await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
  await page.locator("table").first().waitFor({ state: "visible", timeout: 8000 });
  const editedBadge = page.locator("td span", { hasText: "Edited" }).first();
  ok("Edited row appears after edit", await editedBadge.isVisible().catch(() => false), "no edited badge");
  const firstActionText = await page.locator("tbody tr").first().locator("td").nth(1).textContent();
  ok("newest-first ordering (top row is the edit)", (firstActionText || "").includes("Edited"), firstActionText);

  // ---- 4) delete -> unlinked "(deleted)" row with snapshot ----
  await page.request.delete(`${D.BASE}/api/c/${cid}/vouchers/${vid}`);
  await page.goto(auditUrl, { waitUntil: "domcontentloaded" });
  await page.locator("table").first().waitFor({ state: "visible", timeout: 8000 });
  const deletedCell = page.locator("td", { hasText: "(deleted)" }).first();
  ok("deleted voucher renders unlinked with snapshot row", await deletedCell.isVisible().catch(() => false), "no deleted row");

  // ---- 5) action filter narrows the table ----
  await page.locator("select[aria-label=\"Filter by action\"]").selectOption("create");
  await D.sleep(600);
  const editedAfterFilter = page.locator("td span", { hasText: "Edited" }).first();
  const createdAfterFilter = page.locator("td span", { hasText: "Created" }).first();
  ok("action=create filter hides Edited, keeps Created",
     !(await editedAfterFilter.isVisible().catch(() => false)) && (await createdAfterFilter.isVisible().catch(() => false)),
     "filter did not narrow");

  ok("no page errors during R-20 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-20 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
