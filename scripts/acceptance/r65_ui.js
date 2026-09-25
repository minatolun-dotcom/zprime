// R-65 browser acceptance: restore the F-key hint chips on the Gateway's
// Vouchers pane (operator: removing them in R-64 D-3 hurt discoverability —
// the hints ARE the menu) + make Day Book's voucher map/rail data-driven
// (the hand list had drifted: F10 Manufacturing Journal was missing there).
//  A) V pane shows F4 Contra … F10, Alt+F5 … Ctrl+F7 chips again;
//  B) every hint still fires (keyboard unchanged);
//  C) Day Book rail now includes F10 (was missing since v1.0) and follows
//     the shortcut-class order; F10 opens Manufacturing Journal;
//  D) no page errors.
// Prereqs: compose stack at localhost:3000 (admin/admin123) with the built
// client (docker compose build app && docker compose up -d app).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 200)}`); }
};

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  await D.createCompany({ name: `R65 Hints ${Date.now().toString(36)}`, gstin: "27R65HINTU4K9", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created", !!cid, cid);
  const gw = `${D.BASE}/company/${cid}`;

  const gateway = async () => {
    await page.goto(gw, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=Gateway of zprime", { timeout: 15000 });
    await D.sleep(250);
  };

  // ---- A) hints visible on the Vouchers pane ----
  await gateway();
  await page.keyboard.press("V");
  await D.sleep(350);
  const pane = page.locator('[data-testid="gateway-contents"]');
  const rows = (await pane.locator("a").allTextContents()).map((t) => t.trim());
  ok("V pane row text carries the hint (F4Contra first)", rows[0]?.startsWith("F4") && rows[0]?.includes("Contra"), rows[0]);
  const chips = (await pane.locator(".fkey-chip").allTextContents()).map((t) => t.trim());
  const expect = ["F4", "F5", "F6", "F7", "F8", "F9", "F10", "Alt+F5", "Alt+F6", "Alt+F7", "Alt+F8", "Alt+F9", "Ctrl+F7", "W"];
  ok("all 13 F-key/chord chips + W visible on the pane", expect.every((k) => chips.includes(k)), chips);

  // ---- B) the hints still fire ----
  const fires = [
    ["F4", "/voucher/", "F4 chip target works (Contra)"],
    ["F10", "/voucher/", "F10 works from the Gateway"],
    ["Control+F7", "/voucher/", "Ctrl+F7 works (Physical Stock)"],
  ];
  for (const [k, frag, name] of fires) {
    await gateway();
    await page.keyboard.press(k);
    await page.waitForURL("**/voucher/**", { timeout: 8000 });
    ok(name, page.url().includes(frag), page.url());
    await page.goBack();
    await D.sleep(400);
  }

  // ---- C) Day Book: data-driven rail with F10 + shortcut-class order ----
  await page.goto(`${gw}/daybook`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="date"]', { timeout: 10000 });
  await D.sleep(300);
  const railKeys = await page.evaluate(() =>
    Array.from(document.querySelectorAll("aside .fkey-chip")).map((e) => e.textContent.trim())
  );
  ok("Day Book rail includes F10 (was missing since v1.0)", railKeys.includes("F10"), railKeys);
  ok("Day Book rail carries the full 13-key vocabulary", ["F4", "F5", "F6", "F7", "F8", "F9", "F10", "Alt+F5", "Alt+F6", "Alt+F7", "Alt+F8", "Alt+F9", "Ctrl+F7"].every((k) => railKeys.includes(k)), railKeys);
  ok("Day Book rail follows the shortcut-class order (F4…F10, then Alt+, then Ctrl+F7)",
    JSON.stringify(railKeys) === JSON.stringify(["F4", "F5", "F6", "F7", "F8", "F9", "F10", "Alt+F5", "Alt+F6", "Alt+F7", "Alt+F8", "Alt+F9", "Ctrl+F7"]), railKeys);
  ok("Day Book rail labels match types (F10 → Manufacturing Journal)", (await page.locator('aside .fkey-item:has-text("F10")').first().textContent())?.includes("Manufacturing Journal"));

  await page.keyboard.press("F10");
  await page.waitForURL("**/voucher/**", { timeout: 8000 });
  ok("F10 opens Manufacturing Journal from the Day Book", page.url().includes("/voucher/"), page.url());

  ok("no page errors during R-65 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-65 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
