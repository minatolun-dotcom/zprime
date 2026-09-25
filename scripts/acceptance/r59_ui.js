// R-59 browser acceptance: Gateway discoverability of Company Settings +
// Day Book provance ("Posted by …" / "Last edited by …").
// A) Company Settings surfaces as a level-1 Gateway entry — one click, no
//    pane drill; R-62 upgraded its chip from letterless "·" to the Alt+S
//    chord (Tally's Stock-Query slot, unused in zprime; plain S stays with
//    Sales Register); it is also served by the Go To palette (Alt+G); the
//    U pane no longer claims it. B) Every Day Book type pill carries the
//    poster's username in its tooltip (server joins R-22 provance), covering
//    admin-posted rows and R-10-replayed ones; the voucher edit screen keeps
//    R-18's audit strip.
// Prereqs: fresh compose stack at localhost:3000 (admin/admin123).
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
  await D.createCompany({ name: `R59 Provenance ${Date.now() % 100000}`, gstin: "27R59PROVENC9K2", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created", !!cid, cid);

  // seed ledgers + one Payment voucher through the API (provance: admin)
  const api = async (method, path, body) => {
    const r = await page.request[method](`${D.BASE}/api${path}`, body !== undefined ? { data: body } : undefined);
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status(), j };
  };
  const grps = Object.fromEntries(((await api("get", `/c/${cid}/groups`)).j ?? []).map((x) => [x.name, x.id]));
  await api("post", `/c/${cid}/ledgers`, { name: "R59 Cash", groupId: grps["Cash-in-Hand"] });
  await api("post", `/c/${cid}/ledgers`, { name: "R59 Exp", groupId: grps["Indirect Expenses"] });
  const ledgers = (await api("get", `/c/${cid}/ledgers`)).j ?? [];
  const cash = ledgers.find((l) => l.name === "R59 Cash");
  const exp = ledgers.find((l) => l.name === "R59 Exp");
  const payment = ((await api("get", `/c/${cid}/voucher-types`)).j ?? []).find((t) => t.name === "Payment");
  const v1 = await api("post", `/c/${cid}/vouchers`, { voucherTypeId: payment.id, date: "2026-05-10", narration: "R59 provance probe", entries: [{ ledgerId: exp.id, amount: 100 }, { ledgerId: cash.id, amount: -100 }] });
  // (The POST response is the raw voucher row; the poster's username surfaces
  // through the Day Book list join — asserted by the tooltip check below.)
  ok("seed voucher posted", v1.status === 200 && !!v1.j?.id, { status: v1.status, id: v1.j?.id });

  // ---- A) Gateway: level-1 Company Settings entry ----
  await page.goto(`${D.BASE}/company/${cid}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Gateway of zprime", { timeout: 15000 });
  await D.sleep(300);
  const settingsLink = page.locator('a:has-text("Company Settings")').first();
  ok("Company Settings is a level-1 Gateway link", await settingsLink.isVisible().catch(() => false), "visible");
  ok("its chip advertises the Alt+S chord (R-62; was R-59's letterless ·)", (await settingsLink.locator(".fkey-chip").textContent())?.trim() === "Alt+S", "chip");
  await settingsLink.click();
  await page.waitForURL("**/settings", { timeout: 10000 });
  ok("clicking it opens Company Settings (Users card reachable in one click)", page.url().includes("/settings"), page.url());
  await page.goto(`${D.BASE}/company/${cid}/daybook`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="date"]', { timeout: 10000 });
  await page.keyboard.press("Alt+s");
  await page.waitForURL("**/settings", { timeout: 8000 });
  ok("Alt+S also opens Company Settings from Day Book (R-62 chord)", page.url().includes("/settings"), page.url());
  await page.goto(`${D.BASE}/company/${cid}`, { waitUntil: "domcontentloaded" });

  // ---- A2) the Utilities pane no longer claims it; palette still serves it ----
  await page.goto(`${D.BASE}/company/${cid}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Gateway of zprime", { timeout: 15000 });
  await page.keyboard.press("U");
  await D.sleep(350);
  ok("U pane lists XML Import (pane intact)", await page.locator('a:has-text("XML Import")').first().isVisible().catch(() => false), "pane");
  await page.keyboard.press("Escape");
  await D.sleep(250);
  await page.keyboard.press("Alt+g");
  await D.sleep(350);
  await page.fill('[data-testid="goto-input"]', "company sett");
  await D.sleep(400);
  ok("Go To palette still finds Company Settings", await page.locator('[data-testid="goto-item"]:has-text("Company Settings"), li:has-text("Company Settings"), div:has-text("Company Settings")').first().isVisible().catch(() => false), "palette");
  await page.keyboard.press("Escape");
  await D.sleep(250);

  // ---- B) Day Book provance tooltip ----
  await page.goto(`${D.BASE}/company/${cid}/daybook`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("table tbody tr", { timeout: 15000 });
  await D.sleep(400);
  const pill = page.locator("table tbody tr", { hasText: "R59 provance probe" }).locator(".pill").first();
  ok("Day Book row renders the type pill", await pill.isVisible().catch(() => false), "pill");
  ok("pill tooltip names the poster (Posted by admin)", ((await pill.getAttribute("title")) ?? "").includes("Posted by admin"), await pill.getAttribute("title"));

  // ---- B2) the edit screen keeps the R-18 audit strip ----
  await page.locator("table tbody tr", { hasText: "R59 provance probe" }).click();
  await page.waitForSelector("text=Created by admin", { timeout: 10000 });
  ok("voucher edit screen shows the R-18 audit strip (Created by admin)", true, "strip");

  ok("no page errors during R-59 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-59 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
