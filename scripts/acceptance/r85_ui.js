// R-85 browser acceptance: in-app backups to Google Drive (UpdraftPlus-style),
// operator-approved scope S2 (backup + restore) from R-85_INVESTIGATION.md.
// Uses the mock Drive sidecar (compose --profile test) via the env-only
// BACKUP_*_ENDPOINT overrides — the SSRF posture itself (no API/UI-settable
// destination) is asserted below.
//
//  A) Non-admin neutral 404s: every /api/backups/* route answers 404 for a
//     company user without the admin flag (no existence leak); /users/:id/admin
//     too.
//  B) Deployment admin (seeded operator) sees the Backups page from the
//     Gateway → Utilities pane; non-admin URL gets the neutral not-found card.
//  C) Wizard: exact redirect URI displayed (matches the request's origin) +
//     the "In production" 7-day-trap warning; masked secret read-back and
//     retype-to-change (omitted secret keeps the stored one).
//  D) Connect end-to-end: /oauth/start → mock consent (browser navigation) →
//     callback → connected chip + a connect row in the runs history.
//  E) Back up now: dump + manifest land in the mock Drive folder; runs row
//     ok with sha256; remote list shows the pair.
//  F) Restore round-trip: voucher posted → backup → voucher deleted → restore
//     → voucher back on the Day Book; restore without the typed "RESTORE"
//     confirmation is refused 400; sha-mismatch dump REFUSES to restore.
//  G) invalid_grant (the 7-day "Testing" signature) surfaces the actionable
//     banner.
//  H) Disconnect: revokes + wipes the token (Drive calls fail until reconnect).
//  I) Schedule: settings persist; disabled schedule + unconnected Drive never
//     fires (scheduleTick guard contract).
//  J) Admin promotion: non-admin promotes another user from Users card; last
//     admin cannot be demoted; self-flag change refused.
// Prereqs: compose stack at localhost:3000 (admin/admin123), mock-drive sidecar
// up, app started with BACKUP_DRIVE_ENDPOINT/BACKUP_OAUTH_ENDPOINT pointing at
// the in-network mock and BACKUP_AUTHORIZE_ENDPOINT at http://localhost:3309.
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 300)}`); }
};

const BASE = D.BASE.replace(/\/$/, "");
const MOCK = process.env.MOCK_DRIVE_URL || "http://localhost:3309";

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  const stamp = Date.now().toString(36);
  await D.createCompany({
    name: `R85 Backups ${stamp}`, stateCode: "27",
    fyStart: "2026-04-01", booksBegin: "2026-04-01",
  });
  const cid = D.cid();
  ok("company created", !!cid, cid);

  // Second user for the admin-gate + promotion checks
  const userStamp = `${stamp}u`;
  await page.request.post(`${BASE}/api/companies/${cid}/members`, {
    data: { username: userStamp, password: "worker-pass-1", role: "accountant" },
  });

  const mreq = async (method, path, body) => {
    const res = await page.request.fetch(`${BASE}${path}`, { method, data: body ?? undefined });
    let j = null;
    try { j = await res.json(); } catch { /* text */ }
    return { s: res.status(), j };
  };
  const mock = async (method, path, body) => {
    const res = await page.request.fetch(`${MOCK}${path}`, { method, data: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json" } });
    return res.json().catch(() => null);
  };
  const gj = async (p) => (await page.request.get(`${BASE}${p}`)).json();

  // ---------------- A) non-admin neutral 404s ----------------
  await D.openCompany(`R85 Backups ${stamp}`);
  const C = `/api/c/${cid}`;
  await D.createMaster("ledgers", [["Name *", "Sales 85"], ["Under Group *", { label: "Sales Accounts" }]]);
  await D.createMaster("ledgers", [["Name *", "Cash 85"], ["Under Group *", { label: "Cash-in-Hand" }]]);

  const adminP = page.context(); // context cookies shared across pages in the context
  // Log in as the worker in a SECOND context (fresh cookies)
  const ctx2 = await page.context().browser().newContext({ viewport: { width: 1480, height: 950 } });
  const p2 = await ctx2.newPage();
  await p2.goto(`${BASE}/login`);
  await p2.fill('input[type="text"], input:not([type])', userStamp);
  await p2.fill('input[type="password"]', "worker-pass-1");
  await p2.keyboard.press("Enter");
  await p2.waitForURL("**/companies");
  const wreq = async (method, path, body) => {
    const res = await p2.request.fetch(`${BASE}${path}`, { method, data: body ?? undefined });
    let j = null;
    try { j = await res.json(); } catch { /* text */ }
    return { s: res.status(), j };
  };

  for (const [m, p] of [
    ["GET", "/api/backups/settings"], ["PUT", "/api/backups/settings"], ["POST", "/api/backups/oauth/start"],
    ["POST", "/api/backups/disconnect"], ["GET", "/api/backups/runs"], ["POST", "/api/backups/run"],
    ["GET", "/api/backups/remote"], ["POST", "/api/backups/restore"],
  ]) {
    const { s } = await wreq(m, p, m === "PUT" ? { folderName: "x" } : m === "POST" && p.includes("restore") ? { base: "zprime-2026-01-01T00-00-00", confirm: "RESTORE" } : {});
    ok(`non-admin 404: ${m} ${p}`, s === 404, s);
  }
  {
    const { s } = await wreq("PATCH", `/api/users/1/admin`, { isAdmin: true });
    ok("non-admin 404: PATCH /users/1/admin", s === 404, s);
  }
  // Non-admin UI: /backups shows the neutral not-found card
  await p2.goto(`${BASE}/backups`);
  await p2.waitForSelector("text=Backups not found", { timeout: 8000 }).catch(() => {});
  ok("non-admin /backups shows the neutral not-found card", await p2.isVisible("text=Backups not found"));
  await ctx2.close();

  // ---------------- B) Gateway → Utilities → Backups ----------------
  await page.goto(`${BASE}/company/${cid}`);
  await page.waitForSelector("text=Gateway of zprime", { timeout: 10000 });
  await page.click('button.fkey-item:has-text("Utilities")');
  await page.waitForSelector('[data-testid="gateway-contents"] a:has-text("Backups")', { timeout: 8000 });
  ok("Gateway Utilities pane lists Backups (click-only, no new chord)", true, null);

  // ---------------- C) wizard + masked secret ----------------
  // Clean slate: a previous suite run may have left the deployment connected
  // (settings are a deployment-wide singleton). Disconnect before the first
  // chip assertion so the starting state is deterministic.
  {
    const dc = await mreq("POST", "/api/backups/disconnect");
    ok("clean slate: stale connection cleared", dc.s === 200, dc);
  }

  await page.goto(`${BASE}/backups`);
  await page.waitForSelector('[data-testid="backup-drive-card"]', { timeout: 10000 });
  ok("admin sees the Backups page", await page.isVisible('[data-testid="backup-drive-card"]'));
  ok("connection chip starts Not connected", (await page.textContent('[data-testid="backup-connection-chip"]')).includes("Not connected"));

  await page.click('[data-testid="wizard-toggle"]');
  await page.waitForSelector('[data-testid="backup-wizard"]');
  const wizText = await page.textContent('[data-testid="backup-wizard"]');
  ok("wizard carries the In-production 7-day-trap warning", /In production/i.test(wizText) && /7 days/i.test(wizText), wizText.slice(0, 120));
  const shownUri = await page.textContent('[data-testid="redirect-uri"]');
  ok("wizard shows the exact redirect URI for this origin", shownUri.trim() === `${BASE}/api/backups/oauth/callback`, shownUri);

  await page.fill('[data-testid="backup-client-id"]', "mock-client-id.apps.googleusercontent.com");
  await page.fill('[data-testid="backup-client-secret"]', "mock-client-secret-ABC");
  await page.click('[data-testid="backup-save"]');
  await page.waitForSelector("text=Backup settings saved.");
  const saved = (await mreq("GET", "/api/backups/settings")).j;
  ok("secret read-back is masked (last4, no plaintext)", saved.hasClientSecret && saved.clientSecretLast4 === "-ABC" && !JSON.stringify(saved).includes("mock-client-secret-ABC"), saved);

  // Retype-to-change: save WITHOUT retyping → stored secret unchanged (last4 same)
  await page.fill('[data-testid="backup-client-secret"]', "");
  await page.click('[data-testid="backup-save"]');
  await page.waitForSelector("text=Backup settings saved.");
  const saved2 = (await mreq("GET", "/api/backups/settings")).j;
  ok("omitted secret keeps the stored one (R-28)", saved2.clientSecretLast4 === "-ABC", saved2);

  // ---------------- SSRF posture: env-only endpoints ----------------
  {
    const { s, j } = await mreq("PUT", "/api/backups/settings", { clientId: "x", endpointOverride: "http://evil.example" });
    ok("settings API has no destination-URL surface (unknown field rejected)", s === 400, (s, JSON.stringify(j)?.slice(0, 120)));
  }

  // ---------------- D) connect end-to-end ----------------
  await mock("POST", "/__reset");
  await page.click('[data-testid="connect-drive"]');
  await page.waitForSelector("text=Google Drive connected.", { timeout: 15000 });
  ok("connect round-trip lands back with the connected chip", (await page.textContent('[data-testid="backup-connection-chip"]')).includes("Connected"));
  {
    const st = await mock("GET", "/__stats"); // Node-side request (browser fetch would hit CORS)
    ok("mock consent was exercised (browser navigation)", st && st.authCalls >= 1 && st.codeExchanges >= 1, st);
  }
  {
    const runs = (await mreq("GET", "/api/backups/runs")).j;
    ok("connect audited in the runs history", Array.isArray(runs) && runs.some((r) => r.kind === "connect" && r.status === "ok"), runs?.slice(0, 2));
  }

  // ---------------- E) Back up now ----------------
  // One real voucher — the restore probe needs posted data to find again.
  const vt = await gj(`${C}/voucher-types`);
  const sales = vt.find((v) => v.name === "Sales");
  const ledgers = await gj(`${C}/ledgers?search=Sales 85`);
  const salesL = ledgers.find((l) => l.name === "Sales 85");
  const cashL = (await gj(`${C}/ledgers?search=Cash 85`)).find((l) => l.name === "Cash 85");
  const vpost = async (body) => {
    const res = await page.request.post(`${BASE}${C}/vouchers`, { data: body });
    if (!res.ok()) throw new Error(`voucher failed: ${await res.text()}`);
    return res.json();
  };
  const v1 = await vpost({ voucherTypeId: sales.id, date: "2026-05-04", narration: "Being goods sold for cash (R85)",
    entries: [{ ledgerId: cashL.id, amount: 5000 }, { ledgerId: salesL.id, amount: -5000 }] });
  ok("fixture voucher posted", !!v1.id, v1);

  await page.click('[data-testid="run-now"]');
  await page.waitForSelector("text=Backup uploaded:", { timeout: 30000 });
  {
    const files = await mock("GET", "/__files");
    const dump = files.find((f) => f.name.endsWith(".sql.gz"));
    const man = files.find((f) => f.name.endsWith(".manifest.json"));
    ok("dump + manifest uploaded to the (mock) Drive folder", !!dump && !!man && dump.parents?.length > 0, files.map((f) => f.name));
    const runs = (await mreq("GET", "/api/backups/runs")).j;
    const okRun = runs.find((r) => r.kind === "backup" && r.status === "ok");
    ok("backup runs row ok with sha256 + size", okRun && okRun.sha256?.length === 64 && okRun.fileSize > 0, okRun);
  }
  // The remote table renders the pair
  await page.waitForSelector('[data-testid="remote-table"]', { timeout: 10000 });
  ok("remote list shows the backup", (await page.textContent('[data-testid="remote-table"]')).includes("zprime-"));

  // ---------------- F) restore round-trip ----------------
  const base = (await mock("GET", "/__files")).find((f) => f.name.endsWith(".sql.gz")).name.replace(/\.sql\.gz$/, "");
  // Mutate live data: delete the voucher (visit a company URL first so the
  // driver's cid() parses — deleteVoucher re-navigates itself)
  await page.goto(`${BASE}/company/${cid}/daybook`);
  await page.waitForSelector("table tbody tr");
  await D.deleteVoucher("goods sold for cash (R85)", null);
  await page.goto(`${BASE}/company/${cid}/daybook`);
  await page.waitForSelector("table tbody tr");
  const gone = await page.locator("table tbody tr", { hasText: "goods sold for cash" }).count();
  ok("fixture voucher deleted after backup", gone === 0, gone);

  // Back to the Backups page — the delete steps navigated away to the Day Book
  await page.goto(`${BASE}/backups`);
  await page.waitForSelector('[data-testid="remote-table"]', { timeout: 10000 });

  // Restore refusal without the typed confirmation (API-level gate)
  {
    const { s } = await mreq("POST", "/api/backups/restore", { base });
    ok("restore without confirm=RESTORE refused 400", s === 400, s);
  }

  // UI restore: typed confirmation
  const row = page.locator('[data-testid="remote-table"] tbody tr', { hasText: base }).first();
  await row.locator('button:has-text("Restore…")').click();
  await page.waitForSelector('[data-testid="restore-confirm-modal"]');
  ok("Restore button disabled until RESTORE is typed", await page.locator('[data-testid="restore-confirm-go"]').isDisabled());
  await page.fill('[data-testid="restore-confirm-input"]', "RESTORE");
  await page.click('[data-testid="restore-confirm-go"]');
  await page.waitForSelector("text=Restored from", { timeout: 60000 });
  ok("restore reported success", true, null);
  await page.waitForLoadState("load");
  await D.sleep(2500);
  await page.goto(`${BASE}/company/${cid}/daybook`);
  await page.waitForSelector("table tbody tr");
  const back = await page.locator("table tbody tr", { hasText: "goods sold for cash" }).count();
  ok("restore round-trip: deleted voucher is back on the Day Book", back >= 1, back);

  // sha-mismatch refuses
  await mock("POST", "/__corrupt", { name: `${base}.sql.gz` });
  {
    const { s, j } = await mreq("POST", "/api/backups/restore", { base, confirm: "RESTORE" });
    ok("sha-mismatch dump REFUSES to restore", s === 500 && /Integrity check FAILED|refusing/i.test(JSON.stringify(j) ?? ""), (s, JSON.stringify(j)?.slice(0, 140)));
  }

  // ---------------- G) invalid_grant banner ----------------
  // The access token is cached server-side, so force the REAL recovery path:
  // a 401 on the next Drive call invalidates the cache and retries, the retry
  // refreshes, and the refresh fails with the 7-day-"Testing" signature.
  await mock("POST", "/__fail-refresh", { error: "invalid_grant" });
  await mock("POST", "/__fail-drive-401", {});
  {
    const { s, j } = await mreq("POST", "/api/backups/run", {});
    ok("invalid_grant surfaces the actionable 7-day message", /In production|7 days|reconnect/i.test(JSON.stringify(j?.error ?? j) ?? ""), (s, JSON.stringify(j)?.slice(0, 200)));
  }
  // The error row is in the history
  {
    const runs = (await mreq("GET", "/api/backups/runs")).j;
    ok("failed run recorded as an error row", runs.some((r) => r.status === "error" && /invalid_grant|In production/i.test(r.error ?? "")), runs?.find((r) => r.status === "error")?.error);
  }

  // ---------------- H) disconnect ----------------
  await page.goto(`${BASE}/backups`);
  await page.waitForSelector('[data-testid="disconnect-drive"]');
  // Register the dialog handler BEFORE the click — Playwright auto-dismisses
  // dialogs that fire with no listener, and confirm() returning false would
  // silently skip the disconnect.
  page.once("dialog", (d) => d.accept());
  await page.click('[data-testid="disconnect-drive"]');
  await page.waitForSelector("text=Google Drive disconnected", { timeout: 10000 });
  ok("disconnect wipes the connection", (await page.textContent('[data-testid="backup-connection-chip"]')).includes("Not connected"));
  {
    const runs = (await mreq("GET", "/api/backups/runs")).j;
    ok("disconnect audited in the runs history", runs.some((r) => r.kind === "disconnect" && r.status === "ok"), runs?.slice(0, 2));
  }
  // Reconnect for the schedule test (tokens are static in the mock)
  await page.click('[data-testid="connect-drive"]');
  await page.waitForSelector("text=Google Drive connected.", { timeout: 15000 });

  // ---------------- I) schedule contract ----------------
  await page.fill('[data-testid="backup-hhmm"]', "03:15");
  await page.selectOption('[data-testid="backup-kind"]', "daily");
  await page.click('[data-testid="backup-save"]');
  await page.waitForSelector("text=Backup settings saved.");
  {
    const s = (await mreq("GET", "/api/backups/settings")).j;
    ok("schedule persists (kind + time + enabled)", s.scheduleKind === "daily" && s.scheduleHhmm === "03:15", s);
  }
  // Disabled schedule never fires: uncheck, save, settings honest
  await page.uncheck('[data-testid="backup-enabled"]');
  await page.click('[data-testid="backup-save"]');
  await page.waitForSelector("text=Backup settings saved.");
  {
    const s = (await mreq("GET", "/api/backups/settings")).j;
    ok("disabled schedule stored disabled", s.enabled === false, s);
  }

  // ---------------- J) admin promotion ----------------
  await page.goto(`${BASE}/company/${cid}/settings`);
  await page.waitForSelector('[data-testid^="admin-"]');
  ok("admin checkbox renders for members", (await page.locator('[data-testid^="admin-"]').count()) >= 2);
  const membersNow = await gj(`/api/companies/${cid}/members`);
  const workerId = membersNow.find((m) => m.username === userStamp).userId;
  const adminId = membersNow.find((m) => m.username === "admin").userId;
  // promote the worker from the Users card. click + toast + API-truth (not
  // page.check — the controlled checkbox refetches asynchronously, so DOM
  // state right after the click is not the assertion).
  await page.click(`[data-testid="admin-${userStamp}"]`);
  await page.waitForSelector("text=can now manage deployment Backups", { timeout: 10000 });
  await page.waitForFunction(
    (name) => document.querySelector(`[data-testid="admin-${name}"]`)?.checked === true,
    userStamp,
    { timeout: 10000 },
  );
  ok("promotion from the Users card succeeded", true, null);
  {
    const ctx3 = await page.context().browser().newContext({ viewport: { width: 1480, height: 950 } });
    const p3 = await ctx3.newPage();
    await p3.goto(`${BASE}/login`);
    await p3.fill('input[type="text"], input:not([type])', userStamp);
    await p3.fill('input[type="password"]', "worker-pass-1");
    await p3.keyboard.press("Enter");
    await p3.waitForURL("**/companies");
    const res = await p3.request.get(`${BASE}/api/backups/settings`);
    ok("promoted user passes the admin gate", res.status() === 200, res.status());
    // Two admins now: the worker may demote the OTHER admin...
    const demoteAdmin = await p3.request.patch(`${BASE}/api/users/${adminId}/admin`, { data: { isAdmin: false } });
    ok("one admin can demote the other while two exist", demoteAdmin.status() === 200, demoteAdmin.status());
    // ...but never themselves (no accidental self-lockout).
    const selfDemote = await p3.request.patch(`${BASE}/api/users/${workerId}/admin`, { data: { isAdmin: false } });
    ok("self admin-flag change refused 409", selfDemote.status() === 409, selfDemote.status());
    // Restore the admin from the worker's elevated session, then the admin
    // demotes the worker — the gate reacts immediately both ways.
    await p3.request.patch(`${BASE}/api/users/${adminId}/admin`, { data: { isAdmin: true } });
    const res2 = await page.request.get(`${BASE}/api/backups/settings`); // admin session still works
    ok("re-promoted admin keeps access", res2.status() === 200, res2.status());
    await ctx3.close();
  }
  {
    const demote = await page.request.patch(`${BASE}/api/users/${workerId}/admin`, { data: { isAdmin: false } });
    ok("admin demotes the promoted user", demote.status() === 200, demote.status());
    const ctx4 = await page.context().browser().newContext({ viewport: { width: 1480, height: 950 } });
    const p4 = await ctx4.newPage();
    await p4.goto(`${BASE}/login`);
    await p4.fill('input[type="text"], input:not([type])', userStamp);
    await p4.fill('input[type="password"]', "worker-pass-1");
    await p4.keyboard.press("Enter");
    await p4.waitForURL("**/companies");
    const res = await p4.request.get(`${BASE}/api/backups/settings`);
    ok("demoted user is gated again immediately (404)", res.status() === 404, res.status());
    await ctx4.close();
  }

  ok("zero page errors across the R-85 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-85 RESULT: ${pass} passed, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
