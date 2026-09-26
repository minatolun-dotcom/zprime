// R-68 browser acceptance: the IRN QR on the invoice face.
//  A) mock-irp sidecar speaks the R-68 wire (SignedQRCode in GENIRN Data);
//  B) end-to-end: B2B sale → e-invoice submit (accepted, IRN) → invoice face
//     (Sales alter) renders the IRN QR strip — SVG QR + IRN + ack No/date;
//  C) the strip is visible in print media (it rides the print-only face);
//  D) honesty: a voucher with NO e-invoice renders no strip;
//  E) API: the submissions row carries signedQrCode/signedInvoice;
//  F) no page errors.
// Prereqs: compose stack at localhost:3000 (admin/admin123, IRP_ENC_KEY set)
// + the mock-irp test-profile sidecar (docker compose --profile test up -d
// mock-irp) — same SKIP convention as r28…r31/r46.
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 220)}`); }
};

const BASE = D.BASE.replace(/\/$/, "");
const MOCK_HOST = "http://localhost:3299"; // host-published sidecar port
const MOCK_OVERRIDE = "http://mock-irp:3199"; // in-network URL the app uses

(async () => {
  // sidecar gate (SKIP convention shared with r28…r31/r46)
  let pubPem = null;
  try { pubPem = (await (await fetch(`${MOCK_HOST}/__pubkey`)).json()).publicKeyPem; } catch { /* not running */ }
  if (!pubPem) {
    console.log("SKIP: mock-irp sidecar not running — start it with: docker compose --profile test up -d mock-irp");
    process.exit(0);
  }

  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  const coName = `R68 QR ${Date.now().toString(36)}`;
  await D.createCompany({
    name: coName, gstin: "27R68QRCINV0001", stateCode: "27",
    fyStart: "2026-04-01", booksBegin: "2026-04-01",
  });
  const cid = D.cid();
  ok("company created", !!cid, cid);
  // The e-invoice payload validates the SELLER block from the Company master
  // (address + PIN) — the driver's createCompany doesn't fill those fields,
  // so complete the master via the API (same session).
  const coPut = await page.request.put(`${BASE}/api/companies/${cid}`, { data: {
    address: "12 IRN Street", city: "Mumbai", pincode: "400001",
  } });
  ok("company master completed (seller address/PIN)", coPut.ok(), coPut.status());

  // ---- masters: buyer (regular, Karnataka) + taxable sales + seeded IGST ----
  await D.getJson(`/api/c/${cid}/ledgers`); // warm cache via a harmless read
  const g = {};
  for (const grp of await D.getJson(`/api/c/${cid}/groups`)) g[grp.name] = grp.id;
  const buyer = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: {
    name: "R68 Buyer", groupId: g["Sundry Debtors"], gstin: "29R68BUYER01Q3ZX",
    gstRegistrationType: "regular", billWise: true, partyAddress: "6 QR Lane",
    partyState: "Karnataka", partyPincode: "560001",
  } })).json());
  ok("buyer ledger (regular + GSTIN)", buyer?.id, buyer);

  const sales = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: {
    name: "R68 Sales", groupId: g["Sales Accounts"], taxability: "taxable",
  } })).json());
  const igst = (await D.getJson(`/api/c/${cid}/ledgers`)).find((l) => l.name === "IGST" && l.dutyHead === "IGST");
  ok("sales (taxable) + seeded IGST (dutyHead=IGST)", sales?.id && !!igst, !!igst);

  const item = (await (await page.request.post(`${BASE}/api/c/${cid}/stock-items`, { data: {
    name: "R68 Widget", unitId: (await D.getJson(`/api/c/${cid}/units`)).find((u) => u.symbol === "Nos")?.id,
    gstRate: 18, taxability: "taxable", openingQty: 50, openingRate: 500, standardCost: 500, hsnSac: "8471",
  } })).json());
  ok("stock item (seeded unit, HSN)", item?.id, item);

  // ---- sandbox IRP credentials pointing at the sidecar ----
  const put = await page.request.put(`${BASE}/api/companies/${cid}/irp-credentials`, { data: {
    environment: "sandbox", clientId: "r68cli", clientSecret: "r68secret",
    gstin: "27R68QRCINV0001", username: "r68op", password: "r68pass",
    publicKeyPem: pubPem, endpointOverride: MOCK_OVERRIDE,
  } });
  ok("sandbox IRP credentials saved", put.ok(), put.status());

  // ---- the B2B sale (API-seeded; the voucher UX is r66's job) ----
  const vt = Object.fromEntries((await D.getJson(`/api/c/${cid}/voucher-types`)).map((t) => [t.name, t.id]));
  const amt = 10000, tax = 1800;
  const sale = (await (await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: {
    voucherTypeId: vt["Sales"], date: "2026-09-23", partyLedgerId: buyer.id, placeOfSupply: "Karnataka",
    entries: [
      { ledgerId: sales.id, amount: -amt },
      { ledgerId: igst.id, amount: -tax },
      { ledgerId: buyer.id, amount: amt + tax },
    ],
    inventoryEntries: [{ itemId: item.id, qty: -10, rate: 1000, amount: amt, hsnSac: "8471", gstRate: 18 }],
  } })).json());
  ok("B2B sale posted", sale?.id, sale);

  // ---- e-invoice submit against the mock (GENIRN accept) ----
  const sub = await (await page.request.post(`${BASE}/api/c/${cid}/reports/einvoice/${sale.id}/submit`)).json();
  ok("e-invoice accepted (IRN)", sub?.ok === true && !!sub?.submission?.irn, sub);
  ok("R68 wire: submission carries signedQrCode + signedInvoice",
    !!sub?.submission?.signedQrCode && !!sub?.submission?.signedInvoice,
    { qr: (sub?.submission?.signedQrCode || "").slice(0, 24) });
  const irn = sub?.submission?.irn;
  const ackNo = sub?.submission?.ackNo;

  // ---- the invoice face (Sales alter) renders the IRN QR strip ----
  await page.goto(`${BASE}/company/${cid}/daybook`);
  await page.waitForSelector("table tbody tr");
  await page.locator("table tbody tr", { hasText: "R68 Buyer" }).first().locator('a:has-text("Alter")').click();
  await page.waitForSelector("text=Ledger Entries");
  await D.sleep(800); // submissions query + face render

  {
    const strip = page.locator('[data-testid="irn-qr-strip"]');
    ok("invoice face: IRN QR strip rendered", (await strip.count()) >= 1);
    ok("strip shows the IRN", (await strip.count()) >= 1 && (await strip.first().innerText()).includes(String(irn).slice(0, 16)));
    ok("strip shows the ack No", ackNo && (await strip.first().innerText()).includes(String(ackNo)));
    const svg = page.locator('[data-testid="irn-qr-strip"] svg');
    ok("strip carries an SVG QR (crisp on paper)", (await svg.count()) >= 1);
    await page.emulateMedia({ media: "print" });
    const visible = await strip.first().evaluate((el) => {
      let n = el, vis = true;
      while (n && n !== document.body) {
        const cs = getComputedStyle(n);
        if (cs.display === "none" || cs.visibility === "hidden") { vis = false; break; }
        n = n.parentElement;
      }
      return vis;
    }).catch(() => false);
    ok("strip visible in print media (rides the print-only face)", visible === true);
    await page.emulateMedia({ media: "screen" });
  }

  // ---- honesty: a voucher with NO e-invoice renders no strip ----
  const salePlain = (await (await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: {
    voucherTypeId: vt["Sales"], date: "2026-09-24", partyLedgerId: buyer.id, placeOfSupply: "Karnataka",
    entries: [
      { ledgerId: sales.id, amount: -amt },
      { ledgerId: igst.id, amount: -tax },
      { ledgerId: buyer.id, amount: amt + tax },
    ],
    inventoryEntries: [{ itemId: item.id, qty: -5, rate: 1000, amount: amt, hsnSac: "8471", gstRate: 18 }],
  } })).json());
  ok("second sale posted (no e-invoice)", salePlain?.id, salePlain);
  await page.goto(`${BASE}/company/${cid}/daybook`);
  await page.waitForSelector("table tbody tr");
  await page.locator("table tbody tr", { hasText: "R68 Buyer" }).first().locator('a:has-text("Alter")').click();
  await page.waitForSelector("text=Ledger Entries");
  await D.sleep(600);
  ok("no-IRN voucher: NO strip (honest)", (await page.locator('[data-testid="irn-qr-strip"]').count()) === 0);

  ok("no page errors", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-68 RESULT: ${pass} passed, ${fail} failed ==`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
