// R-30 browser acceptance: DIRECT e-way bill birth (non-IRN, B2C) through the
// REAL UI, against the wire-format mock (sidecar). 1) CompanySettings exposes
// the EWB-portal section with masked read-back and the retype rule; 2) a B2C
// GSTR-1 row (no buyer GSTIN) carries the direct "ewb" birth action; 3) the
// prompt flow births the EWB (banner + number); after a reload the row flips
// to the accepted EWB with veh/ext/can lifecycle actions; 4) vehicle update
// and cancel work on the direct-born EWB; after cancel the row returns to the
// birth action (birth re-opened). No page errors throughout.
// Prereqs: fresh compose stack at localhost:3000 (admin/admin123) with
// IRP_ENC_KEY set; mock-irp sidecar running (--profile test).
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
  await D.createCompany({ name: "R30 Direct EWB UI", gstin: "27R30DIRECTUI2B3C", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const api = async (method, path, body) => {
    const r = await page.request[method](`${D.BASE}/api${path}`, body !== undefined ? { data: body } : undefined);
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status(), j };
  };

  // credentials (IRP + EWB pair) aimed at the live mock; address for payload
  // validation — saved via API, then verified through the real settings page.
  // GSTIN on the credential row must be exactly 15 chars (schema-enforced).
  const putCreds = await api("put", `/companies/${cid}/irp-credentials`, {
    environment: "sandbox", clientId: "r30ui", gstin: "27R30DIRECTUB1C", username: "r30ui",
    clientSecret: "ui-secret-9999", password: "ui-pass-8888",
    ewbUsername: "r30ui-ewb", ewbPassword: "ui-ewb-7777",
    publicKeyPem: pubPem, endpointOverride: MOCK,
  });
  await api("put", `/companies/${cid}`, { address: "5 Test St", pincode: "400001" });
  ok("credentials (with EWB pair) saved via API", putCreds.status === 200, putCreds);

  // ---- 1) CompanySettings: EWB section shows the stored username and the
  //         masked password (last-4 only), never the plaintext ----
  await page.goto(`${D.BASE}/company/${cid}/settings`);
  await page.waitForSelector("text=EWB portal (direct e-way bills, B2C)", { timeout: 15000 });
  const ewbUserVal = await page.locator("label", { hasText: "EWB portal username" }).locator("input").inputValue().catch(() => "");
  ok("EWB username prefilled in settings", ewbUserVal === "r30ui-ewb", ewbUserVal);
  const bodyHtml = await page.content();
  ok("EWB password masked (last-4 label, no plaintext)", bodyHtml.includes("••••7777") && !bodyHtml.includes("ui-ewb-7777"), "mask check");
  // retype rule through the real form: all three secrets retyped, save
  // succeeds — asserted by the API read-back (the settings banner carries no
  // role=status, so the outcome is the honest assertion target).
  await page.locator('input[type="password"]').nth(0).fill("ui-secret-9999");
  await page.locator('input[type="password"]').nth(1).fill("ui-pass-8888");
  await page.locator('input[type="password"]').nth(2).fill("ui-ewb-8888");
  await page.locator('button:has-text("Save IRP credentials")').click();
  await D.sleep(1200);
  const afterSave = ((await api("get", `/companies/${cid}/irp-credentials`)).j ?? []).find((c) => c.environment === "sandbox") ?? {};
  ok("settings save accepted — EWB password rotated to 8888 (read-back)", afterSave.ewbPasswordLast4 === "8888", afterSave);

  // ---- 2) fixtures: B2C party (NO GSTIN) + inter-state sale ----
  const vts = (await api("get", `/c/${cid}/voucher-types`)).j ?? [];
  const vt = Object.fromEntries(vts.map((t) => [t.name, t.id]));
  const grps = (await api("get", `/c/${cid}/groups`)).j ?? [];
  const g = Object.fromEntries(grps.map((x) => [x.name, x.id]));
  const sales = (await api("post", `/c/${cid}/ledgers`, { name: "R30 Sales", groupId: g["Sales Accounts"], taxability: "taxable" })).j;
  const b2c = (await api("post", `/c/${cid}/ledgers`, { name: "R30 Walk-in", groupId: g["Sundry Debtors"], billWise: true, partyAddress: "5 Consumer Lane", partyState: "Karnataka", partyPincode: "560001" })).j;
  await api("post", `/c/${cid}/units`, { name: "Numbers", symbol: "NOS", decimalPlaces: 0 });
  const U = ((await api("get", `/c/${cid}/units`)).j ?? []).find((u) => u.symbol === "NOS")?.id;
  const item = (await api("post", `/c/${cid}/stock-items`, { name: "R30 Gadget", unitId: U, hsnSac: "8471", gstRate: "18", openingQty: "40", openingRate: "500", openingValue: "20000" })).j;
  const igst = ((await api("get", `/c/${cid}/ledgers`)).j ?? []).find((l) => l.name === "IGST");
  const sale = (await api("post", `/c/${cid}/vouchers`, {
    voucherTypeId: vt["Sales"], date: "2026-09-10", partyLedgerId: b2c.id, placeOfSupply: "Karnataka",
    entries: [{ ledgerId: sales.id, amount: -8000 }, { ledgerId: igst.id, amount: -1440 }, { ledgerId: b2c.id, amount: 9440 }],
    inventoryEntries: [{ itemId: item.id, qty: -10, rate: 800, amount: 8000, kind: "stock" }],
  })).j;
  ok("B2C inter-state sale posted", !!sale.id, sale);

  // ---- 3) GSTR-1 B2C row: direct birth action visible, no IRN path present ----
  const gstr1 = `${D.BASE}/company/${cid}/reports/gstr1`;
  await page.goto(gstr1);
  await page.waitForSelector("text=B2C (unregistered consumers)", { timeout: 15000 });
  const b2cRow = page.locator("tr", { hasText: "R30 Walk-in" });
  ok("B2C row carries the direct ewb birth action", await b2cRow.locator('button:has-text("ewb")').first().isVisible().catch(() => false), "ewb button");
  ok("B2C row has NO IRN-birth/submit surface (B2C is e-invoice-ineligible)", !(await b2cRow.locator('button:has-text("submit")').first().isVisible().catch(() => false)), "no submit");

  // ---- 4) birth through the prompt flow: banner carries the EWB number ----
  await runDialogs(["MH30DR1010"], () => b2cRow.locator('button:has-text("ewb")').first().click());
  const birth = await waitBanner(/e-way bill \(direct\) accepted/);
  ok("direct birth confirmed by banner with EWB number", /EWB \d+/.test(birth), birth);

  // ---- 5) reload: row flips to the accepted EWB + lifecycle actions ----
  await page.reload();
  await page.waitForSelector("text=B2C (unregistered consumers)", { timeout: 15000 });
  const row2 = page.locator("tr", { hasText: "R30 Walk-in" });
  ok("B2C row shows the accepted EWB number after reload", /EWB \d+/.test((await row2.innerText().catch(() => "")) || ""), await row2.innerText().catch(() => ""));
  for (const label of ["veh", "ext", "can"]) {
    ok(`B2C row carries lifecycle action ${label}`, await row2.locator(`button:has-text("${label}")`).first().isVisible().catch(() => false), label);
  }

  // ---- 6) vehicle update + cancel on the direct-born EWB, via the B2C row ----
  await runDialogs(["MH30VE2222", "Pune", "27"], () => row2.locator('button:has-text("veh")').first().click());
  ok("vehicle update on direct-born EWB confirmed", (await waitBanner(/vehicle updated/)).length > 0, await banner());
  await runDialogs(["data_entry_mistake", "direct-born cancel via UI"], () => row2.locator('button:has-text("can")').first().click());
  ok("cancel on direct-born EWB confirmed", (await waitBanner(/cancelled/)).length > 0, await banner());

  // ---- 7) after cancel the birth action returns (slot re-opened) ----
  await page.reload();
  await page.waitForSelector("text=B2C (unregistered consumers)", { timeout: 15000 });
  const row3 = page.locator("tr", { hasText: "R30 Walk-in" });
  ok("cancelled EWB: birth action returns on the B2C row", await row3.locator('button:has-text("ewb")').first().isVisible().catch(() => false), await row3.innerText().catch(() => ""));

  ok("no page errors", pageErrors.length === 0, pageErrors);
  console.log(`\n== R30 UI: ${pass} passed, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
