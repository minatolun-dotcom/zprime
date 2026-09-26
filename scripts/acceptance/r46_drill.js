#!/usr/bin/env node
// R-46/R-47: the IRP/EWB readiness drill, promoted to a permanent acceptance
// suite (API-level — the operator's sequential journey, which the per-feature
// UI suites r28…r31 do NOT cover end-to-end in one continuous session):
//
//   fresh company (starter masters) → fail-fast without credentials
//   → credential lifecycle (retype rule, masked storage, EWB pair)
//   → e-invoice: accept → duplicate-refusal (no network) → mock-reject
//     (verbatim error) → fix-and-retry → accepted
//   → EWB-from-IRN lifecycle: birth → vehicle → extend → once-ever guard
//     → cancel → slot re-opened → fresh EWB
//   → direct B2C EWB on the EWB-API portal (ewayapi birth path) + lifecycle
//   → authorization layering (member ok / non-member 404 / non-owner 403)
//   → submissions history recorded verbatim
//
// Prereqs (same as r28…r31): fresh compose stack at localhost:3000
// (admin/admin123) with IRP_ENC_KEY set; mock-irp sidecar running
// (--profile test). Skips cleanly when the sidecar is absent.
//
// Re-runnable: company names are namespaced per-run via timestamp; user
// creation 409s are tolerated by looking the user up through a fresh
// membership attempt against the EXISTING company id (names are unique, so
// a second run simply creates new users).
const BASE = "http://localhost:3000/api";
const MOCK_HOST = "http://localhost:3299"; // host-published sidecar port
const MOCK_OVERRIDE = "http://mock-irp:3199"; // in-network URL the app container uses

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 220)}`); }
};

function mkJar() {
  return { cookie: null };
}
function client(jar) {
  return async (method, path, body) => {
    const headers = {};
    let payload;
    if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    if (jar.cookie) headers["Cookie"] = jar.cookie;
    const res = await fetch(BASE + path, { method, headers, body: payload, redirect: "manual" });
    const setC = res.headers.get("set-cookie");
    if (setC) jar.cookie = setC.split(";")[0];
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  };
}

(async () => {
  // sidecar gate (SKIP convention shared with r28…r31)
  let pubPem = null;
  try {
    pubPem = (await (await fetch(`${MOCK_HOST}/__pubkey`)).json()).publicKeyPem;
  } catch { /* not running */ }
  if (!pubPem) {
    console.log("SKIP: mock-irp sidecar not running — start it with: docker compose --profile test up -d mock-irp");
    process.exit(0);
  }

  const admin = client(mkJar());
  const stamp = Date.now().toString(36).slice(-5);
  const coName = `R47 Drill ${stamp}`;
  const memberName = `r47m${stamp}`;
  const outName = `r47o${stamp}`;

  // ---------- setup ----------
  let r = await admin("POST", "/auth/login", { username: "admin", password: "admin123" });
  ok("login admin", r.status === 200, r);

  r = await admin("POST", "/companies", { name: coName, state: "Maharashtra", stateCode: "27",
    address: "1 Drill Lane", city: "Mumbai", pincode: "400001", gstin: `27R47${stamp.toUpperCase()}DRILL0`.slice(0, 15),
    financialYearStart: "2026-04-01", booksBeginFrom: "2026-04-01" });
  ok("company created (owner membership atomic)", r.status === 200 && r.data?.id, r);
  const C = r.data.id; const R = `/c/${C}`;

  // idempotent re-run hygiene: clear sandbox creds this run's company may have
  await admin("DELETE", `/companies/${C}/irp-credentials/sandbox`);

  r = await admin("GET", `${R}/units`);
  ok("seeded units present (Nos/Pieces — R-44)", r.status === 200
    && (r.data || []).some((u) => u.symbol === "Nos") && (r.data || []).some((u) => u.name === "Pieces"), r.data);
  const unit = (r.data || []).find((u) => u.symbol === "Nos");

  r = await admin("GET", `${R}/voucher-types`);
  const vt = Object.fromEntries((r.data || []).map((t) => [t.name, t.id]));
  r = await admin("GET", `${R}/groups`);
  const gr = Object.fromEntries((r.data || []).map((g) => [g.name, g.id]));

  r = await admin("POST", `${R}/ledgers`, { name: "R47 Buyer", groupId: gr["Sundry Debtors"],
    gstin: `29R47${stamp.toUpperCase()}BUY0`.slice(0, 15), gstRegistrationType: "regular",
    partyAddress: "9 Brigade Rd", partyState: "Karnataka", partyPincode: "560001" });
  ok("buyer ledger (regular, GSTIN, party address/state/pincode)", r.status === 200 && r.data?.id, r);
  const buyer = r.data;

  // sales ledger MUST carry taxability=taxable and duty rides the SEEDED IGST
  // ledger (dutyHead=IGST) — the voucherGst classification contract (R-46 §5).
  r = await admin("POST", `${R}/ledgers`, { name: "R47 Sales", groupId: gr["Sales Accounts"], taxability: "taxable" });
  const sales = r.data;
  r = await admin("GET", `${R}/ledgers`);
  const igst = (r.data || []).find((l) => l.name === "IGST" && l.dutyHead === "IGST");
  ok("sales ledger (taxable) + seeded IGST (dutyHead=IGST)", sales?.id && !!igst, r.data?.map?.((l) => l.name));

  r = await admin("POST", `${R}/stock-items`, { name: "R47 Widget", groupId: null, unitId: unit.id,
    gstRate: 18, taxability: "taxable", openingQty: 100, openingRate: 500, standardCost: 500, hsnSac: "8471" });
  ok("stock item with HSN (seeded unit, zero setup)", r.status === 200 && r.data?.id, r);
  const item = r.data;

  const postSale = async (party) => {
    const amt = 10000, tax = 1800;
    return admin("POST", `${R}/vouchers`, { voucherTypeId: vt["Sales"], date: "2026-09-23",
      partyLedgerId: party.id, placeOfSupply: "Karnataka",
      entries: [{ ledgerId: sales.id, amount: -amt }, { ledgerId: igst.id, amount: -tax }, { ledgerId: party.id, amount: amt + tax }],
      inventoryEntries: [{ itemId: item.id, qty: -10, rate: 1000, amount: amt, hsnSac: "8471", gstRate: 18 }] });
  };
  r = await postSale(buyer); const sale1 = r.data;
  r = await postSale(buyer); const sale2 = r.data;
  ok("two B2B sales posted", sale1?.id && sale2?.id, r);

  // ---------- 1) fail-fast without credentials ----------
  r = await admin("GET", `${R}/reports/einvoice/${sale1.id}`);
  ok("e-invoice payload generates w/o connectivity (ok=true)", r.status === 200 && r.data?.ok === true, r);

  r = await admin("POST", `${R}/reports/einvoice/${sale1.id}/submit`);
  ok("e-invoice submit w/o creds -> 400 actionable", r.status === 400 && JSON.stringify(r.data).includes("No sandbox IRP credentials"), r);

  r = await admin("POST", `${R}/reports/ewaybill/${sale1.id}/submit?vehicleNo=MH47DR0001`);
  ok("EWB-from-IRN w/o e-invoice -> 400 register-first", r.status === 400 && JSON.stringify(r.data).includes("Register the e-invoice first"), r);

  r = await admin("POST", `${R}/reports/ewaybill/${sale1.id}/generate-direct?vehicleNo=MH47DR0001`);
  ok("direct EWB w/o any creds -> 400 actionable", r.status === 400 && JSON.stringify(r.data).includes("No sandbox IRP credentials"), r);

  r = await admin("GET", `${R}/reports/submissions`);
  ok("no orphan submission rows from failed submits", r.status === 200 && Array.isArray(r.data) && r.data.length === 0, r);

  // ---------- 2) credential lifecycle + masking ----------
  r = await admin("GET", `/companies/${C}/irp-credentials`);
  ok("credentials list empty", r.status === 200 && r.data.length === 0, r);

  r = await admin("PUT", `/companies/${C}/irp-credentials`, { environment: "sandbox", clientId: "r47cli",
    clientSecret: "", gstin: `27R47${stamp.toUpperCase()}DRILL0`.slice(0, 15), username: "r47op", password: "" });
  ok("empty secrets rejected (retype rule)", r.status === 400 && JSON.stringify(r.data).includes("Invalid IRP credentials"), r);

  r = await admin("PUT", `/companies/${C}/irp-credentials`, { environment: "sandbox", clientId: "r47cli",
    clientSecret: "r47secret", gstin: `27R47${stamp.toUpperCase()}DRILL0`.slice(0, 15), username: "r47op", password: "r47pass",
    publicKeyPem: pubPem, endpointOverride: MOCK_OVERRIDE,
    ewbUsername: "r47ewb", ewbPassword: "r47ewbpass" });
  ok("sandbox creds saved (IRP + EWB pair + mock endpoint)", r.status === 200 && r.data?.environment === "sandbox", r);
  ok("secrets masked (*Last4 only)", r.data && r.data.clientSecretLast4 === "cret"
    && !("clientSecret" in r.data) && !("password" in r.data) && !("ewbPassword" in r.data)
    && !("clientSecretEnc" in r.data) && !("passwordEnc" in r.data) && !("ewbPasswordEnc" in r.data), Object.keys(r.data || {}));

  // ---------- 3) authorization layering ----------
  r = await admin("POST", `/companies/${C}/members`, { username: memberName, password: "member123", role: "accountant" });
  ok("accountant member added", r.status === 200, r);
  r = await admin("POST", "/companies", { name: `R47 Outsider ${stamp}`, state: "Maharashtra", stateCode: "27",
    financialYearStart: "2026-04-01", booksBeginFrom: "2026-04-01" });
  const outCo = r.data?.id;
  r = await admin("POST", `/companies/${outCo}/members`, { username: outName, password: "outsider123", role: "accountant" });
  ok("outsider user created (other company only)", r.status === 200, r);

  const member = client(mkJar());
  await member("POST", "/auth/login", { username: memberName, password: "member123" });
  r = await member("GET", `${R}/reports/submissions`);
  ok("member reads submission history", r.status === 200, r);

  const outsider = client(mkJar());
  await outsider("POST", "/auth/login", { username: outName, password: "outsider123" });
  r = await outsider("POST", `${R}/reports/einvoice/${sale1.id}/submit`);
  ok("non-member submit refused 404 (no leak)", r.status === 404, r);
  r = await outsider("GET", `/companies/${C}/irp-credentials`);
  ok("non-owner credential read refused", r.status === 403 || r.status === 404, r.status);

  // ---------- 4) e-invoice: accept / duplicate / reject+retry ----------
  r = await admin("POST", `${R}/reports/einvoice/${sale1.id}/submit`);
  ok("e-invoice accepted (IRN returned)", r.status === 200 && r.data?.ok === true && r.data?.submission?.irn, r);
  ok("R68: IRP-signed QR + invoice stored on the accepted row", !!r.data?.submission?.signedQrCode && !!r.data?.submission?.signedInvoice,
    { qr: (r.data?.submission?.signedQrCode || "").slice(0, 30), inv: (r.data?.submission?.signedInvoice || "").slice(0, 30) });

  r = await admin("GET", `${R}/reports/submissions?voucherId=${sale1.id}`);
  ok("R68: history exposes the signed QR for the voucher", r.status === 200
    && (r.data || []).some((h) => h.kind === "e-invoice" && h.status === "accepted" && !!h.signedQrCode), (r.data || []).map((h) => [h.kind, h.status]));

  r = await admin("POST", `${R}/reports/einvoice/${sale1.id}/submit`);
  ok("duplicate submit refused 409 w/o network", r.status === 409 && JSON.stringify(r.data).includes("Already submitted"), r);
  ok("R68: duplicate 409 re-surfaces the stored signed QR (idempotent re-read)", !!r.data?.submission?.signedQrCode, Object.keys(r.data?.submission || {}));

  await fetch(`${MOCK_HOST}/__reject`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invoiceNo: sale2.number }) });
  r = await admin("POST", `${R}/reports/einvoice/${sale2.id}/submit`);
  ok("IRP rejection surfaced verbatim (502 + ErrorDetails)", r.status === 502 && r.data?.ok === false && r.data?.irpErrors, r);
  r = await admin("POST", `${R}/reports/einvoice/${sale2.id}/submit`);
  ok("fix-and-retry after rejection -> accepted", r.status === 200 && r.data?.ok === true, r);

  // ---------- 5) EWB-from-IRN lifecycle (eivital birth path) ----------
  r = await admin("POST", `${R}/reports/ewaybill/${sale1.id}/submit?vehicleNo=MH47DR0001&transMode=road`);
  ok("EWB-from-IRN accepted", r.status === 200 && r.data?.ok === true && r.data?.submission?.ewbNo, r);

  r = await admin("POST", `${R}/reports/ewaybill/${sale1.id}/vehicle`, { vehicleNo: "MH47DR0002", fromPlace: "Mumbai", fromState: "27" });
  ok("vehicle update (VEHEWB) accepted", r.status === 200 && r.data?.ok === true, r);

  r = await admin("POST", `${R}/reports/ewaybill/${sale1.id}/extend`,
    { reasonCode: "vehicle_breakdown", remainFrom: "Pune", remainFromState: "27", remainingDistance: 420 });
  ok("validity extension accepted", r.status === 200 && r.data?.ok === true, r);
  r = await admin("POST", `${R}/reports/ewaybill/${sale1.id}/extend`,
    { reasonCode: "others", remainFrom: "Pune", remainFromState: "27", remainingDistance: 100 });
  ok("second extension refused eagerly (once-ever)", r.status === 422 && JSON.stringify(r.data).includes("Only one extension"), r);

  r = await admin("POST", `${R}/reports/ewaybill/${sale1.id}/cancel`, { reasonCode: "data_entry_mistake", remark: "R47 suite cancel" });
  ok("EWB cancel accepted (24h window)", r.status === 200 && r.data?.ok === true, r);
  r = await admin("POST", `${R}/reports/ewaybill/${sale1.id}/submit?vehicleNo=MH47DR0003`);
  ok("cancel re-opens (voucher,kind): fresh EWB accepted", r.status === 200 && r.data?.ok === true, r);

  // ---------- 6) direct B2C EWB (ewayapi birth path) ----------
  r = await admin("POST", `${R}/ledgers`, { name: "R47 Walk-in", groupId: gr["Sundry Debtors"],
    gstRegistrationType: "consumer", partyAddress: "1 Market St", partyState: "Maharashtra", partyPincode: "400001" });
  const walkin = r.data;
  r = await postSale(walkin); const sale3 = r.data;
  ok("B2C sale posted (consumer party)", r.status === 200 && sale3?.id, r);

  r = await admin("GET", `${R}/reports/einvoice/${sale3.id}`);
  ok("e-invoice refuses B2C (honest ok=false)", r.status === 200 && r.data?.ok === false && (r.data?.errors || []).length > 0, r);
  ok("B2C refusal names the scope and the Direct EWB path (F-46-1)", (r.data?.errors || []).some((e) => /B2C/.test(e) && /Direct EWB/.test(e)), r.data?.errors);

  r = await admin("POST", `${R}/reports/ewaybill/${sale3.id}/generate-direct?vehicleNo=MH47DR0004&transMode=road`);
  ok("direct EWB submitted on EWB-API (ewayBillNo)", r.status === 200 && r.data?.ok === true && r.data?.submission?.ewbNo, r);
  r = await admin("POST", `${R}/reports/ewaybill/${sale3.id}/vehicle`, { vehicleNo: "MH47DR0005", fromPlace: "Mumbai", fromState: "27" });
  ok("direct-born EWB vehicle update routes to ewayapi", r.status === 200 && r.data?.ok === true, r);
  r = await admin("POST", `${R}/reports/ewaybill/${sale3.id}/cancel`, { reasonCode: "order_cancelled", remark: "R47 direct cancel" });
  ok("direct-born EWB cancel routes to ewayapi", r.status === 200 && r.data?.ok === true, r);

  // ---------- 7) history verbatim ----------
  r = await admin("GET", `${R}/reports/submissions`);
  const kinds = (r.data || []).map((x) => x.kind);
  const statuses = (r.data || []).map((x) => x.status);
  ok("history: submissions recorded verbatim", r.status === 200
    && kinds.filter((k) => k === "e-invoice").length >= 2 && kinds.filter((k) => k === "ewaybill").length >= 2, { kinds, statuses });
  ok("statuses within documented vocabulary", statuses.every((s) => ["accepted", "rejected", "error", "cancelled", "pending"].includes(s)), statuses);

  console.log(`\n== R46 drill suite: ${pass} passed, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
