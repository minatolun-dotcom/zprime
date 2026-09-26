// R-72 browser acceptance: master editor save chords.
//  A) Ctrl+S saves the master editor (Create) — the browser's Save dialog must
//     never interrupt master editing (operator report: Ctrl+S "tries to save
//     the page");
//  B) Ctrl+A also saves (Tally's universal Accept chord, the voucher screen's
//     save key) — and the Alter button advertises Ctrl+A, not the phantom Ctrl+S;
//  C) native select-all stays intact OUTSIDE the editor (Ctrl+A is claimed only
//     while the slide-over is open);
//  D) chords submit through the form: native required-field validation still
//     blocks an incomplete master, and a server 409 (duplicate name) surfaces
//     in the editor;
//  E) Esc still closes the editor (existing contract).
// Prereqs: compose stack at localhost:3000 (admin/admin123).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 240)}`); }
};

const BASE = D.BASE.replace(/\/$/, "");

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  const stamp = Date.now().toString(36);
  await D.createCompany({
    name: `R72 Master Chords ${stamp}`, stateCode: "27",
    fyStart: "2026-04-01", booksBegin: "2026-04-01",
  });
  const cid = D.cid();
  ok("company created", !!cid, cid);

  await page.goto(`${BASE}/company/${cid}/masters/ledgers`);
  await page.waitForSelector('button:has-text("+ New")', { timeout: 8000 });

  const editorOpen = () => page.locator(".bg-black\\/30").isVisible().catch(() => false);
  const fillField = async (label, value) => {
    const field = page.locator("form label", { hasText: label }).first();
    await field.locator("input").first().fill(String(value));
  };
  // Group options carry \u00a0 tree-indent padding (Sundry Debtors is a nested
  // seeded group) — normalize whitespace when resolving the option's value.
  const selectByNormLabel = async (sel, want) => {
    for (let i = 0; i < 30; i++) {
      const val = await sel.evaluate((el, w) => {
        const norm = (s) => (s || "").replace(/[\s\u00a0]+/g, " ").trim();
        const opt = Array.from(el.options).find((o) => norm(o.textContent || "") === w);
        return opt ? opt.value : null;
      }, want).catch(() => null);
      if (val != null) return val;
      await D.sleep(200);
    }
    throw new Error(`select option not found: ${want}`);
  };

  // ---- A) Create via Ctrl+S (the reported-broken chord, now an alias) --------
  await page.click('button:has-text("+ New")');
  await page.waitForSelector("form");
  await fillField("Name *", `Chord Buyer ${stamp}`);
  const grpSel = page.locator("form label", { hasText: "Under Group" }).first().locator("select");
  await grpSel.selectOption(await selectByNormLabel(grpSel, "Sundry Debtors"));
  await page.keyboard.press("Control+s"); // focus is in the form; the browser Save dialog must NOT appear
  await D.sleep(600);
  const savedClosed = !(await editorOpen());
  const rowThere = await page.locator("tr", { hasText: `Chord Buyer ${stamp}` }).count();
  const noBanner = !(await page.locator(".bg-red-50").first().isVisible().catch(() => false));
  ok("Create: Ctrl+S saves the master editor (browser Save dialog suppressed, no error banner)",
     savedClosed && rowThere > 0 && noBanner, { savedClosed, rowThere, noBanner });

  // ---- B) Alter via Ctrl+A + truthful hint -----------------------------------
  await page.locator("tr", { hasText: `Chord Buyer ${stamp}` }).first().click();
  await page.waitForSelector("form");
  const btnText = (await page.locator("form button.btn-primary").first().textContent()) ?? "";
  ok("button hint advertises Ctrl+A (no phantom Ctrl+S on the Alter button)", btnText.includes("Alter (Ctrl+A)") && !btnText.includes("Ctrl+S"), btnText);
  await fillField("GSTIN", "27ABCDE1234F1Z5");
  await page.keyboard.press("Control+a"); // focus is in the GSTIN input — chord save, not select-all
  await D.sleep(600);
  ok("Alter: Ctrl+A saves the master editor (Tally's universal Accept chord)", !(await editorOpen()));
  await page.locator("tr", { hasText: `Chord Buyer ${stamp}` }).first().click();
  await page.waitForSelector("form");
  const gstinPersisted = await page.locator("form label", { hasText: "GSTIN" }).first().locator("input").inputValue();
  ok("altered GSTIN persisted through the chord save", gstinPersisted === "27ABCDE1234F1Z5", gstinPersisted);
  await page.keyboard.press("Escape");
  await D.sleep(400);

  // ---- C) native select-all outside the editor --------------------------------
  const search = page.locator('input[placeholder="Search…"]');
  await search.click();
  await page.keyboard.type("Chord");
  await page.keyboard.press("Control+a"); // NOT hijacked here — must select the typed text
  await page.keyboard.type("Buyer");
  const searchVal = await search.inputValue();
  ok("native select-all intact outside the editor (Ctrl+A selects text in the search box)",
     searchVal === "Buyer", searchVal);
  await search.fill("");
  await D.sleep(300);

  // ---- D1) chords submit through the form: required-field validation ----------
  await page.click('button:has-text("+ New")');
  await page.waitForSelector("form");
  await fillField("Name *", `No Group Co ${stamp}`);
  await page.keyboard.press("Control+a"); // Under Group is required — the editor must stay open
  await D.sleep(500);
  ok("Ctrl+A with a missing required field does NOT close the editor (native validation runs)",
     await editorOpen());

  // ---- E) Esc still closes (existing contract) ---------------------------------
  await page.keyboard.press("Escape");
  await D.sleep(400);
  ok("Esc still closes the editor (existing contract intact)", !(await editorOpen()));

  // ---- D2) server 409 (duplicate name) surfaces in the editor -------------------
  await page.click('button:has-text("+ New")');
  await page.waitForSelector("form");
  await fillField("Name *", `Dup Ledger ${stamp}`);
  await page.locator("form label", { hasText: "Under Group" }).first().locator("select").selectOption(await selectByNormLabel(grpSel, "Sundry Debtors"));
  await page.keyboard.press("Control+s");
  await D.sleep(600);
  ok("first Dup Ledger saved via Ctrl+S", !(await editorOpen()));
  await page.click('button:has-text("+ New")');
  await page.waitForSelector("form");
  await fillField("Name *", `Dup Ledger ${stamp}`);
  await page.locator("form label", { hasText: "Under Group" }).first().locator("select").selectOption(await selectByNormLabel(grpSel, "Sundry Debtors"));
  await page.keyboard.press("Control+a");
  await D.sleep(600);
  const stillOpen = await editorOpen();
  const bannerText = ((await page.locator(".bg-red-50").first().textContent().catch(() => "")) ?? "").trim();
  ok("server 409 (duplicate name) surfaces in the editor via Ctrl+A", stillOpen && /already exists/i.test(bannerText), { stillOpen, bannerText });
  await page.keyboard.press("Escape");

  ok("zero page errors across the R-72 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-72 RESULT: ${pass} passed, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
