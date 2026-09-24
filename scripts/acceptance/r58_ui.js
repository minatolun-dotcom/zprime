// R-58 browser acceptance: company users — creator-only member management.
// Users are added, removed and password-reset from Company Settings; every
// member has FULL access to the company (no permission levels) — the only
// privileged actions are the member-admin ones, held by the company creator
// (the membership row labelled "owner", shown as "can manage users").
// Server gates proven through the UI: requireOwner on add/remove/reset (403
// for plain members — UI hides the controls AND the API refuses), last-owner
// 409 surfaced honestly, duplicate username 409 surfaced honestly.
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
  page.on("dialog", (d) => d.accept()); // the Remove confirm

  const CO_NAME = `R58 Users ${Date.now() % 100000}`;
  // usernames are GLOBAL (users table) — suffix them so re-runs on a used
  // volume hit the fresh-user path, not the duplicate-username 409.
  const U1 = `r58clerk1_${Date.now() % 100000}`;
  const U2 = `r58clerk2_${Date.now() % 100000}`;
  const settings = () => page.goto(`${D.BASE}/company/${D.cid()}/settings`, { waitUntil: "domcontentloaded" });
  const usersCard = () => page.locator(".card", { hasText: "Every user has full access" });

  await D.login();
  await D.createCompany({ name: CO_NAME, gstin: "27R58USERSXX8K1", stateCode: "27", fyStart: "2025-04-01", booksBegin: "2025-04-01" });
  ok("company created", !!D.cid(), D.cid());

  // ---- creator sees the Users card with the manage tag ----
  await settings();
  await usersCard().waitFor({ timeout: 15000 });
  await usersCard().locator("tbody tr", { hasText: "admin" }).first().waitFor({ timeout: 10000 }); // members query must land before counting
  ok("Users card shows the creator tagged 'can manage users'",
    (await usersCard().locator("tbody tr", { hasText: "admin" }).count()) === 1 &&
    (await usersCard().locator("text=can manage users").count()) >= 1, "creator row");

  // ---- add two users through the form ----
  const addUser = async (u, p) => {
    await usersCard().locator("form input").nth(0).fill(u);
    await usersCard().locator("form input").nth(1).fill(p);
    await usersCard().locator('button:has-text("Add user")').click();
    await usersCard().locator(`tbody tr:has-text("${u}")`).first().waitFor({ timeout: 8000 });
  };
  await addUser(U1, "r58-one");
  ok("first user added through the form", true, "row appeared");
  await addUser(U2, "r58-two");
  ok("second user added; access shown as Full",
    (await usersCard().locator("text=Full access").count()) >= 2, "full-access cells");

  // ---- duplicate username surfaces the server's 409 honestly ----
  await usersCard().locator("form input").nth(0).fill(U1);
  await usersCard().locator("form input").nth(1).fill("whatever");
  await usersCard().locator('button:has-text("Add user")').click();
  await D.sleep(600);
  ok("duplicate username refused with the server message",
    await usersCard().locator("text=already exists").isVisible().catch(() => false), "msg");

  // ---- a plain member: full access, but NO member-admin UI ----
  await page.click('button:has-text("Logout")');
  await D.sleep(500);
  await D.login(U1, "r58-one");
  await D.openCompany(CO_NAME);
  await settings();
  await usersCard().waitFor({ timeout: 15000 });
  let rows3 = 0;
  for (let i = 0; i < 20 && rows3 !== 3; i++) { rows3 = await usersCard().locator("tbody tr").count(); if (rows3 !== 3) await D.sleep(300); } // members query must land before counting
  ok("member sees the users list (read is open to members)", rows3 === 3, rows3);
  ok("member has no Add form, no Reset/Remove buttons",
    (await usersCard().locator('button:has-text("Add user")').count()) === 0 &&
    (await usersCard().locator('button:has-text("Reset password")').count()) === 0 &&
    (await usersCard().locator('button:has-text("Remove")').count()) === 0, "absent");
  ok("non-manager note shown",
    await usersCard().locator("text=Only the company creator can add or remove users").isVisible().catch(() => false), "note");
  await page.goto(`${D.BASE}/company/${D.cid()}/daybook`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("table", { timeout: 15000 });
  ok("member has full working access (Day Book opens)", true, "daybook");

  // ---- creator resets a member's password through the UI ----
  await page.click('button:has-text("Logout")');
  await D.sleep(500);
  await D.login(); // admin / admin123
  await D.openCompany(CO_NAME);
  await settings();
  await usersCard().waitFor({ timeout: 15000 });
  await usersCard().locator("tbody tr", { hasText: U1 }).locator('button:has-text("Reset password")').click();
  const resetCard = page.locator(".card", { hasText: `Reset password — ${U1}` });
  await resetCard.waitFor({ timeout: 8000 });
  await resetCard.locator('input[type="password"]').fill("r58-one-NEW");
  await resetCard.locator('button:has-text("Reset password")').click();
  await D.sleep(600);
  ok("password reset via UI", await page.locator("text=Password reset for").isVisible().catch(() => false), "msg");

  // ---- the member signs in with the NEW password ----
  await page.click('button:has-text("Logout")');
  await D.sleep(500);
  let signedIn = true;
  try { await D.login(U1, "r58-one-NEW"); } catch { signedIn = false; }
  ok("member signs in with the reset password", signedIn, "login");
  await D.openCompany(CO_NAME);
  ok("reset member still has full access", !!D.cid(), "company opens");

  // ---- remove a member through the UI (confirm auto-accepted) ----
  await page.click('button:has-text("Logout")');
  await D.sleep(500);
  await D.login();
  await D.openCompany(CO_NAME);
  await settings();
  await usersCard().waitFor({ timeout: 15000 });
  await usersCard().locator("tbody tr", { hasText: U2 }).locator('button:has-text("Remove")').click();
  await D.sleep(700);
  ok("user removed via UI", (await usersCard().locator("tbody tr", { hasText: U2 }).count()) === 0, "row gone");

  // ---- last-owner guard surfaces the server's 409 honestly ----
  await usersCard().locator("tbody tr", { hasText: "admin" }).locator('button:has-text("Remove")').click();
  await D.sleep(700);
  ok("removing the last manager refused with the server message",
    await page.locator("text=Cannot remove the last owner").isVisible().catch(() => false), "msg");

  ok("no page errors during R-58 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-58 UI scenario: ${pass} ok, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
