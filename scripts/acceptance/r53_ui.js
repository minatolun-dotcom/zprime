// R-53 browser acceptance: the TallyPrime-style Gateway through the REAL UI.
// 1) layout: company panel left, general headings middle (Vouchers/Day Book/
//    Create/Alter/Reports/Utilities — headings only, nothing expanded),
//    contents pane right;
// 2) hot letters: K fires Day Book from anywhere, R opens Reports contents,
//    B fires Balance Sheet from inside Reports, C opens Create (masters);
// 3) item letters win over heading letters (R then T -> Trial Balance);
// 4) globally unique letters fire directly from the bare Gateway (R-53c:
//    P = Purchase Register, F = Profit & Loss, X = XML Import, G = Groups —
//    same option under Create and Alter counts once, so G fires too;
//    v1.50.1: W = Process Payroll, 2 = Stock Groups, 8 = TCS Report — every
//    option except Company Settings carries a shortcut now);
// 5) Esc closes the contents pane back to the neutral hint;
// 6) all 31 item labels present as links + Day Book as direct heading link;
// 7) F5/F8/F9 chrome buttons present; F2 is NOT on the Gateway (F2 = date);
// 8) letter uniqueness is GLOBAL (R-53c rule 1): no letter or digit is
//    shared between any heading and any pane item, or between two panes;
// 9) Esc on a master page (Alter → Ledgers) closes the slide-over first,
//    then goes history-back to the Gateway (v1.50.1: the editor no longer
//    claims Esc while closed);
// 10) the Gateway is the LAST STOP: browser Back from the Gateway never
//    reaches the company-select page (Logout / Switch Company only), the
//    ← arrow does not render on the Gateway but does on Day Book;
// 11) no page errors during the scenario.
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
  // Unique per run: section 12 clicks the card by name on the select page —
  // a stale duplicate on a reused volume would navigate to the wrong cid.
  const coName = `R53 GW ${Date.now().toString(36)}`;
  await D.createCompany({ name: coName, gstin: "27R53GWUI0A1B2", stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);
  const gw = `${D.BASE}/company/${cid}`;

  const gateway = async () => {
    await page.goto(gw, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=Gateway of zprime", { timeout: 15000 });
    await D.sleep(250);
  };
  // The right-hand contents pane (testid-anchored).
  const pane = () => page.locator('[data-testid="gateway-contents"]');
  const paneHead = async () =>
    (await pane().locator(".text-indigo-600").first().textContent().catch(() => ""))?.trim() ?? "";

  // ---- 1) layout: three zones render ----
  ok("company panel shows company name", await page.locator("aside .text-base.font-semibold").isVisible().catch(() => false));
  ok("section list shows Gateway of zprime", await page.locator("text=Gateway of zprime").first().isVisible().catch(() => false));

  // ---- 2) hot letters ----
  await gateway();
  await page.keyboard.press("K");
  await D.sleep(600);
  ok("K fires Day Book from anywhere", page.url().includes("/daybook"), page.url());

  await gateway();
  await page.keyboard.press("R");
  await D.sleep(300);
  ok("R opens Reports contents", (await paneHead()) === "Reports", await paneHead());
  await page.keyboard.press("B");
  await D.sleep(600);
  ok("B fires Balance Sheet from Reports", page.url().includes("balance-sheet"), page.url());

  // ---- 3) item letters win over section letters ----
  await gateway();
  await page.keyboard.press("R");
  await D.sleep(300);
  await page.keyboard.press("T");
  await D.sleep(600);
  ok("R then T fires Trial Balance (item letter precedence)", page.url().includes("trial-balance"), page.url());

  // ---- 4) globally unique letters fire directly from the bare Gateway ----
  // (R-53c: letters no longer collide across sections, so a single press
  // navigates; P = Purchase Register, F = ProFit & Loss, X = XML Import,
  // G = Groups — same shared masters item under Create AND Alter is one
  // option, not a clash.)
  await gateway();
  await page.keyboard.press("P");
  await D.sleep(600);
  ok("P fires Purchase Register from anywhere", page.url().includes("register-purchase"), page.url());

  await gateway();
  await page.keyboard.press("F");
  await D.sleep(600);
  ok("F fires Profit & Loss from anywhere", page.url().includes("profit-loss"), page.url());

  await gateway();
  await page.keyboard.press("X");
  await D.sleep(600);
  ok("X fires XML Import from anywhere", page.url().includes("/import"), page.url());

  await gateway();
  await page.keyboard.press("G");
  await D.sleep(600);
  ok("G fires Groups (Create/Alter share the option, deduped by target)", page.url().includes("/masters/groups"), page.url());

  await gateway();
  await page.keyboard.press("W");
  await D.sleep(600);
  ok("W fires Process Payroll from anywhere", page.url().includes("/payroll"), page.url());

  await gateway();
  await page.keyboard.press("2");
  await D.sleep(600);
  ok("2 fires Stock Groups (digit fallback slot)", page.url().includes("/masters/stock-groups"), page.url());

  await gateway();
  await page.keyboard.press("8");
  await D.sleep(600);
  ok("8 fires TCS Report (digit fallback slot)", page.url().includes("/reports/tcs"), page.url());

  // ---- 5) Esc closes the pane ----
  // (Section 4 ends with direct navigations, so open a pane deliberately.)
  await gateway();
  await page.keyboard.press("R");
  await D.sleep(300);
  await page.keyboard.press("Escape");
  await D.sleep(300);
  ok("Esc reveals the neutral hint pane", await page.locator("text=Select a menu").isVisible().catch(() => false));

  // ---- 6) every item label present as a real link ----
  // R-53b layout: masters live under Create (and Alter); Day Book is a direct
  // heading link in the middle column; headings-only until a letter opens a pane.
  const labels = [
    "Ledgers", "Groups", "Stock Items", "Units of Measure", "Stock Groups",
    "Godowns / Locations", "Voucher Types", "TDS Sections", "TCS Sections",
    "Employees & Payroll", "Process Payroll",
    "Balance Sheet", "Profit & Loss A/c", "Trial Balance", "Cash / Bank Book",
    "Sales Register", "Purchase Register", "Stock Summary", "Receivables (B/R)",
    "Payables (B/P)", "GSTR-1", "GSTR-3B", "GSTR-9 (Annual)", "TDS Report",
    "TCS Report", "Salary Register", "Cheque Register",
    "XML Import", "Cheque Printing", "Audit Trail", "Company Settings",
  ];
  const missing = [];
  const owners = { "Ledgers": "C", "Groups": "C", "Stock Items": "C", "Units of Measure": "C", "Stock Groups": "C", "Godowns / Locations": "C", "Voucher Types": "C", "TDS Sections": "C", "TCS Sections": "C", "Employees & Payroll": "C", "Process Payroll": "V", "Balance Sheet": "R", "Profit & Loss A/c": "R", "Trial Balance": "R", "Cash / Bank Book": "R", "Sales Register": "R", "Purchase Register": "R", "Stock Summary": "R", "Receivables (B/R)": "R", "Payables (B/P)": "R", "GSTR-1": "R", "GSTR-3B": "R", "GSTR-9 (Annual)": "R", "TDS Report": "R", "TCS Report": "R", "Salary Register": "R", "Cheque Register": "R", "XML Import": "U", "Cheque Printing": "U", "Audit Trail": "U", "Company Settings": "U" };
  for (const label of labels) {
    await gateway();
    // open the heading that owns the label, then assert the link exists
    await page.keyboard.press(owners[label][0]);
    await D.sleep(220);
    const link = page.locator(`a:has-text("${label}")`).first();
    if (!(await link.isVisible().catch(() => false))) missing.push(label);
  }
  ok("all 31 item labels present as links", missing.length === 0, missing);

  // Day Book is a direct heading link (always visible, middle column)
  await gateway();
  ok("Day Book direct heading link present", await page.locator('a:has-text("Day Book")').first().isVisible().catch(() => false));

  // ---- 7) fkey chrome: F5/F8/F9 present, F2 absent (F2 = date/period, Tally) ----
  await gateway();
  for (const k of ["F5", "F8", "F9"]) {
    // .first(): the data-driven rail (R-54) also carries Alt+F5 etc., which
    // substring-match "F5" — multiple hits would strict-violate isVisible().
    ok(`fkey rail has ${k}`, await page.locator(`aside button:has-text("${k}")`).first().isVisible().catch(() => false));
  }
  ok("Gateway rail has no F2 (F2 belongs to date/period)", !(await page.locator('aside button:has-text("F2")').isVisible().catch(() => false)));

  // ---- 8) hot-letter GLOBAL uniqueness (R-53c rule 1) ----
  // Within each surface the chips must be unique, and no item letter may
  // equal a heading letter or another pane's letters. (Create and Alter
  // render the same shared masters list — same options, same letters —
  // so only Create is sampled; its letters are checked against the rest.)
  await gateway();
  const uniq = (a) => [...new Set(a)];
  const headingLetters = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll(".grid > div:nth-child(2) .fkey-chip")) {
      const t = el.textContent.trim();
      if (t.length === 1) out.push(t.toUpperCase());
    }
    return out;
  });
  ok("heading letters unique", uniq(headingLetters).length === headingLetters.length, headingLetters);
  const panes = ["V", "C", "R", "U"];
  const paneLetters = {};
  const cross = [];
  for (const p of panes) {
    await page.keyboard.press(p);
    await D.sleep(300);
    paneLetters[p] = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("[data-testid='gateway-contents'] .fkey-chip")) {
        const t = el.textContent.trim();
        if (t.length === 1) out.push(t.toUpperCase());
      }
      return out;
    });
    ok(`pane ${p} letters unique within pane`, uniq(paneLetters[p]).length === paneLetters[p].length, paneLetters[p]);
    for (const l of paneLetters[p]) {
      if (headingLetters.includes(l)) cross.push(`${l}: pane ${p} vs heading`);
      for (const q of panes.slice(0, panes.indexOf(p))) {
        if (paneLetters[q].includes(l)) cross.push(`${l}: panes ${p} and ${q}`);
      }
    }
    await page.keyboard.press("Escape");
    await D.sleep(200);
  }
  ok("no letter shared between any two surfaces (global uniqueness)", cross.length === 0, cross);

  // ---- 9) Esc origin discipline: daybook -> voucher -> Esc -> daybook ----
  await gateway();
  await page.keyboard.press("K"); await D.sleep(500);
  await page.keyboard.press("F8"); await D.sleep(600);
  ok("F8 opens Sales voucher from Day Book", page.url().includes("/voucher/"), page.url());
  await page.keyboard.press("Escape"); await D.sleep(500);
  ok("Esc from voucher returns to Day Book (where we came from)", page.url().includes("/daybook"), page.url());
  await page.keyboard.press("Escape"); await D.sleep(500);
  ok("Esc again returns to Gateway", page.url().endsWith(`/company/${cid}`), page.url());

  // ---- 10) F2 on Day Book focuses the date input (period change) ----
  await page.goto(`${D.BASE}/company/${cid}/daybook`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="date"]');
  await page.locator("table tbody tr").first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  await page.keyboard.press("F2"); await D.sleep(250);
  const f2Focus = await page.evaluate(() => document.activeElement?.getAttribute("type") === "date");
  ok("F2 on Day Book focuses the date (period) input", f2Focus);

  // ---- 11) Esc on a master page: slide-over first, then history-back ----
  await gateway();
  await page.keyboard.press("C");
  await D.sleep(300);
  await page.locator('a:has-text("Ledgers")').first().click();
  await D.sleep(600);
  ok("C -> Ledgers master page open", page.url().includes("/masters/ledgers"), page.url());
  await page.locator("table tbody tr").first().click();
  await D.sleep(400);
  await page.keyboard.press("Escape");
  await D.sleep(300);
  ok("Esc closes the slide-over (still on the master page)",
    page.url().includes("/masters/ledgers") && !(await page.locator(".bg-black\\/30").isVisible().catch(() => false)), page.url());
  await page.keyboard.press("Escape");
  await D.sleep(500);
  ok("Esc again history-backs to the Gateway", new RegExp(`/company/${cid}$`).test(page.url()), page.url());

  // ---- 12) Gateway is the LAST STOP (history barrier) ----
  await page.goto(`${D.BASE}/companies`, { waitUntil: "domcontentloaded" });
  await D.sleep(500);
  await page.locator(`text=${coName}`).first().click();
  await page.waitForSelector("text=Gateway of zprime", { timeout: 15000 });
  await D.sleep(400);
  ok("opened company from the select page", new RegExp(`/company/${cid}$`).test(page.url()), page.url());
  await page.goBack();
  await D.sleep(600);
  ok("browser Back at the Gateway stays on the Gateway (no Companies)",
    new RegExp(`/company/${cid}$`).test(page.url()) && !page.url().includes("/companies"), page.url());
  ok("no back arrow on the Gateway header", !(await page.locator("header button[aria-label=Back]").isVisible().catch(() => false)));
  await page.keyboard.press("Escape");
  await D.sleep(400);
  ok("Esc at the bare Gateway does nothing", new RegExp(`/company/${cid}$`).test(page.url()), page.url());
  await page.goto(`${D.BASE}/company/${cid}/daybook`, { waitUntil: "domcontentloaded" });
  await D.sleep(500);
  ok("back arrow present on Day Book header", await page.locator("header button[aria-label=Back]").isVisible().catch(() => false));

  // ---- 13) Esc origin: Gateway -> voucher -> Esc -> Gateway; F2 inert here ----
  await gateway();
  await page.keyboard.press("F5");
  await D.sleep(600);
  ok("F5 on Gateway opens Payment voucher", page.url().includes("/voucher/"), page.url());
  await page.keyboard.press("Escape");
  await D.sleep(500);
  ok("Esc from Gateway-entered voucher returns to Gateway", new RegExp(`/company/${cid}$`).test(page.url()), page.url());
  await page.keyboard.press("F2");
  await D.sleep(300);
  ok("F2 on Gateway does nothing (F2 = date/period on entry screens)", new RegExp(`/company/${cid}$`).test(page.url()), page.url());

  ok("no page errors during R-53 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-53 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
