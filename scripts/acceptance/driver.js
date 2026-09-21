#!/usr/bin/env node
/**
 * UI driver for the zprime acceptance test — an accountant's hands.
 * Types into forms, picks from type-aheads, presses real keyboard shortcuts.
 * Never uses the JSON API for business data except `setSalaryStructureApi`,
 * which exists ONLY because the app ships no salary-structure UI (finding
 * F-PAY-01): without it payroll cannot be exercised at all. That exception
 * is flagged in the acceptance report.
 *
 * Verified contracts this driver relies on:
 *  - VoucherScreen: entry amount > 0 = Debit, < 0 = Credit (number inputs)
 *  - Party A/c TypeAhead auto-inserts a party row at grid top (amount 0)
 *  - Ctrl+A saves; success navigates to /daybook; errors show .bg-red-50 banner
 *  - Day Book: F4/F5/F6/F7/F8/F9 + Alt+F5/F6/F7/F8/F9 + Ctrl+F7 open vouchers
 *  - Inventory grid: qty is signed in storage but the UI takes |qty| and
 *    applies STOCK_FLOW sign for the voucher type at save time
 *  - F-key legend = aside panel buttons (span.fkey-chip + label)
 */
const { chromium } = require("playwright-core");

const BASE = process.env.ZP_URL || "http://localhost:3000";
const CHROME = process.env.CHROME_PATH || `${process.env.HOME}/.local/bin/chromium`;
const SHOTS = "scripts/acceptance/shots";

const FINDINGS = [];
let page = null;

function record(ok, id, title, detail = "") {
  const line = `${ok ? "  ok  " : " FAIL"} ${id} ${title}`;
  console.log(line + (ok ? "" : `  :: ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 500)}`));
  if (!ok) FINDINGS.push({ id, title, detail: typeof detail === "string" ? detail.slice(0, 400) : JSON.stringify(detail).slice(0, 400) });
  return ok;
}
function summary() {
  console.log(`\n== ACCEPTANCE RESULT: ${FINDINGS.length === 0 ? "ALL CHECKS PASSED" : `${FINDINGS.length} FINDINGS`} ==`);
  FINDINGS.forEach((f) => console.log(` - [${f.id}] ${f.title} :: ${f.detail}`));
  return FINDINGS.length;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(name) {
  if (page) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {});
}

async function launch() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 950 } });
  page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  console.error("browser up");
  return api;
}
async function close() { if (page) await page.context().browser().close().catch(() => {}); }

function cid() {
  const m = page.url().match(/\/company\/(\d+)/);
  return m ? m[1] : null;
}

// ------------------------------------------------------------------ auth/company
async function login(user = "admin", pass = "admin123") {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="text"], input:not([type])', user);
  await page.fill('input[type="password"]', pass);
  await page.keyboard.press("Enter");
  await page.waitForURL("**/companies");
  await page.waitForSelector("text=Create Company");
}

async function createCompany(form) {
  await page.goto(`${BASE}/companies`);
  await page.click('button:has-text("Create Company")');
  const modal = page.locator("form").first();
  const inputs = modal.locator("input");
  await inputs.nth(0).fill(form.name);           // Company Name
  if (form.gstin) await inputs.nth(1).fill(form.gstin);
  if (form.stateCode) await modal.locator("select").first().selectOption(form.stateCode);
  // address(2) city(3) pincode(4) are optional; FY date(5), books date(6)
  if (form.fyStart) {
    await inputs.nth(5).fill(form.fyStart);
    await inputs.nth(6).fill(form.booksBegin || form.fyStart);
  }
  await modal.locator('button:has-text("Create")').last().click();
  await page.waitForSelector("text=Gateway", { timeout: 20000 });
  await sleep(400);
}

async function openCompany(name) {
  await page.goto(`${BASE}/companies`);
  await page.waitForSelector('button:has-text("Create Company")');
  await page.click(`div.cursor-pointer:has-text("${name}")`);
  await page.waitForSelector("text=Gateway");
  await sleep(500);
}

// ------------------------------------------------------------------ masters
/** Fill the MasterPage slide-over form by Field label. */
async function fillForm(fields) {
  for (const [label, value] of fields) {
    const field = page.locator("form label", { hasText: label }).first();
    const sel = field.locator("select");
    if ((await sel.count()) > 0) {
      const select = sel.first();
      if (typeof value === "string") {
        await select.selectOption({ label: value });
      } else if (value.label) {
        // Option labels may carry \u00a0 tree-indent padding — normalize when matching.
        // Options load async (react-query) — wait up to 5s for the option to appear.
        // Options load async (react-query) — poll up to 5s for the option to appear
        let val = null;
        for (let i = 0; i < 25 && val == null; i++) {
          val = await select.evaluate((el, want) => {
            const norm = (s) => (s || "").replace(/[\s\u00a0]+/g, " ").trim();
            const opt = Array.from(el.options).find((o) => norm(o.textContent) === want);
            return opt ? opt.value : null;
          }, value.label);
          if (val == null) await page.waitForTimeout(200);
        }
        if (val == null) {
          const actual = await select.evaluate((el) => Array.from(el.options).map((o) => o.textContent));
          throw new Error(`select option not found: "${value.label}" | actual: ${JSON.stringify(actual)}`);
        }
        await select.selectOption(val);
      } else {
        await select.selectOption(value);
      }
      continue;
    }
    const cb = field.locator('input[type="checkbox"]');
    if ((await cb.count()) > 0) {
      if (value !== (await cb.first().isChecked())) await cb.first().click();
      continue;
    }
    await field.locator("input").first().fill(String(value));
  }
}

async function createMaster(kind, fields) {
  await page.goto(`${BASE}/company/${cid()}/masters/${kind}`);
  await page.waitForSelector('button:has-text("+ New")');
  await page.click('button:has-text("+ New")');
  await fillForm(fields);
  await page.locator('form button:has-text("Create")').click();
  await sleep(350);
  const err = page.locator(".bg-red-50").first();
  if (await err.isVisible().catch(() => false)) {
    throw new Error(`Master create failed on ${kind}: ${await err.textContent()}`);
  }
}

async function listMaster(kind) {
  await page.goto(`${BASE}/company/${cid()}/masters/${kind}`);
  await page.waitForSelector("table");
  return page.$$eval("table tbody tr", (trs) => trs.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.innerText.trim())));
}

/**
 * Tool-assisted exception (see header): assign a salary structure through the
 * JSON API because the app has no UI for it. Uses the page's own cookies.
 */
async function setSalaryStructureApi(employees, lines /* [[headName, amount]] */) {
  const c = cid();
  const emps = await (await page.request.get(`${BASE}/api/c/${c}/employees`)).json();
  const heads = await (await page.request.get(`${BASE}/api/c/${c}/pay-heads`)).json();
  for (const name of employees) {
    const emp = emps.find((e) => e.name === name);
    if (!emp) throw new Error(`employee not found: ${name}`);
    const payload = lines.map(([hn, amt]) => {
      const h = heads.find((x) => x.name === hn);
      if (!h) throw new Error(`pay head not found: ${hn}`);
      return { headId: h.id, monthlyAmount: amt };
    });
    const res = await page.request.put(`${BASE}/api/c/${c}/salary-structure/${emp.id}`, { data: { lines: payload } });
    if (!res.ok()) throw new Error(`salary structure failed for ${name}: ${res.status()} ${await res.text()}`);
  }
}

// ------------------------------------------------------------------ vouchers
const OPEN_KEY = {
  Contra: "F4", Payment: "F5", Receipt: "F6", Journal: "F7", Sales: "F8", Purchase: "F9",
  "Credit Note": "Alt+F6", "Debit Note": "Alt+F5", "Stock Journal": "Alt+F7",
  "Delivery Note": "Alt+F8", "Receipt Note": "Alt+F9", "Physical Stock": "Control+F7",
};

/** Open a new-voucher screen via the Day Book F-key hotkey (real keyboard).
 * R-34: every advertised chord now fires — no more button-click workaround
 * (the former "App quirk" CLICK_OPEN map is gone; suites press real keys). */
async function openVoucher(type) {
  const fkey = OPEN_KEY[type];
  if (!fkey) throw new Error(`no hotkey mapped for ${type}`);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`${BASE}/company/${cid()}/daybook`);
    await page.waitForSelector('input[type="date"]');
    await page.keyboard.press(fkey);
    try {
      await page.waitForSelector("text=Ledger Entries", { timeout: 4000 });
      await sleep(250);
      return;
    } catch { /* hotkey race — retry from a fresh Day Book */ }
  }
  throw new Error(`could not open ${type} voucher (hotkey ${fkey})`);
}

/** Pick an option in a TypeAhead by typing + Enter; verifies the pick landed. */
async function pickAhead(locator, text) {
  await locator.click();
  await locator.fill("");
  await page.keyboard.type(text, { delay: 12 });
  await sleep(280);
  await page.keyboard.press("Enter");
  await sleep(150);
  const val = await locator.inputValue().catch(() => "");
  if (!val || !val.toLowerCase().includes(text.split(" ")[0].toLowerCase())) {
    throw new Error(`TypeAhead pick failed: wanted "${text}", got "${val}"`);
  }
}

const PARTY_VOUCHERS = new Set(["Sales", "Purchase", "Credit Note", "Debit Note"]);

/**
 * Enter a voucher via the UI.
 * v = {
 *   type, date?, reference?, refDate?, narration?, party?,
 *   lockNumber?: "12",                 // type a manual voucher number
 *   lines: [{ledger, dr?, cr?, billRef?}],   // dr XOR cr; EXCLUDES the party row
 *   items: [{item, qty, rate, godown?, kind?}],
 *   clickApplyGst?: true, clickApplyTds?: true,
 *   expectError?: true, id?: string,   // expect the save to be rejected
 * }
 * Sign convention: dr/cr fields map to positive/negative entry amounts.
 */
async function enterVoucher(v) {
  await openVoucher(v.type);

  if (v.lockNumber) {
    const numInput = page.locator('input.w-32').first();
    await numInput.fill(v.lockNumber);
  }
  if (v.date) await page.fill("#v-date", v.date);
  if (v.reference) await page.fill("#v-ref", v.reference);
  if (v.refDate) await page.locator('input[type="date"]').nth(1).fill(v.refDate);

  const hasParty = PARTY_VOUCHERS.has(v.type);
  if (hasParty && !v.party) throw new Error(`${v.type} requires a party`);
  // The party line (ledger == v.party) goes to the auto-inserted row 0;
  // all other lines start at row 1.
  const partyLine = hasParty ? v.lines.find((l) => l.ledger === v.party) : null;
  const otherLines = v.lines.filter((l) => l !== partyLine);

  // Inventory grid first (rows independent of entries grid)
  if (v.items && v.items.length) {
    for (let i = 0; i < v.items.length; i++) {
      const it = v.items[i];
      if (i > 0) await page.click('button:has-text("+ Add Item")');
      const table = page.locator("table").filter({ hasText: "Qty" }).last();
      const row = table.locator("tbody tr").nth(i);
      await pickAhead(row.locator("input").first(), it.item);
      if (it.kind) await row.locator("select").nth(1).selectOption(it.kind);
      else if (it.godown) await row.locator("select").nth(0).selectOption({ label: it.godown });
      const nums = row.locator('input[type="number"]');
      await nums.nth(0).fill(String(it.qty));
      await nums.nth(1).fill(String(it.rate));
    }
  }

  // Party: pick via TypeAhead (auto-inserts party row at top, amount 0)
  if (v.party) {
    const partyField = page.locator('xpath=//span[text()="Party A/c"]/following::input[1]');
    await pickAhead(partyField, v.party);
  }

  // Ledger rows. Row 0 exists (party row when hasParty, else blank).
  const ltable = page.locator("table").filter({ hasText: "Ledger" }).last();
  for (let i = 0; i < otherLines.length; i++) {
    const ln = otherLines[i];
    const gridRow = hasParty ? i + 1 : i;
    // tbody holds data rows + an always-present Total strip row (no inputs),
    // so the data-row count is tbodyCount - 1.
    if (gridRow >= (await ltable.locator("tbody tr").count()) - 1) {
      await page.click('button:has-text("+ Add Ledger")');
      await sleep(140);
    }
    const row = ltable.locator("tbody tr").nth(gridRow);
    await pickAhead(row.locator("input").first(), ln.ledger);
    if (ln.billRef) {
      const billCell = row.locator("td").nth(1).locator("input");
      if (await billCell.isEnabled().catch(() => false)) await billCell.fill(ln.billRef);
    }
    const nums = row.locator('input[type="number"]');
    if (ln.dr !== undefined) await nums.nth(0).fill(String(ln.dr));
    else await nums.nth(1).fill(String(ln.cr));
    await sleep(80);
  }

  // Set the party row amount last (it holds the balancing total for trading vouchers)
  if (hasParty && partyLine) {
    const row0 = ltable.locator("tbody tr").nth(0);
    const nums0 = row0.locator('input[type="number"]');
    if (partyLine.dr !== undefined) await nums0.nth(0).fill(String(partyLine.dr));
    else await nums0.nth(1).fill(String(partyLine.cr));
    if (partyLine.billRef) {
      // Party row (row 0) has NO "Against Bill" column (only detail rows do);
      // its bill cell is the last td in the row.
      const billCell = row0.locator("td").last().locator("input");
      if (await billCell.isEnabled().catch(() => false)) await billCell.fill(partyLine.billRef);
    }
  }

  if (v.narration) await page.fill('input[placeholder^="Being"]', v.narration);

  if (v.clickApplyGst) {
    await page.locator('button:has-text("Apply GST")').first().click();
    await sleep(300);
  }
  if (v.clickApplyTds) {
    await page.locator('button:has-text("Deduct TDS")').first().click();
    await sleep(300);
  }
  if (v.clickApplyTcs) {
    await page.locator('button:has-text("Collect TCS")').first().click();
    await sleep(300);
  }

  await page.keyboard.press("Control+a");
  await sleep(800);

  const banner = page.locator(".bg-red-50").first();
  if (await banner.isVisible().catch(() => false)) {
    const msg = ((await banner.textContent()) || "").trim();
    if (v.expectError) {
      record(true, v.id || "err", `rejected as expected`, msg);
      await page.keyboard.press("Escape");
      await sleep(350);
      return false;
    }
    await shot(`save-fail-${v.type}-${v.date}`);
    throw new Error(`Voucher save failed: ${msg}`);
  }
  await page.waitForURL("**/daybook", { timeout: 12000 });
  await sleep(350);
  return true;
}

/** Alter a Day Book voucher by match text; mutate() runs on the edit screen. */
async function alterVoucher(matchText, mutate) {
  await page.goto(`${BASE}/company/${cid()}/daybook`);
  await page.waitForSelector("table tbody tr");
  await page.locator("table tbody tr", { hasText: matchText }).first().locator('a:has-text("Alter")').click();
  await page.waitForSelector("text=Ledger Entries");
  await sleep(300);
  if (mutate) await mutate();
  await page.keyboard.press("Control+a");
  await sleep(800);
  const banner = page.locator(".bg-red-50").first();
  if (await banner.isVisible().catch(() => false)) {
    const msg = ((await banner.textContent()) || "").trim();
    await page.keyboard.press("Escape"); await sleep(250);
    throw new Error(`Alter failed: ${msg}`);
  }
  await page.waitForURL("**/daybook", { timeout: 12000 });
  await sleep(300);
}

/** Delete a Day Book row. Narrow by matchText + optional amountText (rows show
 * party/narration + amount only — narration alone can match several rows), and
 * choose first|last occurrence (duplicate narrations enter + delete chronologically). */
async function deleteVoucher(matchText, amountText, useLast = false) {
  await page.goto(`${BASE}/company/${cid()}/daybook`);
  await page.waitForSelector("table tbody tr");
  page.once("dialog", (d) => d.accept());
  let rows = page.locator("table tbody tr", { hasText: matchText });
  if (amountText) rows = rows.filter({ hasText: amountText });
  await (useLast ? rows.last() : rows.first()).locator('button:has-text("Del")').click();
  await sleep(700);
}

async function daybookRows() {
  await page.goto(`${BASE}/company/${cid()}/daybook`);
  await page.waitForSelector("table tbody tr");
  return page.$$eval("table tbody tr", (trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.innerText.trim())));
}

/** Read the Day Book and return the voucher number for the newest matching row. */
async function voucherNumber(type, partyOrLedger) {
  const rows = await daybookRows();
  for (const r of rows) {
    if (r[1] === type && (!partyOrLedger || (r[3] || "").includes(partyOrLedger))) return r[2];
  }
  return null;
}

/** Voucher number looked up by type + formatted amount (Day Book shows party, not ref). */
async function voucherNumberBy(type, amount) {
  const rows = await daybookRows();
  const want = Number(amount).toLocaleString("en-IN");
  for (const r of rows) {
    if (r[1] === type && r[4] === want) return r[2];
  }
  return null;
}

/** Process payroll for YYYY-MM via the UI. */
async function processPayroll(month) {
  await page.goto(`${BASE}/company/${cid()}/payroll`);
  await page.fill('input[type="month"]', month);
  await page.click('button:has-text("Process")');
  await sleep(1000);
  const banner = page.locator(".bg-red-50").first();
  if (await banner.isVisible().catch(() => false)) {
    const msg = ((await banner.textContent()) || "").trim();
    await page.keyboard.press("Escape"); await sleep(250);
    throw new Error(`Payroll failed: ${msg}`);
  }
}

// ------------------------------------------------------------------ reports
async function openReport(key, { from, to } = {}, waitSel = "table.report-table") {
  await page.goto(`${BASE}/company/${cid()}/reports/${key}`);
  await page.waitForSelector(waitSel, { timeout: 20000 });
  const dates = page.locator('input[type="date"]');
  const n = await dates.count();
  if (from && n >= 1) await dates.nth(0).fill(from);
  if (to && n >= 2) await dates.nth(1).fill(to);
  else if (to && n === 1) await dates.nth(0).fill(to);
  await sleep(900); // react-query refetch + render
}

async function reportText() {
  return page.evaluate(() => document.body.innerText);
}
/** All body rows of every table matching sel, as arrays of cell texts. */
async function reportRows(sel = "table.report-table") {
  return page.$$eval(`${sel} tbody tr`, (trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.innerText.trim())));
}
/** Rows grouped per table (DOM order) — for side-by-side card layouts (BS). */
async function reportTables(sel = "table.report-table") {
  return page.$$eval(sel, (ts) => ts.map((t) =>
    Array.from(t.querySelectorAll("tbody tr")).map((tr) =>
      Array.from(tr.querySelectorAll("td")).map((td) => td.innerText.trim()))));
}
/** innerText of each element matching sel (card layouts: outstanding, cash/bank). */
async function cardBlocks(sel) {
  return page.$$eval(sel, (els) => els.map((e) => e.innerText));
}

function inrNum(s) {
  const m = String(s).match(/-?[\d,]+(?:\.\d+)?/);
  return m ? parseFloat(m[0].replace(/,/g, "")) : null;
}

/** Read the ledger-entries grid: [{name, billRef, dr, cr}] (blank inputs → null). */
async function readGrid() {
  const ltable = page.locator("table").filter({ hasText: "Ledger" }).last();
  const rows = await ltable.locator("tbody tr").all();
  const out = [];
  for (const row of rows) {
    const firstTd = (await row.locator("td").first().innerText().catch(() => "")).trim();
    if (firstTd === "Total") continue; // summary strip row has no inputs
    const name = await row.locator("input").first().inputValue().catch(() => "");
    const nums = row.locator('input[type="number"]');
    const dr = await nums.nth(0).inputValue().catch(() => "");
    const cr = await nums.nth(1).inputValue().catch(() => "");
    if (!name && !dr && !cr) continue;
    out.push({ name, dr: dr ? parseFloat(dr) : null, cr: cr ? parseFloat(cr) : null });
  }
  return out;
}

/** Read-only JSON fetch with the page's auth cookie (state seeding/probes only). */
async function getJson(path) {
  const res = await page.request.get(`${BASE}${path}`);
  if (!res.ok()) throw new Error(`GET ${path} → ${res.status()}`);
  return res.json();
}

/** R-06: opt a fixture company into negative stock (permissive legacy model).
 *  Seeding helper only — the availability guard itself is asserted in r06 checks,
 *  never bypassed through here. Rides the page's auth cookie. */
async function allowNegativeStock(name) {
  const dir = await getJson("/api/companies");
  const c = dir.find((x) => x.name === name)?.id;
  if (!c) throw new Error(`company not found for opt-in: ${name}`);
  const res = await page.request.put(`${BASE}/api/companies/${c}`, { data: { allowNegativeStock: true } });
  if (!res.ok()) throw new Error(`negative-stock opt-in failed for ${name}: ${res.status()}`);
  return c;
}

const api = {
  launch, close, login, createCompany, openCompany, cid,
  createMaster, listMaster, setSalaryStructureApi, readGrid, getJson, allowNegativeStock,
  openVoucher, enterVoucher, alterVoucher, deleteVoucher, daybookRows, processPayroll,
  reportRows, reportTables, cardBlocks,
  voucherNumber, voucherNumberBy, openReport, reportText, record, summary, shot, sleep,
  page: () => page, inrNum, FINDINGS, BASE, pickAhead,
};
module.exports = api;
