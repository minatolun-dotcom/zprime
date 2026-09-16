// R-07 browser acceptance: opening balances in reports through the REAL UI.
// 1) a debtor's master opening balance appears in Bills Receivable as the
//    synthetic "Opening Balance" bill (F-07-1) — the report is not blind to
//    migrated books anymore;
// 2) a creditor's Cr opening appears in Bills Payable with its sign;
// 3) balanced ledger openings keep the Balance Sheet clean (no difference
//    banner) — and adding a Stock-in-Hand SUB-GROUP ledger with an unfunded
//    opening does NOT double-count stock or trip the banner (F-07-3;
//    pre-fix the banner would read -1,000).
// Prereqs: fresh compose stack at localhost:3000 (admin/admin123).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 160)}`); }
};

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  await D.createCompany({ name: "R07 UI Openings", gstin: "27R07UI000A1B2", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  // masters with openings (API, cookie-authenticated)
  const post = async (path, body) => {
    const r = await page.request.post(`${D.BASE}/api/c/${cid}${path}`, { data: body });
    return r.status();
  };
  const get = async (path) => (await page.request.get(`${D.BASE}/api/c/${cid}${path}`)).json();

  const groups = await get("/groups");
  const g = Object.fromEntries(groups.map((x) => [x.name, x.id]));
  ok("debtor with opening created", (await post("/ledgers", { name: "R07 UI Debtor", groupId: g["Sundry Debtors"], billWise: true, openingBalance: "50000" })) === 200);
  ok("creditor with opening created", (await post("/ledgers", { name: "R07 UI Creditor", groupId: g["Sundry Creditors"], billWise: true, openingBalance: "-20000" })) === 200);
  ok("balancing capital created", (await post("/ledgers", { name: "R07 UI Capital", groupId: g["Capital Account"], openingBalance: "-30000" })) === 200);

  // ---- F-07-1: Bills Receivable shows the opening as a bill ----
  await page.goto(`${D.BASE}/company/${cid}/reports/receivables`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=R07 UI Debtor", { timeout: 15000 });
  let bodyTxt = await page.textContent("body");
  ok("AR lists debtor party", bodyTxt.includes("R07 UI Debtor"), null);
  ok("AR total includes the 50,000 opening", bodyTxt.includes("50,000"), null);
  await page.click("button:has-text('R07 UI Debtor')"); // expand the party
  await page.waitForSelector("text=Opening Balance", { timeout: 10000 });
  ok("AR shows the synthetic 'Opening Balance' bill row", true, null);

  // ---- F-07-1: Bills Payable shows the creditor's Cr opening ----
  await page.goto(`${D.BASE}/company/${cid}/reports/payables`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=R07 UI Creditor", { timeout: 15000 });
  bodyTxt = await page.textContent("body");
  ok("AP lists creditor with -20,000 opening", bodyTxt.includes("R07 UI Creditor") && bodyTxt.includes("-20,000"), null);

  // ---- BS stays clean with balanced openings ----
  await page.goto(`${D.BASE}/company/${cid}/reports/balance-sheet`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  bodyTxt = await page.textContent("body");
  ok("BS: no difference banner with balanced openings", !bodyTxt.includes("Difference in books"), null);
  ok("BS: debtors opening shown as asset", bodyTxt.includes("50,000"), null);

  // ---- F-07-3: SIH sub-group ledger must not double-count stock ----
  const r = await page.request.post(`${D.BASE}/api/c/${cid}/groups`, { data: { name: "Finished Goods", parentId: g["Stock-in-Hand"] } });
  const fg = await r.json();
  await post("/ledgers", { name: "R07 UI FG Ledger", groupId: fg.id, openingBalance: "1000" });
  await page.goto(`${D.BASE}/company/${cid}/reports/balance-sheet`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  bodyTxt = await page.textContent("body");
  ok("BS: still no difference banner after unfunded sub-group ledger (F-07-3)", !bodyTxt.includes("Difference in books"), bodyTxt.includes("Difference in books") ? bodyTxt.match(/Difference in books[^\n]*/)?.[0] : null);

  ok("no page errors during R-07 UI flow", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-07 UI scenario: ${pass} ok, ${fail} failed ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
