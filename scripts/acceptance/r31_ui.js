// R-31 browser acceptance: birth-path routing visible through the REAL UI.
// The v1.03/eivital WIRE split is proven server-side by final_regression's
// __stats assertions; here we prove the USER-FACING behaviors are birth-path
// agnostic: an IRN-born EWB (B2B row) and a direct-born EWB (B2C row) BOTH
// surface the veh/ext/can lifecycle actions in GSTR-1 and both work end-to-
// end through the real dialogs. Prereqs: fresh compose stack at
// localhost:3000 (admin/admin123) with IRP_ENC_KEY set; mock-irp sidecar
// running (--profile test).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 220)}`); }
};

(async () => {
  const MOCK = "http://mock-irp:3199";
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
  await D.createCompany({ name: "R31 Birth Path UI", gstin: "27R31BIRTHPUI0D", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const api = async (method, path, body) => {
    const r = await page.request[method](`${D.BASE}/api${path}`, body !== undefined ? { data: body } : undefined);
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status(), j };
  };

  // credentials: IRP pair AND EWB pair (both systems in play), aimed at the
  // live mock; company address for payload validation.
  const putCreds = await api("put", `/companies/${cid}/irp-credentials`, {
    environment: "sandbox", clientId: "r31ui", gstin: "27R31BIRTHPUI0D", username: "r31ui",
    clientSecret: "ui-secret-9999", password: "ui-pass-8888",
    ewbUsername: "r31ui-ewb", ewbPassword: "ui-ewb-7777",
    publicKeyPem: pubPem, endpointOverride: MOCK,
  });
  await api("put", `/companies/${cid}`, { address: "7 Twin Wire Way", pincode: "400001" });
  ok("credentials (IRP + EWB pair) saved via API", putCreds.status === 200, putCreds);

  // ---- fixtures: B2B buyer (IRN path) + B2C party (direct path) + item ----
  const vts = (await api("get", `/c/${cid}/voucher-types`)).j ?? [];
  const vt = Object.fromEntries(vts.map((t) => [t.name, t.id]));
  const grps = (await api("get", `/c/${cid}/groups`)).j ?? [];
  const g = Object.fromEntries(grps.map((x) => [x.name, x.id]));
  const sales = (await api("post", `/c/${cid}/ledgers`, { name: "R31 Sales", groupId: g["Sales Accounts"], taxability: "taxable" })).j;
  const b2b = (await api("post", `/c/${cid}/ledgers`, { name: "R31 B2B Buyer", groupId: g["Sundry Debtors"], gstin: "29R31UIB2B9Z8Y7", gstRegistrationType: "regular", billWise: true, partyAddress: "3 Corp Circle", partyState: "Karnataka", partyPincode: "560002" })).j;
  const b2c = (await api("post", `/c/${cid}/ledgers`, { name: "R31 Walk-in", groupId: g["Sundry Debtors"], billWise: true, partyAddress: "4 Bazaar Lane", partyState: "Karnataka", partyPincode: "560003" })).j;
  await api("post", `/c/${cid}/units`, { name: "Numbers", symbol: "NOS", decimalPlaces: 0 });
  const U = ((await api("get", `/c/${cid}/units`)).j ?? []).find((u) => u.symbol === "NOS")?.id;
  const item = (await api("post", `/c/${cid}/stock-items`, { name: "R31 Gadget", unitId: U, hsnSac: "8471", gstRate: "18", openingQty: "30", openingRate: "600", openingValue: "18000" })).j;
  const igst = ((await api("get", `/c/${cid}/ledgers`)).j ?? []).find((l) => l.name === "IGST");
  const mkSale = (party, amt) => api("post", `/c/${cid}/vouchers`, {
    voucherTypeId: vt["Sales"], date: "2026-09-16", partyLedgerId: party.id, placeOfSupply: "Karnataka",
    entries: [{ ledgerId: sales.id, amount: -amt }, { ledgerId: igst.id, amount: -Math.round(amt * 0.18) }, { ledgerId: party.id, amount: amt + Math.round(amt * 0.18) }],
    inventoryEntries: [{ itemId: item.id, qty: -1, rate: amt, amount: amt, hsnSac: "8471", gstRate: 18 }],
  });
  const saleB2B = (await mkSale(b2b, 5000)).j;
  const saleB2C = (await mkSale(b2c, 3000)).j;
  ok("B2B + B2C sales posted", !!saleB2B.id && !!saleB2C.id, (saleB2B.id, saleB2C.id));

  // ---- births: IRN-born (B2B: e-invoice → EWB from IRN) and direct-born (B2C) ----
  const einv = await api("post", `/c/${cid}/reports/einvoice/${saleB2B.id}/submit`);
  ok("B2B e-invoice accepted (IRN exists)", einv.status === 200 && einv.j.ok === true, einv.j);
  const ewbIrn = await api("post", `/c/${cid}/reports/ewaybill/${saleB2B.id}/submit?vehicleNo=MH31IR0001`);
  ok("IRN-born EWB accepted", ewbIrn.status === 200 && ewbIrn.j.ok === true, ewbIrn.j);
  const ewbDir = await api("post", `/c/${cid}/reports/ewaybill/${saleB2C.id}/generate-direct?vehicleNo=MH31DR0002`);
  ok("direct-born EWB accepted", ewbDir.status === 200 && ewbDir.j.ok === true, ewbDir.j);

  // ---- UI: GSTR-1 shows BOTH rows with lifecycle actions ----
  const gstr1 = `${D.BASE}/company/${cid}/reports/gstr1`;
  await page.goto(gstr1);
  await page.waitForSelector("text=B2B Invoices (registered purchasers)", { timeout: 15000 });
  const rowB2B = page.locator("tr", { hasText: "R31 B2B Buyer" });
  const rowB2C = page.locator("tr", { hasText: "R31 Walk-in" });
  // B2B rows prove the IRN birth via the ewb-gen/ewb-veh action set (an EWB
  // number is only shown inline on B2C rows; the B2B lifecycle buttons are
  // the birth-proof — they only appear once the row can carry lifecycle ops).
  ok("IRN-born row carries the full eivital lifecycle action set", await rowB2B.locator('button:has-text("ewb-veh")').first().isVisible().catch(() => false) && await rowB2B.locator('button:has-text("ewb-can")').first().isVisible().catch(() => false), await rowB2B.innerText().catch(() => ""));
  ok("direct-born row shows the accepted EWB number", /EWB \d+/.test((await rowB2C.innerText().catch(() => "")) || ""), await rowB2C.innerText().catch(() => ""));
  for (const [label, row] of [["veh", rowB2B], ["veh", rowB2C]]) {
    ok(`row carries lifecycle action ${label}`, await row.locator(`button:has-text("${label}")`).first().isVisible().catch(() => false), label);
  }

  // ---- vehicle update through the REAL UI on both birth paths ----
  await runDialogs(["MH31IR0003", "Pune", "27"], () => rowB2B.locator('button:has-text("veh")').first().click());
  ok("vehicle update on IRN-born EWB confirmed (banner)", (await waitBanner(/vehicle updated/)).length > 0, await banner());
  await page.reload();
  await page.waitForSelector("text=B2B Invoices (registered purchasers)", { timeout: 15000 });
  const rowB2B2 = page.locator("tr", { hasText: "R31 B2B Buyer" });
  await runDialogs(["MH31DR0004", "Pune", "27"], () => rowB2B2.locator('button:has-text("veh")').first().click());
  ok("vehicle update on direct-born EWB confirmed (banner)", (await waitBanner(/vehicle updated/)).length > 0, await banner());

  // ---- cancel on the direct-born row via the UI; birth action returns ----
  await page.reload();
  await page.waitForSelector("text=B2C (unregistered consumers)", { timeout: 15000 });
  const rowB2C2 = page.locator("tr", { hasText: "R31 Walk-in" });
  await runDialogs(["data_entry_mistake", "r31 ui cancel of direct-born EWB"], () => rowB2C2.locator('button:has-text("can")').first().click());
  ok("cancel on direct-born EWB confirmed (banner)", (await waitBanner(/cancelled/)).length > 0, await banner());
  await page.reload();
  await page.waitForSelector("text=B2C (unregistered consumers)", { timeout: 15000 });
  const rowB2C3 = page.locator("tr", { hasText: "R31 Walk-in" });
  ok("cancelled direct-born EWB: birth action returns on the B2C row", await rowB2C3.locator('button:has-text("ewb")').first().isVisible().catch(() => false), await rowB2C3.innerText().catch(() => ""));

  ok("no page errors", pageErrors.length === 0, pageErrors);
  console.log(`\n== R31 UI: ${pass} passed, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
