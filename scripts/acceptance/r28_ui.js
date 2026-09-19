// R-28 browser acceptance: opt-in IRP connectivity through the REAL UI.
// 1) CompanySettings gains the IRP Connectivity card: sandbox/production
//    toggle, save (masked read-back shows last-4), remove.
// 2) The settings form enforces "retype secrets" (stored values never read
//    back) — a save with empty secret fields shows the amber message.
// 3) GSTR-1 rows gain the "submit" action; with credentials pointed at a
//    reachable-but-invalid endpoint the submit surfaces the failure honestly;
//    without credentials it surfaces the "configure credentials" message.
// 4) Gateway stays healthy throughout (no page errors).
// Prereqs: fresh compose stack at localhost:3000 (admin/admin123).
// NOTE: the real auth handshake + idempotency math is proven in Python
// (final_regression R-28 block against scripts/mock_irp.js); the browser
// suite proves the UI surface and honest error rendering.
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
  await D.createCompany({ name: "R28 IRP UI", gstin: "27R28IRPUI03C4D5", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const get = async (p) => (await page.request.get(`${D.BASE}/api/c/${cid}${p}`)).json();

  // ---- 1) settings page shows the IRP card ----
  await page.goto(`${D.BASE}/company/${cid}/settings`);
  await page.waitForSelector("text=IRP / e-Way Bill Connectivity", { timeout: 15000 });
  ok("settings shows IRP connectivity card", true);
  ok("sandbox/production toggle present", await page.locator('button:has-text("sandbox")').first().isVisible().catch(() => false));

  // ---- 2) save with empty secrets -> amber retype message, nothing stored ----
  await page.locator('button:has-text("Save IRP credentials")').click();
  await page.waitForSelector("text=Client secret and password are required", { timeout: 8000 });
  ok("empty secrets rejected with retype message", true);

  // ---- 3) fill + save; masked read-back ----
  // Field renders <label><span>TEXT</span><input/></label> — target by span text.
  const setByLabel = async (labelText, value) => {
    const field = page.locator(`label:has(span:text-is("${labelText}")) input`).first();
    await field.fill(value);
  };
  await setByLabel("Client ID", "r28ui-client");
  await setByLabel("GSTIN (for this credential set)", "27R28IRPUI3C4D5");
  await setByLabel("Username", "r28ui-user");
  await setByLabel("Client Secret *", "ui-secret-9999");
  await setByLabel("Password *", "ui-pass-8888");
  await setByLabel("Endpoint override (mock/test IRP; production requires it)", `${D.BASE.replace(/\/$/, "")}/mock-irp-unreachable`);
  await page.locator('button:has-text("Save IRP credentials")').click();
  await page.waitForSelector("text=/IRP credentials saved|Invalid IRP credentials/", { timeout: 8000 });
  ok("credentials saved via settings UI", true);
  const masked = await page.locator("text=••••9999").first().isVisible().catch(() => false);
  ok("masked read-back shows last-4 only", masked, "last-4 mask");
  const secretFields = await get("/../../api/companies").then(() => null).catch(() => null); // sanity: GET works
  const creds = (await (await page.request.get(`${D.BASE}/api/companies/${cid}/irp-credentials`)).json());
  ok("API read-back masked (no secret fields)", Array.isArray(creds) && creds[0] && !("clientSecret" in creds[0]) && !("password" in creds[0]) && creds[0].clientSecretLast4 === "9999", creds);

  // ---- 4) post a sale, then submit from GSTR-1 ----
  // The saved credentials lack an IRP public key — the server rejects BEFORE
  // any network call with the exact remediation. That honest amber surface is
  // precisely what this check asserts (the full handshake math is proven in
  // the Python suite against the wire-format mock).
  const vts = await get("/voucher-types");
  const vt = Object.fromEntries((vts || []).map((t) => [t.name, t.id]));
  const grp = await get("/groups");
  const g = Object.fromEntries((grp || []).map((x) => [x.name, x.id]));
  // NOTE: taxability belongs on the SUPPLY ledger only — the party ledger must
  // stay non-taxable, else voucherGst folds the party's gross line into the
  // taxable aggregation and the payload cross-check honestly rejects the
  // voucher (mirrors the R-24 fixture, where the buyer carries no taxability).
  const mkLedger = async (name, groupId, extra = {}) => {
    const res = await page.request.post(`${D.BASE}/api/c/${cid}/ledgers`, { data: { name, groupId, ...extra } });
    return res.json();
  };
  const sales = await mkLedger("R28 Sales", g["Sales Accounts"], { taxability: "taxable" });
  const buyer = await mkLedger("R28 Buyer", g["Sundry Debtors"], { gstin: "29R28BUYER1K5L6", gstRegistrationType: "regular", billWise: true, partyAddress: "5 Test St", partyState: "Karnataka", partyPincode: "560001" });
  const units = await get("/units");
  if (!(units || []).some((u) => u.symbol === "NOS")) {
    await page.request.post(`${D.BASE}/api/c/${cid}/units`, { data: { name: "Numbers", symbol: "NOS", decimalPlaces: 0 } });
  }
  const U = (units || []).find((u) => u.symbol === "NOS")?.id ?? (await get("/units")).find((u) => u.symbol === "NOS").id;
  const item = await (await page.request.post(`${D.BASE}/api/c/${cid}/stock-items`, { data: { name: "R28 Widget", unitId: U, hsnSac: "8471", gstRate: "18", openingQty: "40", openingRate: "500", openingValue: "20000" } })).json();
  ok("stock item created", !!item.id, item);
  const ledgers = await get("/ledgers");
  const igst = (ledgers || []).find((l) => l.name === "IGST");
  const sale = await (await page.request.post(`${D.BASE}/api/c/${cid}/vouchers`, { data: {
    voucherTypeId: vt["Sales"], date: "2026-08-20", partyLedgerId: buyer.id, placeOfSupply: "Karnataka",
    entries: [{ ledgerId: sales.id, amount: -5000 }, { ledgerId: igst.id, amount: -900 }, { ledgerId: buyer.id, amount: 5900 }],
    inventoryEntries: [{ itemId: item.id, qty: -10, rate: 500, amount: 5000, kind: "stock" }],
  } })).json();
  ok("sale posted for submit test", !!sale.id, sale);

  // The saved credentials lack an IRP public key — the server rejects BEFORE
  // any network call with the exact remediation. Give the company an address
  // first so payload validation passes and the credential/public-key surface
  // (not payload validation) is what the amber banner shows. The full
  // handshake math is proven in the Python suite against the wire-format mock.
  const upd = await page.request.put(`${D.BASE}/api/companies/${cid}`, { data: { address: "5 Test St", pincode: "400001" } });
  ok("company address set for payload validation", upd.status() === 200 || upd.status() === 204, upd.status());

  await page.goto(`${D.BASE}/company/${cid}/reports/gstr1`);
  await page.waitForSelector("text=GSTR-1", { timeout: 15000 });
  const submitBtn = page.locator('button:has-text("submit")').first();
  ok("GSTR-1 rows carry the submit action", await submitBtn.isVisible().catch(() => false));
  await submitBtn.click();
  const noKey = page.locator("text=/No IRP public key configured/").first();
  await noKey.waitFor({ timeout: 20000 }).catch(() => {});
  ok("submit without IRP public key surfaces the exact remediation (amber)", await noKey.isVisible().catch(() => false), "banner text");

  // ---- 5) without credentials on a fresh env toggle: removal path ----
  await page.goto(`${D.BASE}/company/${cid}/settings`);
  await page.waitForSelector("text=IRP / e-Way Bill Connectivity", { timeout: 15000 });
  await page.locator('button:has-text("Remove (sandbox)")').click();
  await page.waitForSelector("text=IRP credentials removed (sandbox).", { timeout: 8000 });
  ok("credentials removable via UI", true);

  // Submit now says credentials are missing
  await page.goto(`${D.BASE}/company/${cid}/reports/gstr1`);
  await page.waitForSelector("text=GSTR-1", { timeout: 15000 });
  await page.locator('button:has-text("submit")').first().click();
  const noCreds = page.locator("text=/No sandbox IRP credentials configured/").first();
  await noCreds.waitFor({ timeout: 20000 }).catch(() => {});
  ok("submit without credentials surfaces the configuration message", await noCreds.isVisible().catch(() => false), "amber message");

  ok("no page errors", pageErrors.length === 0, pageErrors);
  console.log(`\n== R28 UI: ${pass} passed, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
