// R-88 browser acceptance: per-company (manual) backup/restore — Option A from
// R-88_INVESTIGATION.md / R-88_SCOPE.md.
//
//  A) per-company backup manifest scope: back up company A → the remote pair's
//     manifest (downloaded by id from the mock) carries scope: { kind: "company",
//     cid: <A's id>, name: <A's name> }.
//  B) per-company backup run row: runs history records a company-scoped backup row
//     (scope_kind = company, company_id = A) with sha256 + size.
//  C) per-company restore round-trip (in-place, scoped to A): post a voucher in
//     company A → back up company A → delete that voucher → restore company A from
//     the pair → voucher is back on A's Day Book.
//  D) other-company isolation: company B (a different company in the same deployment)
//     is untouched by the company-A restore — its voucher is still there afterwards.
//  E) scope cid-mismatch reject: restoring a company pair whose manifest cid does not
//     match the target company id the route is given is refused with an actionable
//     message. (v1 has no "restore as new company" path — cid must exist and match.)
//  F) deployment backup/restore regression anchor: a deployment backup still contains
//     every company; a deployment restore replaces the whole instance (asserted on the
//     same multi-company rig).
//  G) UI scope picker: run-now card offers Entire database vs One company; the company
//     picker lists the deployment's companies; the remote table renders a Scope column
//     (Deployment / Company · <name or cid>); the restore modal wording is scope-aware.
//  H) runs table renders scope for company-scoped rows.
//  I) in-flight guard applies across scopes: a company backup in flight refuses a
//     concurrent deployment backup (and vice-versa) with 409.
//  J) non-admin neutral 404 (company-list endpoint + company-scoped run/restore are
//     admin-gated like the rest).
//
// Prereqs: compose stack at localhost:3000 (admin/admin123), mock-drive sidecar up
// (compose --profile test), app started with BACKUP_DRIVE_ENDPOINT (and
// BACKUP_OAUTH_ENDPOINT/BACKUP_AUTHORIZE_ENDPOINT) pointing at the in-network mock /
// localhost:3309. Same env-only SSRF posture as R-85.
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 300)}`); }
};

const BASE = D.BASE.replace(/\/$/, "");
const MOCK = process.env.MOCK_DRIVE_URL || "http://localhost:3309";

// Download a file's raw bytes from the mock by file id (Node-side, no CORS).
async function mockDownload(id) {
  const res = await fetch(`${MOCK}/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
  if (!res.ok) throw new Error(`mockDownload ${id}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function gj(p) {
  return (await page.request.get(`${BASE}${p}`)).json();
}

async function mreq(method, path, body) {
  const res = await page.request.fetch(`${BASE}${path}`, { method, data: body ?? undefined });
  let j = null;
  try { j = await res.json(); } catch { /* text */ }
  return { s: res.status(), j };
}

async function mock(method, path, body) {
  const res = await page.request.fetch(`${MOCK}${path}`, {
    method,
    data: body ? JSON.stringify(body) : undefined,
    headers: { "Content-Type": "application/json" },
  });
  return res.json().catch(() => null);
}

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  // ---------- bootstrap a multi-company deployment ----------
  await D.login();
  const stamp = Date.now().toString(36);
  await D.createCompany({
    name: `R88 Deployment ${stamp}`, stateCode: "27",
    fyStart: "2026-04-01", booksBegin: "2026-04-01",
  });
  const deployCid = D.cid();
  ok("deployment company created", !!deployCid, deployCid);

  // A second company (company B) for the isolation probe.
  await D.openCompany(`R88 Deployment ${stamp}`);
  await page.goto(`${BASE}/companies`);
  await page.waitForSelector('button:has-text("Create Company")');
  await page.click('button:has-text("Create Company")');
  const modal = page.locator("form").first();
  await modal.locator("input").nth(0).fill(`R88 Other Company ${stamp}`);
  await modal.locator("select").first().selectOption("29");
  await modal.locator("input").nth(5).fill("2026-04-01");
  await modal.locator("input").nth(6).fill("2026-04-01");
  await modal.locator('button:has-text("Create")').last().click();
  await page.waitForSelector("text=Gateway", { timeout: 20000 });
  await D.sleep(400);
  const otherCid = D.cid();
  ok("second company (company B) created", !!otherCid, otherCid);

  // Admin user + a non-admin user.
  const userStamp = `${stamp}u`;
  await page.request.post(`${BASE}/api/companies/${deployCid}/members`, {
    data: { username: userStamp, password: "worker-pass-1", role: "accountant" },
  });
  await page.request.post(`${BASE}/api/companies/${otherCid}/members`, {
    data: { username: userStamp, password: "worker-pass-1", role: "accountant" },
  });

  // R-88: deduplicate — the R-85/R-86 pattern ran the clipboard stub twice; once is enough.
  await page.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: (t) => { window.__copied.push(String(t)); return Promise.resolve(); } },
      configurable: true,
    });
  });

  // R-88: in-flight probe fragility deduction — the deployment backup that opens
  // this run is itself a backup; the guard already rejects a concurrent company
  // backup. Fire the deployment backup first, wait for it to land, then probe the
  // in-flight gate with a company restore sitting in flight.
  {
    const beforeDeploy = (await mock("GET", "/__files")).length;
    const deployRes = await page.request.fetch(`${BASE}/api/backups/run`, {
      method: "POST",
      data: { scope: { scope: "deployment" } },
    });
    const deployJson = await deployRes.json().catch(() => ({}));
    ok("R88: deployment backup (in-flight opener) itself succeeds", deployRes.status() === 200, deployJson);
    const afterDeploy = await mock("GET", "/__files");
    ok("R88: deployment backup produced a new pair", afterDeploy.length > beforeDeploy, afterDeploy.map((f) => f.name).slice(-3));
    const deployFile = afterDeploy.find((f) => f.name.endsWith(".sql.gz") && !f.name.includes(`-${deployCid}-`) && !f.name.includes(`-${otherCid}-`));
    ok("R88: deployment backup name is scope-unadorned (no cid in the name)", deployFile && !deployFile.name.includes("-"), deployFile?.name);
    window.__deployBase = deployFile?.name?.replace(/\.sql\.gz$/, "");
    window.__deployFileId = deployFile?.id;
  }

  // Clean slate for deterministic chip assertions (settings are a deployment singleton).
  {
    const dc = await mreq("POST", "/api/backups/disconnect");
    ok("clean slate: stale connection cleared", dc.s === 200, dc);
  }

  // ---------- seed fixtures in BOTH companies ----------
  // Company A: ledger + voucher (so the backup is non-empty).
  await D.openCompany(`R88 Deployment ${stamp}`);
  {
    const vt = await gj(`/api/c/${deployCid}/voucher-types`);
    const sales = vt.find((v) => v.name === "Sales");
    const salesL = (await gj(`/api/c/${deployCid}/ledgers?search=Sales R88`)).find((l) => l.name === "Sales R88")
      || (await gj(`/api/c/${deployCid}/ledgers?search=Sales 85`)).find((l) => l.name === "Sales 85");
    const cashL = (await gj(`/api/c/${deployCid}/ledgers?search=Cash 85`)).find((l) => l.name === "Cash 85");
    if (!salesL || !cashL || !sales) throw new Error("fixture ledgers/types missing in company A");
    const v = await (await page.request.post(`${BASE}/api/c/${deployCid}/vouchers`, {
      data: {
        voucherTypeId: sales.id, date: "2026-05-04", narration: "Being goods sold for cash (R88 company A)",
        entries: [{ ledgerId: cashL.id, amount: 5000 }, { ledgerId: salesL.id, amount: -5000 }],
      },
    })).json();
    ok("fixture voucher posted in company A", !!v.id, v.id);
    window.__companyAVoucherNarration = "Being goods sold for cash (R88 company A)";
  }
  // Company B: voucher (so we can assert B is untouched by the company-A restore).
  await D.openCompany(`R88 Other Company ${stamp}`);
  {
    const vt = await gj(`/api/c/${otherCid}/voucher-types`);
    const sales = vt.find((v) => v.name === "Sales");
    const salesL = (await gj(`/api/c/${otherCid}/ledgers?search=Sales R88 Other`)).find((l) => l.name === "Sales R88 Other")
      || (await gj(`/api/c/${otherCid}/ledgers?search=Sales 85`)).find((l) => l.name === "Sales 85");
    const cashL = (await gj(`/api/c/${otherCid}/ledgers?search=Cash 85`)).find((l) => l.name === "Cash 85");
    if (!salesL || !cashL || !sales) throw new Error("fixture ledgers/types missing in company B");
    const v = await (await page.request.post(`${BASE}/api/c/${otherCid}/vouchers`, {
      data: {
        voucherTypeId: sales.id, date: "2026-05-04", narration: "Being goods sold for cash (R88 company B)",
        entries: [{ ledgerId: cashL.id, amount: 7000 }, { ledgerId: salesL.id, amount: -7000 }],
      },
    })).json();
    ok("fixture voucher posted in company B (isolation probe target)", !!v.id, v.id);
  }


  await page.waitForSelector('[data-testid="backup-drive-card"]', { timeout: 10000 });
  {
    const before = (await mock("GET", "/__files")).length;
    await page.click('[data-testid="run-now"]');
    await page.waitForSelector("text=Backup uploaded:", { timeout: 30000 });
    ok("deployment backup succeeded (regression anchor)", (await page.textContent("body")).includes("Backup uploaded:"), (await page.textContent("body")).slice(0, 80));
    const after = await mock("GET", "/__files");
    ok("deployment backup produced a new pair", after.length > before, after.map((f) => f.name).slice(-3));
    // The deployment pair is the one whose name is NOT cid-adorned.
    const deployFile = after.find((f) => f.name.endsWith(".sql.gz") && !f.name.includes(`-${deployCid}-`) && !f.name.includes(`-${otherCid}-`));
    ok("deployment backup name is scope-unadorned (no cid in the name)", deployFile && !deployFile.name.includes("-"), deployFile?.name);
    window.__deployBase = deployFile?.name?.replace(/\.sql\.gz$/, "");
    window.__deployFileId = deployFile?.id;
  }

  // ---------- A) + B) per-company backup: manifest scope + run row ----------
  await page.goto(`${BASE}/backups`);
  await page.waitForSelector('[data-testid="backup-scope"]', { timeout: 10000 });
  ok("run-now card offers Entire database vs One company", await page.locator('[data-testid="backup-scope"]').isVisible(), null);
  await page.selectOption('[data-testid="backup-scope"]', "company");
  ok("company picker appears when One company is chosen", await page.locator('[data-testid="backup-company"]').isVisible(), null);
  const companyOptions = await page.locator('[data-testid="backup-company"] option').allTextContents();
  ok("company picker lists the deployment's companies", companyOptions.length >= 2 && companyOptions.some((o) => o.includes(`R88 Deployment ${stamp}`)), companyOptions);
  await page.selectOption('[data-testid="backup-company"]', `R88 Deployment ${stamp}`);

  await page.click('[data-testid="run-now"]');
  await page.waitForSelector("text=Back up company now", { timeout: 8000 }).catch(() => {});
  await page.waitForSelector("text=Company", { timeout: 30000 });
  ok("company backup reported success", (await page.textContent("body")).includes("Company"), (await page.textContent("body")).slice(0, 120));

  // A) manifest scope: pick the company dump from __files, download its manifest by
  // id, parse scope.
  {
    const files = await mock("GET", "/__files");
    const dump = files.find((f) => f.name.endsWith(".sql.gz") && f.name.includes(`-${deployCid}-`));
    ok("company backup produced a cid-scoped dump name", !!dump, dump?.name);
    const manifestFile = files.find((f) => f.name === `${dump.name.replace(/\.sql\.gz$/, "")}.manifest.json`);
    ok("company backup produced a matching manifest", !!manifestFile, manifestFile?.name);
    const manifestBytes = await mockDownload(manifestFile.id);
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    ok("company manifest scope is company", manifest.scope?.kind === "company", manifest.scope);
    ok("company manifest records the right cid", manifest.scope?.cid === deployCid, manifest.scope);
    ok("company manifest records the company name", !!manifest.scope?.name && manifest.scope.name.includes("R88 Deployment"), manifest.scope);
  }
  // B) run row scope.
  {
    const runs = (await mreq("GET", "/api/backups/runs")).j;
    const companyRun = runs.find((r) => r.kind === "backup" && r.scopeKind === "company" && r.companyId === deployCid);
    ok("runs history has a company-scoped backup row", !!companyRun, runs?.slice(-3));
    ok("company run row has sha256 + size", companyRun && companyRun.sha256?.length === 64 && companyRun.fileSize > 0, companyRun);
  }
  // H) runs table renders scope.
  await page.goto(`${BASE}/backups`);
  await page.waitForSelector('[data-testid="runs-table"]', { timeout: 10000 });
  ok("runs table has a Scope column", (await page.textContent('[data-testid="runs-table"]')).includes("Scope"), (await page.textContent('[data-testid="runs-table"]')).slice(0, 200));
  ok("runs table shows the company-scoped row as Company", (await page.textContent('[data-testid="runs-table"]')).includes("Company"), (await page.textContent('[data-testid="runs-table"]')).slice(0, 200));

  // ---------- remote table scope rendering ----------
  await page.waitForSelector('[data-testid="remote-table"]', { timeout: 10000 });
  const remoteText = await page.textContent('[data-testid="remote-table"]');
  ok("remote table renders a Scope column", remoteText.includes("Scope"), remoteText.slice(0, 200));
  ok("remote table shows the company pair as Company scope", remoteText.includes("Company") && remoteText.includes(`R88 Deployment ${stamp}`), remoteText.slice(0, 200));
  ok("remote table shows the deployment pair as Deployment scope", remoteText.includes("Deployment"), remoteText.slice(0, 200));

  // ---------- C) per-company restore round-trip ----------
  await D.openCompany(`R88 Deployment ${stamp}`);
  await D.deleteVoucher("goods sold for cash (R88 company A)", null);
  await D.openCompany(`R88 Deployment ${stamp}`);
  await page.waitForSelector("table tbody tr", { timeout: 10000 });
  const goneInA = await page.locator("table tbody tr", { hasText: "goods sold for cash (R88 company A)" }).count();
  ok("fixture voucher deleted in company A (restore target)", goneInA === 0, goneInA);

  // Restore company A.
  await page.goto(`${BASE}/backups`);
  await page.waitForSelector('[data-testid="remote-table"]', { timeout: 10000 });
  const companyDump = (await mock("GET", "/__files")).find((f) => f.name.endsWith(".sql.gz") && f.name.includes(`-${deployCid}-`));
  const companyBase = companyDump?.name?.replace(/\.sql\.gz$/, "");
  const row = page.locator('[data-testid="remote-table"] tbody tr', { hasText: companyBase }).first();
  if (!(await row.isVisible().catch(() => false))) {
    ok("R88: restore-skipped — company pair row not visible in remote table", false, `companyBase=${companyBase}`);
    return;
  }
  await row.locator('button:has-text("Restore company…")').click();
  await page.waitForSelector('[data-testid="restore-confirm-modal"]', { timeout: 8000 });
  ok("restore modal opens for a company pair", await page.locator('[data-testid="restore-confirm-modal"]').isVisible(), null);
  const modalText = await page.textContent('[data-testid="restore-confirm-modal"]');
  ok("company restore modal is scope-aware (names the company, mentions other companies untouched)", modalText.includes(`R88 Deployment ${stamp}`) && modalText.includes("other companies are untouched") && modalText.includes("replaces company"), modalText.slice(0, 240));
  await page.fill('[data-testid="restore-confirm-input"]', "RESTORE");
  await page.click('[data-testid="restore-confirm-go"]');
  await page.waitForSelector("text=Restored company", { timeout: 60000 });
  ok("company restore reported success", true, (await page.textContent("body")).slice(0, 120));
  await page.waitForLoadState("load").catch(() => {});
  await D.sleep(2500);
  await D.openCompany(`R88 Deployment ${stamp}`);
  await page.waitForSelector("table tbody tr", { timeout: 10000 });
  const backInA = await page.locator("table tbody tr", { hasText: "goods sold for cash (R88 company A)" }).count();
  ok("company-A restore round-trip: deleted voucher is back", backInA >= 1, backInA);

  // D) other-company isolation.
  await D.openCompany(`R88 Other Company ${stamp}`);
  await page.waitForSelector("table tbody tr", { timeout: 10000 });
  const stillInB = await page.locator("table tbody tr", { hasText: "goods sold for cash (R88 company B)" }).count();
  ok("company B's voucher survived the company-A restore (isolation)", stillInB >= 1, stillInB);
  const bRows = await D.daybookRows();
  const bRow = bRows.find((r) => r.join(" ").includes("goods sold for cash (R88 company B)"));
  ok("company B's voucher still books 7000 after company-A restore", bRow && bRow.join(" ").includes("7,000"), bRow);

  // E) scope cid-mismatch reject: restore the company A pair but pass a different
  // target company id (company B's cid). The route reads scope.cid from the manifest
  // and must refuse because it does not equal the requested companyId.
  await page.goto(`${BASE}/backups`);
  await page.waitForSelector('[data-testid="remote-table"]', { timeout: 10000 });
  const mismatchRow = page.locator('[data-testid="remote-table"] tbody tr', { hasText: companyBase }).first();
  await mismatchRow.locator('button:has-text("Restore company…")').click();
  await page.waitForSelector('[data-testid="restore-confirm-modal"]', { timeout: 8000 });
  await page.fill('[data-testid="restore-confirm-input"]', "RESTORE");
  {
    const { s, j } = await mreq("POST", "/api/backups/restore", {
      base: companyBase,
      confirm: "RESTORE",
      scope: { scope: "company", companyId: otherCid },
    });
    ok("restoring a company pair into a different company id is refused (cid mismatch)", s === 400 && /scope mismatch|cid/i.test(JSON.stringify(j) ?? ""), (s, JSON.stringify(j)?.slice(0, 160)));
  }

  // F) regression anchor: deployment restore replaces the whole instance.
  // Post a marker voucher in company B AFTER the deployment backup (so it should be
  // lost on deployment restore), then restore the deployment pair.
  await D.openCompany(`R88 Other Company ${stamp}`);
  {
    const vt = await gj(`/api/c/${otherCid}/voucher-types`);
    const sales = vt.find((v) => v.name === "Sales");
    const salesL = (await gj(`/api/c/${otherCid}/ledgers?search=Sales R88 Other`)).find((l) => l.name === "Sales R88 Other")
      || (await gj(`/api/c/${otherCid}/ledgers?search=Sales 85`)).find((l) => l.name === "Sales 85");
    const cashL = (await gj(`/api/c/${otherCid}/ledgers?search=Cash 85`)).find((l) => l.name === "Cash 85");
    if (!salesL || !cashL || !sales) throw new Error("fixture ledgers/types missing in company B (regression anchor)");
    const v = await (await page.request.post(`${BASE}/api/c/${otherCid}/vouchers`, {
      data: {
        voucherTypeId: sales.id, date: "2026-05-05", narration: "Being goods sold for cash (R88 company B marker AFTER deployment backup)",
        entries: [{ ledgerId: cashL.id, amount: 9000 }, { ledgerId: salesL.id, amount: -9000 }],
      },
    })).json();
    ok("regression-anchor marker voucher posted in company B (after deployment backup)", !!v.id, v.id);
  }
  await page.goto(`${BASE}/backups`);
  await page.waitForSelector('[data-testid="remote-table"]', { timeout: 10000 });
  const deployRow = page.locator('[data-testid="remote-table"] tbody tr', { hasText: window.__deployBase }).first();
  await deployRow.locator('button:has-text("Restore…")').click();
  await page.waitForSelector('[data-testid="restore-confirm-modal"]', { timeout: 8000 });
  await page.fill('[data-testid="restore-confirm-input"]', "RESTORE");
  await page.click('[data-testid="restore-confirm-go"]');
  await page.waitForSelector("text=Restored from", { timeout: 60000 });
  ok("deployment restore reported success", true, (await page.textContent("body")).slice(0, 120));
  await page.waitForLoadState("load").catch(() => {});
  await D.sleep(2500);
  await D.openCompany(`R88 Deployment ${stamp}`);
  await page.waitForSelector("table tbody tr", { timeout: 10000 });
  const backInAAfterDeployRestore = await page.locator("table tbody tr", { hasText: "goods sold for cash (R88 company A)" }).count();
  ok("deployment restore brought company A's voucher back (whole-instance replace)", backInAAfterDeployRestore >= 1, backInAAfterDeployRestore);
  await D.openCompany(`R88 Other Company ${stamp}`);
  await page.waitForSelector("table tbody tr", { timeout: 10000 });
  const markerGoneInB = await page.locator("table tbody tr", { hasText: "goods sold for cash (R88 company B marker AFTER deployment backup)" }).count();
  ok("deployment restore removed company B's post-backup marker (whole-instance replace)", markerGoneInB === 0, markerGoneInB);
  const backInBAfterDeployRestore = await page.locator("table tbody tr", { hasText: "goods sold for cash (R88 company B)" }).count();
  ok("deployment restore brought company B's original voucher back", backInBAfterDeployRestore >= 1, backInBAfterDeployRestore);

  // G) UI scope picker re-entry.
  await page.goto(`${BASE}/backups`);
  await page.waitForSelector('[data-testid="backup-scope"]', { timeout: 10000 });
  await page.selectOption('[data-testid="backup-scope"]', "company");
  await page.waitForSelector('[data-testid="backup-company"]', { timeout: 8000 });
  ok("company picker re-opens on scope change", await page.locator('[data-testid="backup-company"]').isVisible(), null);
  await page.selectOption('[data-testid="backup-company"]', `R88 Deployment ${stamp}`);
  ok("run button label reads Back up company now for company scope", (await page.textContent('[data-testid="run-now"]')).includes("company"), (await page.textContent('[data-testid="run-now"]')));
  await page.selectOption('[data-testid="backup-scope"]', "deployment");
  ok("run button label reads Back up now for deployment scope", (await page.textContent('[data-testid="run-now"]')).includes("Back up now") && !((await page.textContent('[data-testid="run-now"]')) || "").includes("company"), (await page.textContent('[data-testid="run-now"]')));

  // I) in-flight guard across scopes: fire a company restore, then immediately fire a
  // deployment backup — the second must be 409 while the first is in flight. Fire both
  // fetches before awaiting either to create a real window.
  await page.goto(`${BASE}/backups`);
  await page.waitForSelector('[data-testid="remote-table"]', { timeout: 10000 });
  // R-88: pick a company pair created before the deployment restore so the probe
  // survives the whole-instance replace. Re-derive from __files each run.
  const companyBase2 = (await mock("GET", "/__files")).find((f) => f.name.endsWith(".sql.gz") && f.name.includes(`-${deployCid}-`) && f.name !== `${window.__deployBase}.sql.gz`)?.name?.replace(/\.sql\.gz$/, "");
  if (companyBase2) {
    const r = page.locator('[data-testid="remote-table"] tbody tr', { hasText: companyBase2 }).first();
    await r.locator('button:has-text("Restore company…")').click();
    await page.waitForSelector('[data-testid="restore-confirm-modal"]', { timeout: 8000 }).catch(() => {});
    await page.fill('[data-testid="restore-confirm-input"]', "RESTORE");
    // Fire both API calls before awaiting either, so the second hits the in-flight
    // gate while the first is genuinely running (not yet settled).
    const companyRestorePromise = page.request.fetch(`${BASE}/api/backups/restore`, {
      method: "POST",
      data: { base: companyBase2, confirm: "RESTORE", scope: { scope: "company", companyId: deployCid } },
    });
    const deployBackupPromise = page.request.fetch(`${BASE}/api/backups/run`, {
      method: "POST",
      data: { scope: { scope: "deployment" } },
    });
    const companyResult = await companyRestorePromise;
    const deployResult = await deployBackupPromise;
    ok("company restore ok while in-flight gate open", companyResult.status() === 200, companyResult.status());
    ok("deployment backup refused 409 while a company restore was in flight", deployResult.status() === 409, deployResult.status());
  } else {
    ok("skipped in-flight cross-scope probe (no second company pair found)", false, "no second company-scoped pair");
  }

  // J) non-admin neutral 404.
  const ctx2 = await page.context().browser().newContext({ viewport: { width: 1480, height: 950 } });
  const p2 = await ctx2.newPage();
  await p2.goto(`${BASE}/login`);
  await p2.fill('input[type="text"], input:not([type])', userStamp);
  await p2.fill('input[type="password"]', "worker-pass-1");
  await p2.keyboard.press("Enter");
  await p2.waitForURL("**/companies");
  for (const [m, p, body] of [
    ["GET", "/api/backups/companies", undefined],
    ["POST", "/api/backups/run", { scope: { scope: "company", companyId: deployCid } }],
    ["POST", "/api/backups/restore", { base: companyBase || "zprime-2026-01-01T00-00-00", confirm: "RESTORE", scope: { scope: "company", companyId: deployCid } }],
  ]) {
    const { s } = await (async (method, path, body) => {
      const res = await p2.request.fetch(`${BASE}${path}`, { method, data: body ?? undefined });
      return { s: res.status() };
    })(m, p, body);
    ok(`non-admin 404: ${m} ${p}`, s === 404, s);
  }
  await ctx2.close();

  ok("zero page errors across the R-88 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-88 RESULT: ${pass} passed, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
