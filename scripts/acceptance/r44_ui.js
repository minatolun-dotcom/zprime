// R-44 browser acceptance: starter inventory masters (F-42-2) on the REAL UI.
// Prereqs: fresh compose stack at localhost:3000 (admin/admin123), R-44 client
// built into the image.
//
// Contract under test (approved Option A — R-44 investigation):
//  - A brand-new company ships with units `Nos` + `Pieces` and godown `Main`
//    (seeded in the creation transaction, R-44) — before ANY operator action.
//  - The first inventoried item can be created on the Stock Items page using
//    the seeded `Nos` unit with ZERO prior master setup (the F-42-2 dead-end).
//  - The seeded rows are ordinary masters: `Main` can be deleted via the
//    Godowns page and re-created by the operator.
//  - Round-trip: an inventory voucher with that item saves to the Day Book.
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
  await D.createCompany({ name: "R44 Starter UI", gstin: "27R44STRUI5P8", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const api = async (method, path, body) => {
    const r = await page.request[method](`${D.BASE}/api${path}`, body !== undefined ? { data: body } : undefined);
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status(), j };
  };

  // ================================================================
  // 1) Seeds present before ANY operator action (server truth + UI pages)
  // ================================================================
  const units = (await api("get", `/c/${cid}/units`)).j ?? [];
  const godowns = (await api("get", `/c/${cid}/godowns`)).j ?? [];
  ok("server: units seeded (Nos + Pieces)",
    units.some((u) => u.symbol === "Nos" && u.name === "Numbers") && units.some((u) => u.symbol === "pcs" && u.name === "Pieces"),
    units.map((u) => `${u.symbol}:${u.name}`));
  ok("server: godown Main seeded", godowns.some((g) => g.name === "Main"), godowns.map((g) => g.name));

  await page.goto(`${D.BASE}/company/${cid}/masters/units`);
  await page.waitForSelector("table");
  const unitPage = await page.locator("table").innerText();
  ok("UI: Units page shows Nos and Pieces without any operator setup",
    unitPage.includes("Nos") && unitPage.includes("Pieces"), unitPage.slice(0, 120));

  await page.goto(`${D.BASE}/company/${cid}/masters/godowns`);
  await page.waitForSelector("table");
  const godownPage = await page.locator("table").innerText();
  ok("UI: Godowns page shows Main without any operator setup", godownPage.includes("Main"), godownPage.slice(0, 120));

  // ================================================================
  // 2) THE F-42-2 dead-end, now closed: first stock item with ZERO setup
  //    (no unit creation, no godown creation — just the item)
  // ================================================================
  await D.createMaster("stock-items", [
    ["Name *", "R44 First Item"],
    ["Unit *", { label: "Nos (Numbers)" }],
    ["GST Rate %", 18],
    ["Std. Sale Price", 0], ["Std. Cost", 0], ["Reorder Min Qty", 0],
  ]);
  const items = (await api("get", `/c/${cid}/stock-items`)).j ?? [];
  const first = items.find((i) => i.name === "R44 First Item");
  ok("first inventoried item saved with the seeded unit (no prior setup)", !!first && !!first.unitId, items.map((i) => i.name));

  // ================================================================
  // 3) Seeds are ordinary masters: delete Main via the Masters UI Del
  //    button (native confirm dialog), then re-create it as an operator
  // ================================================================
  await page.goto(`${D.BASE}/company/${cid}/masters/godowns`);
  await page.waitForSelector("table");
  page.once("dialog", (d) => d.accept());
  await page.locator('tr:has-text("Main")').locator('button:has-text("Del")').click();
  await D.sleep(400);
  const afterDelete = (await api("get", `/c/${cid}/godowns`)).j ?? [];
  ok("seeded godown is deletable via the Masters UI (no reserved flag)",
    !afterDelete.some((g) => g.name === "Main"), afterDelete.map((g) => g.name));

  await D.createMaster("godowns", [["Name *", "Main"]]);
  const afterRecreate = (await api("get", `/c/${cid}/godowns`)).j ?? [];
  ok("operator can re-create Main (seeds impose nothing)", afterRecreate.some((g) => g.name === "Main"), afterRecreate.map((g) => g.name));

  // ================================================================
  // 4) Round-trip: inventory voucher with the first item saves end-to-end
  //    (driver enterVoucher — same mechanics as the 153-check baseline)
  // ================================================================
  const grps = (await api("get", `/c/${cid}/groups`)).j ?? [];
  const gid = (n) => grps.find((g) => g.name === n).id;
  await api("post", `/c/${cid}/ledgers`, { name: "R44 Sales", groupId: gid("Sales Accounts"), taxability: "taxable", gstRate: 18 });
  await api("post", `/c/${cid}/ledgers`, { name: "R44 Purchase", groupId: gid("Purchase Accounts"), taxability: "taxable", gstRate: 18 });
  await api("post", `/c/${cid}/ledgers`, { name: "R44 Buyer", groupId: gid("Sundry Debtors"), gstReg: "none", taxability: "none" });
  await api("post", `/c/${cid}/ledgers`, { name: "R44 Supplier", groupId: gid("Sundry Creditors"), gstReg: "none", taxability: "none" });
  await api("post", `/c/${cid}/ledgers`, { name: "R44 Output CGST", groupId: gid("Duties & Taxes"), dutyHead: "CGST" });
  await api("post", `/c/${cid}/ledgers`, { name: "R44 Output SGST", groupId: gid("Duties & Taxes"), dutyHead: "SGST" });

  // Stock the item first — the R-06 availability guard correctly rejects
  // selling from zero (an assertion-worthy rejection is covered by run.js;
  // here we prove the seeded unit drives a full buy→sell cycle).
  const bought = await D.enterVoucher({ type: "Purchase", date: "2026-05-20",
    party: "R44 Supplier",
    items: [{ item: "R44 First Item", qty: 10, rate: 100 }],
    lines: [
      { ledger: "R44 Purchase", dr: 1000 },
      { ledger: "R44 Supplier", cr: 1000 },
    ] }).then(() => true).catch((e) => { ok("round-trip: purchase stocks the first item", false, e.message); return false; });
  ok("round-trip: purchase stocks the first item (seeded unit, godown optional)", !!bought, "enterVoucher ok");

  const saved = bought ? await D.enterVoucher({ type: "Sales", date: "2026-06-01",
    party: "R44 Buyer",
    items: [{ item: "R44 First Item", qty: 10, rate: 100 }],
    lines: [
      { ledger: "R44 Sales", cr: 1000 },
      { ledger: "R44 Output CGST", cr: 90 },
      { ledger: "R44 Output SGST", cr: 90 },
      { ledger: "R44 Buyer", dr: 1180 },
    ] }).then(() => true).catch((e) => { ok("round-trip: sales voucher with the first item saves", false, e.message); return false; }) : false;
  ok("round-trip: sales voucher with the first item saves to Day Book", !!saved, "enterVoucher ok");

  ok("no page errors across the suite", pageErrors.length === 0, pageErrors);

  console.log(`\nR-44 UI: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
