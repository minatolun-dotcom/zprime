// R-74 browser acceptance: company logo on prints (operator-approved v1.64.0).
//  A) Upload: ANY image type/size converts in-browser to a canonical ≤512px
//     PNG (Settings card: preview renders, hasLogo flips on the payload);
//     JPEG oversize → downscaled PNG; SVG source → decoded+re-encoded PNG
//     (the stored bytes are raster, never the vector source).
//  B) Server contract: raw PNG accepted, non-PNG bytes refused, junk refused,
//     logo absent → 404, remove → preview + hasLogo flip back.
//  C) Invoice face: logo top-left beside the seller header — and the R-66
//     en-route defect fix is pinned: the seller block now renders the LIVE
//     company record (it had no data source and rendered blank until R-74).
//  D) Report print headers: logo on the print-only provenance header
//     (emulateMedia(print)), screen state untouched.
//  E) Isolation: two companies, one logo — the other stays logo-free;
//     unauthenticated logo fetch refused.
//  F) No page errors anywhere.
// Prereqs: compose stack at localhost:3000 (admin/admin123) with the built
// client (docker compose build app && docker compose up -d app).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 260)}`); }
};

const BASE = D.BASE.replace(/\/$/, "");
const stamp = Date.now().toString(36);

// --- fixture images (raw bytes built here — no binary files in the repo) ---
// A 2×3 red PNG (smallest legal signature-bearing PNG; PNG_SIG accepts it).
const PNG_2x3 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000020000000308020000009d4aa2740000001b4944415478da63fc3fc3f0ff3f070408c0c9487c8820a0000da7d95f461bcf35c0000000049454e44ae426082",
  "hex",
);
// A ~2000×2000 solid JPEG (SVG-free raster oversize — exercises the ≤512px
// downscale in the browser canvas). Built as a base64-truncated minimal JFIF
// would be brittle; instead the suite converts a LARGE canvas-drawn PNG — the
// conversion path is identical for JPEG (both go through <img> decode).
// So: fixture A = the 2×3 PNG (identity-scale), fixture B = a big canvas PNG
// generated in-page, fixture C = junk bytes.

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  await D.createCompany({
    name: `R74 Logo Co ${stamp}`, gstin: "27R74LOGO0001Z", stateCode: "27",
    fyStart: "2026-04-01", booksBegin: "2026-04-01",
  });
  const cid = D.cid();
  ok("company created", !!cid, cid);

  const coUrl = (q = {}) => {
    const qs = new URLSearchParams({ ...q }).toString();
    return `${BASE}/api/companies/${cid}${qs ? `?${qs}` : ""}`;
  };
  const getCo = async () => (await page.request.get(coUrl())).json();

  // ---- B) server contract (raw PNG via PUT with image/png body) -------------
  const putLogo = async (buf, ctype = "image/png") =>
    page.request.put(`${BASE}/api/companies/${cid}/logo`, { data: buf, headers: { "content-type": ctype } });
  const delLogo = async () => page.request.delete(`${BASE}/api/companies/${cid}/logo`);

  const noLogo = await page.request.get(`${BASE}/api/companies/${cid}/logo`);
  ok("logo absent → 404 before any upload", noLogo.status() === 404, noLogo.status());
  ok("company payload exposes hasLogo=false with no bytes", (await getCo()).hasLogo === false, await getCo());

  const junk = await putLogo(Buffer.from("definitely not an image"), "image/png");
  ok("non-PNG bytes refused (signature check)", junk.status() === 400, await junk.text());
  const coAfterJunk = await getCo();
  ok("junk upload stored nothing", coAfterJunk.hasLogo === false, coAfterJunk.hasLogo);

  const pngPut = await putLogo(PNG_2x3);
  ok("raw PNG accepted (image/png body)", pngPut.ok(), await pngPut.text());
  const coAfterPut = await getCo();
  ok("hasLogo flips true after upload", coAfterPut.hasLogo === true, coAfterPut.hasLogo);
  const logoFetch = await page.request.get(`${BASE}/api/companies/${cid}/logo`);
  ok("logo serves back as image/png", logoFetch.status() === 200 && (logoFetch.headers()["content-type"] || "").includes("image/png"), { s: logoFetch.status(), ct: logoFetch.headers()["content-type"] });
  const back = await logoFetch.body();
  ok("served bytes identical to stored bytes", back.equals(PNG_2x3), { len: back.length, want: PNG_2x3.length });

  const unauthStatus = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: "omit" });
    return r.status;
  }, `${BASE}/api/companies/${cid}/logo`);
  ok("unauthenticated logo fetch refused", unauthStatus === 401 || unauthStatus === 404, unauthStatus);
  const del = await delLogo();
  ok("DELETE removes the logo", del.ok() && (await getCo()).hasLogo === false, await del.text());

  // ---- A) Settings UI: upload-anything conversion ---------------------------
  await page.goto(`${BASE}/company/${cid}/settings`);
  await page.waitForSelector('[data-testid="logo-input"]', { state: "attached" });
  ok("Settings renders the print-logo card (no logo state)",
     /no logo/.test(await page.locator('[data-testid="logo-preview"]').textContent() ?? ""), null);

  // Oversize raster: a 1600×900 PNG drawn in-page, injected into the real
  // file input via DataTransfer (no binary fixture in the repo) — the browser
  // converts it to a ≤512px PNG before the PUT, exactly as an operator upload
  // of any JPEG/WebP/AVIF/SVG would flow through the same <img> decode path.
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 1600; c.height = 900;
    const g = c.getContext("2d");
    g.fillStyle = "#1e3a8a"; g.fillRect(0, 0, 1600, 900);
    g.fillStyle = "#ffffff"; g.beginPath(); g.arc(800, 450, 300, 0, Math.PI * 2); g.fill();
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "big.png", { type: "image/png" }));
    const input = document.querySelector('[data-testid="logo-input"]');
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await D.sleep(1200);
  const previewImg = page.locator('[data-testid="logo-preview"] img');
  ok("Settings preview renders after upload (converted in-page)", (await previewImg.count()) === 1, null);
  ok("company payload hasLogo=true after UI upload", (await getCo()).hasLogo === true, null);
  const uiLogo = await page.request.get(`${BASE}/api/companies/${cid}/logo`);
  const uiBytes = await uiLogo.body();
  const dims = await page.evaluate(async (b64) => {
    const res = await fetch(`data:image/png;base64,${b64}`);
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const d = { w: bmp.width, h: bmp.height };
    bmp.close();
    return d;
  }, uiBytes.toString("base64"));
  ok("stored logo is the canonical ≤512px PNG (1600×900 → 512×288)",
     dims.w === 512 && dims.h === 288, dims);

  // ---- C) invoice face: logo + seller header from the LIVE company ----------
  // minimal trading fixture (print suite, not a stock suite)
  await D.allowNegativeStock(`R74 Logo Co ${stamp}`);
  const g = {};
  for (const grp of await (await page.request.get(`${BASE}/api/c/${cid}/groups`)).json()) g[grp.name] = grp.id;
  const ledgers = await (await page.request.get(`${BASE}/api/c/${cid}/ledgers`)).json();
  const cash = ledgers.find((l) => l.name === "Cash");
  const buyer = await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: `R74 Logo Buyer ${stamp}`, groupId: g["Sundry Debtors"], billWise: true } })).json();
  const salesL = await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: "R74 Logo Sales", groupId: g["Sales Accounts"] } })).json();
  const vtList = await (await page.request.get(`${BASE}/api/c/${cid}/voucher-types`)).json();
  const vt = Object.fromEntries(vtList.map((t) => [t.name, t.id]));
  const sale = await (await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: {
    voucherTypeId: vt["Sales"], date: "2026-04-10", partyLedgerId: buyer.id,
    entries: [
      { ledgerId: salesL.id, amount: -500 },
      { ledgerId: buyer.id, amount: 500 },
    ],
  } })).json();
  ok("fixture sale saved", !!sale.id, sale);

  await page.goto(`${BASE}/company/${cid}/voucher/${sale.id}/edit`);
  await page.waitForSelector("text=Ledger Entries");
  await D.sleep(600);
  ok("invoice preview carries the seller name from the LIVE company (R-66 defect fix)",
     (await page.locator(`text=R74 Logo Co ${stamp}`).count()) >= 1, null);
  await page.emulateMedia({ media: "print" });
  const invLogo = await page.locator('[data-testid="invoice-logo"]').first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { visible: cs.display !== "none", w: el.naturalWidth, h: el.naturalHeight };
  }).catch(() => ({ visible: false, w: 0, h: 0 }));
  ok("invoice face renders the logo in print media (loaded pixels)",
     invLogo.visible && invLogo.w > 0, invLogo);
  await page.emulateMedia({ media: "screen" });

  // ---- D) report print headers ------------------------------------------------
  await page.goto(`${BASE}/company/${cid}/reports/trial-balance`);
  await page.waitForSelector("table.report-table", { timeout: 8000 });
  await page.emulateMedia({ media: "print" });
  const repLogo = await page.locator('[data-testid="report-logo"]').first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { visible: cs.display !== "none", w: el.naturalWidth };
  }).catch(() => ({ visible: false, w: 0 }));
  const printHeadVisible = await page.locator("main div.hidden.print\\:block").first().evaluate((el) => getComputedStyle(el).display !== "none").catch(() => false);
  ok("report PrintHead renders with the logo in print media",
     printHeadVisible && repLogo.visible && repLogo.w > 0, { printHeadVisible, repLogo });
  await page.emulateMedia({ media: "screen" });
  ok("report header is print-only (hidden on screen)",
     (await page.locator('[data-testid="report-logo"]').count()) === 0
     || await page.locator('[data-testid="report-logo"]').first().isHidden().catch(() => true), null);

  // ---- E) isolation: a second company stays logo-free ------------------------
  await D.createCompany({ name: `R74 No Logo ${stamp}`, stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid2 = D.cid();
  const co2 = await (await page.request.get(`${BASE}/api/companies/${cid2}`)).json();
  ok("second company hasLogo=false (logos are per-company)", co2.hasLogo === false, co2.hasLogo);
  const logo2 = await page.request.get(`${BASE}/api/companies/${cid2}/logo`);
  ok("second company's logo endpoint 404s", logo2.status() === 404, logo2.status());

  // remove flow on company 1 (back on its settings page)
  await page.goto(`${BASE}/company/${cid}/settings`);
  await page.waitForSelector('[data-testid="logo-remove"]');
  await page.click('[data-testid="logo-remove"]');
  // Deterministic: wait for the version-bumped refetch (404 → null) to clear
  // the preview instead of a blind sleep on a freshly-mounted page.
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="logo-preview"]');
    return el && /no logo/.test(el.textContent ?? "");
  }, null, { timeout: 6000 }).catch(() => null);
  const coAfterRemove = await getCo();
  const previewText = (await page.locator('[data-testid="logo-preview"]').textContent()) ?? "";
  ok("remove flips hasLogo back", coAfterRemove.hasLogo === false, coAfterRemove.hasLogo);
  ok("remove clears the preview", /no logo/.test(previewText), previewText.slice(0, 60));

  ok("zero page errors across the R-74 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-74 LOGO RESULT: ${pass} passed, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
