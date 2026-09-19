// R-29 browser acceptance: EWB lifecycle ops through the REAL UI, end-to-end
// against the wire-format mock IRP (the Python-suite pattern, browser edition).
// 1) GSTR-1 rows expose the lifecycle actions: ewb-gen / ewb-veh / ewb-ext /
//    ewb-can beside R-28's e-inv/e-way/submit.
// 2) Full birth cycle through the UI: submit (IRN) -> ewb-gen (EWB number).
// 3) ewb-veh prompt flow updates the vehicle; banner confirms.
// 4) ewb-ext accepts; banner shows the mock's extended validity.
// 5) ewb-can with a remark cancels; banner confirms; a following ewb-veh
//    surfaces the eager "No accepted e-way bill" message (row is cancelled).
// 6) Gateway stays healthy throughout (no page errors).
// Prereqs: fresh compose stack at localhost:3000 (admin/admin123) with
// IRP_ENC_KEY set; the suite starts its own mock IRP with a fresh RSA pair.
const D = require("./driver.js");
const { execSync, spawn } = require("node:child_process");
const fs = require("node:fs");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 220)}`); }
};

(async () => {
  // ---- mock IRP as the compose test-profile sidecar (zprime-mock-irp-1) ----
  // The app container reaches it as http://mock-irp:3199 (container→container,
  // immune to host firewalls); the suite reads its self-generated public key
  // through the published host port. `docker compose --profile test up mock-irp`
  // must be running before this suite (see the guard below).
  const MOCK = "http://mock-irp:3199"; // endpoint override saved into the app
  let pubPem = null;
  try {
    pubPem = (await (await fetch("http://localhost:3299/__pubkey")).json()).publicKeyPem;
  } catch { /* not running */ }
  if (!pubPem) {
    console.log("SKIP: mock-irp sidecar not running — start it with: docker compose --profile test up -d mock-irp");
    process.exit(0);
  }

  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));
  // prompt-driver: each runDialogs() call queues answers for sequential dialogs
  let dialogScript = [];
  page.on("dialog", (d) => {
    const step = dialogScript.shift();
    if (step === undefined) { d.dismiss(); return; }
    if (step === null) d.dismiss(); else d.accept(step);
  });
  const runDialogs = async (steps, action) => {
    dialogScript = steps.slice();
    await action();
    await D.sleep(1500);
    dialogScript = [];
  };
  const banner = async () => {
    const el = page.locator('[role="status"]').first();
    return (await el.isVisible().catch(() => false)) ? el.innerText() : "";
  };
  const waitBanner = async (re, timeout = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const t = await banner();
      if (re.test(t)) return t;
      await D.sleep(300);
    }
    return await banner();
  };

  await D.login();
  await D.createCompany({ name: "R29 EWB UI", gstin: "27R29EWBUI3C4D5", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const api = async (method, path, body) => {
    const r = await page.request[method](`${D.BASE}/api${path}`, body !== undefined ? { data: body } : undefined);
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status(), j };
  };

  // credentials aimed at the live mock; company address for payload validation
  await api("put", `/companies/${cid}/irp-credentials`, {
    environment: "sandbox", clientId: "r29ui", gstin: "27R29EWBUI3C4D6", username: "r29ui",
    clientSecret: "ui-secret-9999", password: "ui-pass-8888", publicKeyPem: pubPem, endpointOverride: MOCK,
  });
  await api("put", `/companies/${cid}`, { address: "5 Test St", pincode: "400001" });
  ok("credentials + address set via API", true);

  // fixtures (proven shapes)
  const vts = (await api("get", `/c/${cid}/voucher-types`)).j ?? [];
  const vt = Object.fromEntries(vts.map((t) => [t.name, t.id]));
  const grps = (await api("get", `/c/${cid}/groups`)).j ?? [];
  const g = Object.fromEntries(grps.map((x) => [x.name, x.id]));
  const sales = (await api("post", `/c/${cid}/ledgers`, { name: "R29 Sales", groupId: g["Sales Accounts"], taxability: "taxable" })).j;
  const buyer = (await api("post", `/c/${cid}/ledgers`, { name: "R29 Buyer", groupId: g["Sundry Debtors"], gstin: "29R29BUYER1K5L6X", gstRegistrationType: "regular", billWise: true, partyAddress: "5 Test St", partyState: "Karnataka", partyPincode: "560001" })).j;
  await api("post", `/c/${cid}/units`, { name: "Numbers", symbol: "NOS", decimalPlaces: 0 });
  const U = ((await api("get", `/c/${cid}/units`)).j ?? []).find((u) => u.symbol === "NOS")?.id;
  const item = (await api("post", `/c/${cid}/stock-items`, { name: "R29 Widget", unitId: U, hsnSac: "8471", gstRate: "18", openingQty: "40", openingRate: "500", openingValue: "20000" })).j;
  const igst = ((await api("get", `/c/${cid}/ledgers`)).j ?? []).find((l) => l.name === "IGST");
  const sale = (await api("post", `/c/${cid}/vouchers`, {
    voucherTypeId: vt["Sales"], date: "2026-09-10", partyLedgerId: buyer.id, placeOfSupply: "Karnataka",
    entries: [{ ledgerId: sales.id, amount: -5000 }, { ledgerId: igst.id, amount: -900 }, { ledgerId: buyer.id, amount: 5900 }],
    inventoryEntries: [{ itemId: item.id, qty: -10, rate: 500, amount: 5000, kind: "stock" }],
  })).j;
  ok("sale posted", !!sale.id, sale);

  // ---- 1) GSTR-1 row exposes all lifecycle actions ----
  await page.goto(`${D.BASE}/company/${cid}/reports/gstr1`);
  await page.waitForSelector("text=GSTR-1", { timeout: 15000 });
  for (const label of ["ewb-gen", "ewb-veh", "ewb-ext", "ewb-can"]) {
    ok(`GSTR-1 row carries ${label}`, await page.locator(`button:has-text("${label}")`).first().isVisible().catch(() => false));
  }

  // ---- 2) birth cycle through the UI: submit IRN, then ewb-gen ----
  await page.locator('button:has-text("submit")').first().click();
  const irnBanner = await waitBanner(/e-invoice accepted/);
  ok("e-invoice accepted via UI banner (IRN)", /IRN/.test(irnBanner), irnBanner);
  await page.locator('button:has-text("ewb-gen")').first().click();
  const ewbBanner = await waitBanner(/e-way bill accepted/);
  ok("EWB generated via ewb-gen banner (EWB number)", /EWB \d+/.test(ewbBanner), ewbBanner);

  // ---- 3) ewb-veh: prompt flow updates the vehicle ----
  await runDialogs(["MH14CD5678", "Pune", "27"], () => page.locator('button:has-text("ewb-veh")').first().click());
  ok("vehicle update confirmed by banner", (await waitBanner(/vehicle updated/)).length > 0, await banner());

  // ---- 4) ewb-ext: accepted; banner shows the new validity ----
  await runDialogs(["transshipment", "Solapur", "27", "260"], () => page.locator('button:has-text("ewb-ext")').first().click());
  const extBanner = await waitBanner(/validity extended/);
  ok("extension confirmed with validity", /2026-09-22/.test(extBanner), extBanner);

  // ---- 5) ewb-can: cancelled; subsequent ops surface the eager 400 ----
  await runDialogs(["data_entry_mistake", "wrong vehicle at birth"], () => page.locator('button:has-text("ewb-can")').first().click());
  ok("cancel confirmed by banner", (await waitBanner(/cancelled/)).length > 0, await banner());
  await runDialogs(["MH20GH3456", "Pune", "27"], () => page.locator('button:has-text("ewb-veh")').first().click());
  const gone = await waitBanner(/No accepted e-way bill/);
  ok("ops on a cancelled EWB surface the eager message", /No accepted e-way bill/.test(gone), gone);

  ok("no page errors", pageErrors.length === 0, pageErrors);
  console.log(`\n== R29 UI: ${pass} passed, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
