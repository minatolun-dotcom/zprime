// R-57 browser acceptance: voucher-numbering periodicity (R-55 Option B).
// A1) 'never' (default) types keep the single continuous series — every
// existing type unchanged; A2) 'fiscal' types restart at Start Number in a
// new FY (Tally parity) and keep counting within an FY; A3) the next-number
// PEEK follows the queried date's FY bucket; A4) R-10 replay still returns the
// original; A5) manual numbers are honoured and their unique scope is per FY
// (a fiscal type can reuse a number across FYs, never within one); A6) periodicity
// is locked after the first voucher (409 with an actionable message); A7) edits
// re-stamp fy when the date moves; A8) seed defaults are 'never'.
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
  // April-begin FY spanning two fiscal years: 2025-26 and 2026-27.
  await D.createCompany({ name: "R57 Periodic", gstin: "27R57PERIODIC8K1", stateCode: "27", fyStart: "2025-04-01", booksBegin: "2025-04-01" });
  const cid = D.cid();
  ok("company created", !!cid, cid);

  const api = async (method, path, body) => {
    const r = await page.request[method](`${D.BASE}/api${path}`, body !== undefined ? { data: body } : undefined);
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status(), j };
  };
  const grps = Object.fromEntries(((await api("get", `/c/${cid}/groups`)).j ?? []).map((x) => [x.name, x.id]));
  await api("post", `/c/${cid}/ledgers`, { name: "R57 Cash", groupId: grps["Cash-in-Hand"] });
  await api("post", `/c/${cid}/ledgers`, { name: "R57 Exp", groupId: grps["Indirect Expenses"] });
  const ledgers = (await api("get", `/c/${cid}/ledgers`)).j ?? [];
  const cash = ledgers.find((l) => l.name === "R57 Cash");
  const exp = ledgers.find((l) => l.name === "R57 Exp");
  const typeRows = (await api("get", `/c/${cid}/voucher-types`)).j ?? [];
  const payment = typeRows.find((t) => t.name === "Payment");
  const body = (date, narration) => ({
    voucherTypeId: payment.id, date, narration,
    entries: [{ ledgerId: exp.id, amount: 100 }, { ledgerId: cash.id, amount: -100 }],
  });

  // ---- A8) seed defaults are 'never' ----
  ok("seeded types default to numberingPeriodicity 'never'", payment.numberingPeriodicity === "never", payment.numberingPeriodicity);

  // ---- A1) 'never': continuous series across FY boundary ----
  const r1 = await api("post", `/c/${cid}/vouchers`, body("2026-03-15", "A1 old-fy"));
  const r2 = await api("post", `/c/${cid}/vouchers`, body("2026-04-05", "A1 new-fy"));
  ok("never-type voucher 1 saved", r1.status === 200 && r1.j?.number === "1", { status: r1.status, n: r1.j?.number });
  ok("never-type numbering continues across the FY boundary (2)", r2.status === 200 && r2.j?.number === "2", { status: r2.status, n: r2.j?.number });
  ok("never-type vouchers carry the '' bucket (one continuous series)", r1.j?.fy === "" && r2.j?.fy === "", { fy1: r1.j?.fy, fy2: r2.j?.fy });

  // ---- A6) periodicity locked after the first voucher ----
  const lock = await api("put", `/c/${cid}/voucher-types/${payment.id}`, { numberingPeriodicity: "fiscal" });
  ok("periodicity flip after first voucher refused (409, actionable)", lock.status === 409, { status: lock.status, j: lock.j });

  // ---- A2/A3) a NEW fiscal type: restart + peek per date ----
  const mk = await api("post", `/c/${cid}/voucher-types`, {
    name: "R57 Fiscal", shortCode: "FIS", category: "Accounting",
    numbering: "automatic", startNumber: 1, numberingPeriodicity: "fiscal", prefix: "F-",
  });
  ok("fiscal voucher type created", mk.status === 200 && mk.j?.numberingPeriodicity === "fiscal", mk.j);
  const fis = mk.j;
  const f1 = await api("post", `/c/${cid}/vouchers`, { voucherTypeId: fis.id, date: "2026-03-20", narration: "A2 old-fy", entries: [{ ledgerId: exp.id, amount: 50 }, { ledgerId: cash.id, amount: -50 }] });
  const f2 = await api("post", `/c/${cid}/vouchers`, { voucherTypeId: fis.id, date: "2026-04-10", narration: "A2 new-fy", entries: [{ ledgerId: exp.id, amount: 60 }, { ledgerId: cash.id, amount: -60 }] });
  ok("fiscal type numbers restart in the new FY (F-1 again)", f1.status === 200 && f1.j?.number === "F-1" && f2.status === 200 && f2.j?.number === "F-1", { n1: f1.j?.number, n2: f2.j?.number });
  const f3 = await api("post", `/c/${cid}/vouchers`, { voucherTypeId: fis.id, date: "2026-04-12", narration: "A2 within-fy", entries: [{ ledgerId: exp.id, amount: 70 }, { ledgerId: cash.id, amount: -70 }] });
  ok("fiscal type keeps counting within the FY (F-2)", f3.status === 200 && f3.j?.number === "F-2", f3.j?.number);

  // ---- A3) peek follows the date's FY bucket ----
  const peekOld = (await api("get", `/c/${cid}/vouchers/next-number?voucherTypeId=${fis.id}&date=2026-02-02`)).j;
  const peekNew = (await api("get", `/c/${cid}/vouchers/next-number?voucherTypeId=${fis.id}&date=2026-05-02`)).j;
  ok("peek for an old-FY date returns that FY's next number", peekOld?.number === "F-2" && peekOld?.fy === "2025-04-01", peekOld);
  ok("peek for a new-FY date returns the new FY's next number", peekNew?.number === "F-3" && peekNew?.fy === "2026-04-01", peekNew);

  // ---- A5) manual numbers unique per FY for fiscal types ----
  // (F-1 is already taken in BOTH FYs by the autos f1/f2, so duplicate probes
  // use F-1 in the old FY, and the cross-FY reuse probe uses F-9.)
  const dupOldFy = await api("post", `/c/${cid}/vouchers`, { voucherTypeId: fis.id, date: "2026-03-25", number: "F-1", narration: "A5 dup old fy", entries: [{ ledgerId: exp.id, amount: 80 }, { ledgerId: cash.id, amount: -80 }] });
  ok("manual duplicate number refused within the same FY", dupOldFy.status === 409, { status: dupOldFy.status });
  const manOld = await api("post", `/c/${cid}/vouchers`, { voucherTypeId: fis.id, date: "2026-03-26", number: "F-9", narration: "A5 manual old fy", entries: [{ ledgerId: exp.id, amount: 80 }, { ledgerId: cash.id, amount: -80 }] });
  ok("manual number honoured in the old FY (F-9)", manOld.status === 200 && manOld.j?.number === "F-9", { status: manOld.status, n: manOld.j?.number });
  const manNew = await api("post", `/c/${cid}/vouchers`, { voucherTypeId: fis.id, date: "2026-04-15", number: "F-9", narration: "A5 manual new fy", entries: [{ ledgerId: exp.id, amount: 90 }, { ledgerId: cash.id, amount: -90 }] });
  ok("same manual number accepted in the NEW FY (per-FY scope)", manNew.status === 200 && manNew.j?.number === "F-9", { status: manNew.status, n: manNew.j?.number });

  // ---- A4) R-10 replay still returns the original (with warnings passthrough intact) ----
  const replayBody = { voucherTypeId: fis.id, date: "2026-04-20", narration: "A4 replay", entries: [{ ledgerId: exp.id, amount: 30 }, { ledgerId: cash.id, amount: -30 }] };
  const first = await page.request.post(`${D.BASE}/api/c/${cid}/vouchers`, { data: { ...replayBody, idempotencyKey: "r57-replay-key" }, headers: { "X-Idempotency-Key": "r57-replay-key" } });
  const firstJ = await first.json();
  const replay = await page.request.post(`${D.BASE}/api/c/${cid}/vouchers`, { data: { ...replayBody, idempotencyKey: "r57-replay-key" }, headers: { "X-Idempotency-Key": "r57-replay-key" } });
  ok("first keyed voucher saved", first.status() === 200, first.status());
  ok("R-10 replay returns the original voucher (no duplicate draw)", replay.status() === 200 && (await replay.json()).id === firstJ.id, { status: replay.status(), id: firstJ.id });
  const listAfter = (await api("get", `/c/${cid}/vouchers?from=2026-04-19&to=2026-04-21`)).j;
  ok("replay did not post a second voucher", Array.isArray(listAfter) && listAfter.filter((v) => v.narration === "A4 replay").length === 1, listAfter?.length);

  // ---- A7) edit re-stamps fy when the date crosses the FY boundary ----
  // Move F-2 (new-FY auto) into the OLD FY; F-2 is free there (old FY has the
  // F-1 auto and the F-9 manual), so the move cannot collide on number.
  const editRes = await api("put", `/c/${cid}/vouchers/${f3.j.id}`, { voucherTypeId: fis.id, date: "2026-03-28", narration: "A7 moved back", entries: [{ ledgerId: exp.id, amount: 70 }, { ledgerId: cash.id, amount: -70 }] });
  const moved = (await api("get", `/c/${cid}/vouchers/${f3.j.id}`)).j;
  ok("edit across the FY boundary succeeds and re-stamps fy", editRes.status === 200 && moved?.fy === "2025-04-01", { status: editRes.status, body: editRes.j, fy: moved?.fy });

  // ---- UI: MasterPage field exists; VoucherScreen peek follows date change ----
  await D.openCompany("R57 Periodic");
  await page.goto(`${D.BASE}/company/${cid}/masters/voucher-types`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button:has-text("+ New")', { timeout: 15000 });
  await page.click('button:has-text("+ New")');
  await D.sleep(400);
  const hasField = await page.locator('label:has-text("Restart Numbering")').isVisible().catch(() => false);
  ok("Voucher Types form shows the Restart Numbering selector", hasField);
  await page.click('form button:has-text("Cancel")');
  await D.sleep(300);

  // 'never' type peek unchanged when the date crosses the FY boundary.
  // openVoucher (not enterVoucher) — the voucher must stay UNSAVED.
  await page.goto(`${D.BASE}/company/${cid}/daybook`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("table", { timeout: 15000 });
  await D.openVoucher("Payment");
  await page.waitForSelector("#v-date", { timeout: 15000 });
  await D.sleep(400);
  const neverPeek = await page.locator('[data-testid="v-number"]').inputValue();
  await page.fill("#v-date", "2026-08-01");
  await D.sleep(700);
  const neverPeek2 = await page.locator('[data-testid="v-number"]').inputValue();
  ok("'never' type peek unchanged by date crossing FY", neverPeek === neverPeek2, { a: neverPeek, b: neverPeek2 });
  await page.keyboard.press("Escape");
  await D.sleep(400);
  await page.keyboard.press("Escape");
  await D.sleep(300);

  ok("no page errors during R-57 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-57 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
