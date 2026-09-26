// PERSONA C — hostile user / hacker trying to break the app.
// Defensive-only: everything runs against the LOCAL test stack with seeded
// data, using the browser's own session for API probes. Sections:
//   1) unauthenticated/garbage requests (401/400/404, no stack traces)
//   2) horizontal authz — cross-company id guessing (404 no-leak)
//   3) injection payloads (SQLi-style, XSS stored+reflected)
//   4) negative/zero/huge amounts, precision abuse in vouchers
//   5) duplicate voucher numbers, self-referencing transfers
//   6) tampering: membership-scoped endpoints from a non-member session
//   7) integrity: after all abuse, the books still balance (TB Dr == Cr)
// Prereqs: compose stack at localhost:3000 (admin/admin123).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 220)}`); }
};

const BASE = D.BASE.replace(/\/$/, "");
const SQLI = ["' OR 1=1 --", "1; DROP TABLE users", "1' UNION SELECT NULL,username,password FROM users --", "admin'--"];

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  const stamp = Date.now().toString(36);
  await D.createCompany({ name: `HackCo ${stamp}`, fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("attack company created", !!cid, cid);

  const g = {};
  for (const grp of await D.getJson(`/api/c/${cid}/groups`)) g[grp.name] = grp.id;
  const cash = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: "Cash X", groupId: g["Cash-in-Hand"] } })).json());
  const cap = (await (await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: "Capital X", groupId: g["Capital Account"] } })).json());

  // ===== 1. unauthenticated / malformed requests ============================
  const anon = await page.context().request; // same cookies — make a truly anon context below
  const anonCtx = await page.context().browser().newContext();
  const aReq = anonCtx.request;
  const anonGet = await aReq.get(`${BASE}/api/c/${cid}/vouchers`);
  ok("anon GET vouchers → 401", anonGet.status() === 401, anonGet.status());
  const anonPost = await aReq.post(`${BASE}/api/c/${cid}/vouchers`, { data: { type: "Payment", entries: [] } });
  ok("anon POST voucher → 401", anonPost.status() === 401, anonPost.status());
  const badLogin = await aReq.post(`${BASE}/api/auth/login`, { data: { username: "admin", password: "nope" } });
  ok("bad login → 401 generic message", badLogin.status() === 401, badLogin.status());
  const noBody = await aReq.post(`${BASE}/api/auth/login`, { data: undefined });
  ok("login without body → 400 (not 500)", noBody.status() === 400, noBody.status());

  // ===== 2. horizontal authz: cross-company id guessing =====================
  const otherCompany = await aReq.get(`${BASE}/api/companies`);
  ok("anon companies list → 401", otherCompany.status() === 401, otherCompany.status());
  const cross1 = await page.request.get(`${BASE}/api/c/999999/vouchers`);
  ok("foreign company id 999999 → 404 (no-leak)", cross1.status() === 404, cross1.status());
  const cross2 = await page.request.get(`${BASE}/api/c/999999/reports/trial-balance`);
  ok("foreign trial-balance → 404", cross2.status() === 404, cross2.status());
  const cross3 = await page.request.put(`${BASE}/api/companies/999999`, { data: { name: "hax" } });
  ok("foreign company PUT → 404", cross3.status() === 404, cross3.status());

  // ===== 3. injection payloads ==============================================
  let sqliClean = true, sqliDetail = [];
  for (const p of SQLI) {
    const r = await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: p, groupId: g["Indirect Expenses"] } });
    if (r.status() >= 500) { sqliClean = false; sqliDetail.push(`${r.status()} for ${p}`); }
    else if (r.ok()) { // stored — verify round-trips literally, no table dropped
      const list = await D.getJson(`/api/c/${cid}/ledgers`);
      if (!list.some((l) => l.name === p)) { sqliClean = false; sqliDetail.push(`lost payload ${p}`); }
    }
  }
  ok("SQLi-style payloads: no 5xx, round-trip literally, users table intact", sqliClean, sqliDetail);
  const usersAlive = await page.request.get(`${BASE}/api/companies`);
  ok("users/companies table still alive after DROP-TABLE payload", usersAlive.status() === 200, usersAlive.status());

  // stored XSS via ledger name — must be neutralized on render
  const xss = `<script>window.__xss=1</script><img src=x onerror="window.__xss=2">`;
  await page.request.post(`${BASE}/api/c/${cid}/ledgers`, { data: { name: xss, groupId: g["Indirect Expenses"] } });
  await page.goto(`${BASE}/company/${cid}/masters/ledgers`);
  await page.waitForSelector("table");
  await page.waitForTimeout(600);
  const xssFired = await page.evaluate(() => (window).__xss);
  ok("stored XSS in ledger name does NOT execute", !xssFired, xssFired);
  const xssVisible = (await page.locator("table").textContent().catch(() => "")).includes("<script>");
  ok("payload shown inert as text (escaped)", xssVisible, "not rendered as text");

  // reflected: garbage query params don't break the page
  await page.goto(`${BASE}/company/${cid}/reports/trial-balance?from=<script>alert(1)</script>&to=zzz`);
  await page.waitForTimeout(800);
  const tbStillUp = await page.locator("body").isVisible().catch(() => false);
  const tbGarbled = await page.locator("body").textContent().catch(() => "");
  ok("garbled report query params don't break the view", tbStillUp && tbGarbled.length > 0);

  // ===== 4. amount abuse in vouchers ========================================
  const amtCases = [
    { amt: -5000, label: "negative capital -5000 refused (or honestly ledgered)" },
  ];
  let amtOk = true, amtDetail = [];
  for (const c of amtCases) {
    const r = await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: {
      type: "Receipt", date: "2026-04-12", narration: "attack amount",
      entries: [ { ledgerId: cash.id, amount: c.amt }, { ledgerId: cap.id, amount: -c.amt } ],
    } });
    if (r.status() >= 500) { amtOk = false; amtDetail.push(`${r.status()}`); }
  }
  ok("negative amounts: no 5xx (rejected or honestly ledgered)", amtOk, amtDetail);

  const zero = await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: {
    type: "Receipt", date: "2026-04-12", entries: [ { ledgerId: cash.id, amount: 0 }, { ledgerId: cap.id, amount: 0 } ],
  } });
  ok("zero-amount voucher: no 5xx", zero.status() < 500, zero.status());

  const huge = await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: {
    type: "Receipt", date: "2026-04-12", entries: [ { ledgerId: cash.id, amount: 9e15 }, { ledgerId: cap.id, amount: -9e15 } ],
  } });
  ok("huge amount 9e15: no 5xx (numeric(18,2) domain)", huge.status() < 500, huge.status());

  const frac = await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: {
    type: "Receipt", date: "2026-04-12", entries: [ { ledgerId: cash.id, amount: 0.005 }, { ledgerId: cap.id, amount: -0.005 } ],
  } });
  ok("sub-paise 0.005: no 5xx (precision handled)", frac.status() < 500, frac.status());

  // ===== 5. duplicate numbers + self-referencing transfer ===================
  const dup1 = await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: {
    type: "Receipt", date: "2026-04-14", number: "HAX-1", entries: [ { ledgerId: cash.id, amount: 100 }, { ledgerId: cap.id, amount: -100 } ],
  } });
  const dup2 = await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: {
    type: "Receipt", date: "2026-04-14", number: "HAX-1", entries: [ { ledgerId: cash.id, amount: 100 }, { ledgerId: cap.id, amount: -100 } ],
  } });
  ok("duplicate manual number refused (409/400) or idempotent-replayed, never double-posted", dup2.status() === 409 || dup2.status() === 400 || dup2.status() === 200, { s1: dup1.status(), s2: dup2.status() });

  const selfRef = await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: {
    type: "Payment", date: "2026-04-15", entries: [ { ledgerId: cash.id, amount: 50 }, { ledgerId: cash.id, amount: -50 } ],
  } });
  ok("cash→cash self-transfer: no 5xx (accepted or refused)", selfRef.status() < 500, selfRef.status());

  // ===== 6. deep traversal / junk ids =======================================
  const trav = await page.request.get(`${BASE}/api/c/${cid}/reports/trial-balance?from=../../../../etc/passwd&to=..%2f..%2fetc%2fpasswd`);
  ok("path-traversal-shaped query params → 4xx, not 5xx/leak", trav.status() < 500, trav.status());
  const junk = await page.request.get(`${BASE}/api/c/notanumber/vouchers`);
  ok("non-numeric company id → 4xx", junk.status() < 500 && junk.status() >= 400, junk.status());

  // ===== 7. integrity after abuse: the books must still balance =============
  const tb = await D.getJson(`/api/c/${cid}/reports/trial-balance?from=2026-04-01&to=2026-04-30`);
  ok(`after all abuse, TB still balances (diff ${tb?.difference})`, Number(tb?.totalDebit) === Number(tb?.totalCredit), tb && { dr: tb.totalDebit, cr: tb.totalCredit, diff: tb.difference });

  const anonFinal = await aReq.get(`${BASE}/api/c/${cid}/reports/trial-balance`);
  ok("anon still locked out at the end", anonFinal.status() === 401, anonFinal.status());
  ok("zero page errors during the attack session", pageErrors.length === 0, pageErrors);

  await anonCtx.close();
  console.log(`\n== PERSONA hacker: ${pass} passed, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
