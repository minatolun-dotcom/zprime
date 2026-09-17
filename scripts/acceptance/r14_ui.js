// R-14 browser acceptance: the TB out-of-balance health surface through the
// REAL UI.
// 1) clean books -> Gateway "Books Health" card shows "Trial Balance ✓
//    balanced" and the TB report page shows no difference banner;
// 2) an injected asymmetry (a Dr opening with no counter-entry — the exact
//    B-02-class operator mistake, and the only way books can go out of
//    balance since every posted voucher must balance) -> Gateway flips to
//    "Trial Balance ✗ out by 777.77" and the TB report page shows the amber
//    "Difference in books" banner;
// 3) a balancing counterpart opening (-777.77) restores the balanced state
//    everywhere — the surface tracks books state, it never lies constant.
// Masters/fixtures may use the API (r10_ui.js convention); assertions run
// against rendered DOM only.
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
  await D.createCompany({ name: "R14 UI Health", gstin: "27R14UIHE0A1B2", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  const gatewayUrl = `${D.BASE}/company/${cid}`;
  const tbUrl = `${D.BASE}/company/${cid}/reports/trial-balance`;

  // ---- 1) clean books: Gateway health card shows balanced ----
  await page.goto(gatewayUrl, { waitUntil: "domcontentloaded" });
  const balancedChip = page.locator("text=Trial Balance ✓ balanced").first();
  await balancedChip.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  ok("Gateway: clean books shows balanced", await balancedChip.isVisible().catch(() => false), "chip not rendered");

  // ---- 2) clean books: TB report page has no difference banner ----
  await page.goto(tbUrl, { waitUntil: "domcontentloaded" });
  await page.locator("table").first().waitFor({ state: "visible", timeout: 15000 });
  const bannerClean = page.locator("text=Difference in books").first();
  ok("TB report: no banner on clean books", !(await bannerClean.isVisible().catch(() => false)), "banner visible on clean books");

  // ---- 3) inject the asymmetry: Dr 777.77 opening with no counter-entry ----
  const get = async (path) => (await page.request.get(`${D.BASE}/api/c/${cid}${path}`)).json();
  const groups = await get("/groups");
  const g = Object.fromEntries(groups.map((x) => [x.name, x.id]));
  const rAsym = await page.request.post(`${D.BASE}/api/c/${cid}/ledgers`, {
    data: { name: "R14 Asymmetric", groupId: g["Indirect Expenses"], openingBalance: "777.77" },
  });
  ok("asymmetric opening ledger created", rAsym.status() === 200, await rAsym.text());

  // Gateway flips to out-of-balance (out by 777.77)
  await page.goto(gatewayUrl, { waitUntil: "domcontentloaded" });
  const outChip = page.locator("text=Trial Balance ✗ out by 777.77").first();
  await outChip.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  ok("Gateway: asymmetry shows out by 777.77", await outChip.isVisible().catch(() => false), "out chip not rendered");
  const viewLink = page.locator('a:has-text("view")').first();
  ok("Gateway: out-of-balance chip links to TB", await viewLink.isVisible().catch(() => false), "no view link");

  // TB report page shows the amber difference banner
  await page.goto(tbUrl, { waitUntil: "domcontentloaded" });
  await page.locator("table").first().waitFor({ state: "visible", timeout: 15000 });
  const banner = page.locator("text=Difference in books: 777.77").first();
  await banner.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  ok("TB report: banner shows Difference in books: 777.77", await banner.isVisible().catch(() => false), "banner not rendered");

  // ---- 4) balance it with the counterpart opening -> everything returns ----
  const rBal = await page.request.post(`${D.BASE}/api/c/${cid}/ledgers`, {
    data: { name: "R14 Balancing Capital", groupId: g["Capital Account"], openingBalance: "-777.77" },
  });
  ok("counterpart opening ledger created", rBal.status() === 200, await rBal.text());

  await page.goto(tbUrl, { waitUntil: "domcontentloaded" });
  await page.locator("table").first().waitFor({ state: "visible", timeout: 15000 });
  const bannerGone = page.locator("text=Difference in books").first();
  ok("TB report: banner gone after balancing opening", !(await bannerGone.isVisible().catch(() => false)), "banner still visible");

  await page.goto(gatewayUrl, { waitUntil: "domcontentloaded" });
  const balancedAgain = page.locator("text=Trial Balance ✓ balanced").first();
  await balancedAgain.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  ok("Gateway: balanced again after counterpart opening", await balancedAgain.isVisible().catch(() => false), "chip not restored");

  ok("no page errors during R-14 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-14 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
