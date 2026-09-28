// R-79 browser acceptance: dedicated Light / Dark / Reading(=warm) theme
// toggle in the app top bar.
//  1) The toggle renders on every screen; clicking Dark applies html.dark and
//     the page RE-PAINTS dark (computed backgrounds of body, a card, an input
//     and the report-table header — the "proper dark mode, not just a dark
//     background" contract).
//  2) Reading applies html.warm with warm paper tones (distinct hues from
//     both light and dark).
//  3) Back to Light restores the stock palette; the choice persists across a
//     full page reload (localStorage + pre-hydration script, no flash).
//  4) Print honesty: @media print hard-resets the palette so a themed session
//     still prints black-on-white (report-table th bg back to white).
//  5) Native form controls follow the theme (color-scheme), zero page errors.
// Prereqs: compose stack at localhost:3000 (admin/admin123) with the built
// client (docker compose build app && docker compose up -d app).
const D = require("./driver.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${JSON.stringify(detail)?.slice(0, 260)}`); }
};

const BASE = D.BASE.replace(/\/$/, "");

(async () => {
  await D.launch();
  const page = D.page();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  await D.login();
  await D.createCompany({ name: `R79 Themes ${Date.now().toString(36)}`, stateCode: "27", fyStart: "2026-04-01", booksBegin: "2026-04-01" });
  const cid = D.cid();
  ok("company created, gateway open", !!cid, cid);

  // post one voucher so the TB report has a table to probe
  const get = async (p) => (await page.request.get(`${BASE}/api/c/${cid}${p}`)).json();
  const ledgers = await get("/ledgers");
  const cash = ledgers.find((l) => l.name === "Cash");
  const pl = ledgers.find((l) => l.name === "Profit & Loss A/c");
  const vts = await get("/voucher-types");
  const journal = vts.find((t) => t.name === "Journal");
  await page.request.post(`${BASE}/api/c/${cid}/vouchers`, { data: {
    voucherTypeId: journal.id, date: "2026-04-01", narration: "theme fixture",
    entries: [{ ledgerId: cash.id, amount: 1000 }, { ledgerId: pl.id, amount: -1000 }],
  } });

  // helpers ------------------------------------------------------------
  const themeToggle = () => page.locator('[data-testid="theme-toggle"]');
  const htmlClasses = () => page.evaluate(() => document.documentElement.className);
  const bgOf = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? getComputedStyle(el).backgroundColor : null;
  }, sel);
  const rgbToHsl = (rgb) => page.evaluate((c) => {
    // Tailwind v4 serializes palette colors as oklch() — parse both formats.
    let r, g, b;
    const rgbM = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbM) {
      [r, g, b] = [+rgbM[1], +rgbM[2], +rgbM[3]].map((v) => v / 255);
    } else {
      const o = c.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
      if (!o) return null;
      const L = +o[1], C = +o[2], H = (+o[3] * Math.PI) / 180;
      const a = C * Math.cos(H), bb = C * Math.sin(H);
      const oklabToLinear = (t) => {
        const l_ = t + 0.3963377774 * a + 0.2158037573 * bb;
        const m_ = t - 0.1055613458 * a - 0.0638541728 * bb;
        const s_ = t - 0.0894841775 * a - 1.291485548 * bb;
        const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
        return [
          +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
          -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
          -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
        ];
      };
      [r, g, b] = oklabToLinear(L).map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
    }
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (mx === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  }, rgb);
  const lightness = async (sel) => rgbToHsl(await bgOf(sel));
  // v1.68.1: author ::selection colors — the browser default is translucent
  // blue with a light-blue text tint (blue-on-blue on the dark page); every
  // theme must pin a light bg + dark-ink pair (Chromium exposes author
  // ::selection via getComputedStyle's pseudo-arg).
  const selectionColors = () => page.evaluate(() => {
    const cs = getComputedStyle(document.body, "::selection");
    return { bg: cs.backgroundColor, color: cs.color };
  });

  const gotoGateway = async () => {
    await page.goto(`${BASE}/company/${cid}`);
    await page.waitForSelector("text=Gateway of zprime", { timeout: 15000 });
    await D.sleep(300);
  };

  // ---- 1) toggle present on every screen; default light ---------------
  await gotoGateway();
  ok("theme toggle present on the Gateway", await themeToggle().isVisible().catch(() => false), null);
  ok("default theme is light (no html class)", (await htmlClasses()) === "", await htmlClasses());

  await page.goto(`${BASE}/company/${cid}/daybook`);
  await page.waitForSelector("table.report-table", { timeout: 15000 });
  ok("theme toggle present on the Day Book", await themeToggle().isVisible().catch(() => false), null);
  await gotoGateway();

  // ---- 2) Dark: proper dark mode, verified by PAINT ---------------------
  await themeToggle().locator('button[title^="Dark theme"]').click();
  await D.sleep(400);
  ok("Dark applies html.dark", (await htmlClasses()).includes("dark"), await htmlClasses());

  // paint probes run on the Day Book — one page carrying body, cards, native
  // inputs AND a report table (the Gateway has none of the latter two).
  await page.goto(`${BASE}/company/${cid}/daybook`);
  await page.waitForSelector("table.report-table", { timeout: 15000 });
  await D.sleep(300);
  const bodyL = await lightness("body");
  const cardL = await lightness(".card");
  const inputL = await lightness("input");
  const thL = await lightness(".report-table th");
  ok("dark body repaints dark (L well below 50%)", bodyL !== null && bodyL.l < 35, bodyL);
  ok("dark cards repaint dark (surface, not black-on-dark text)", cardL !== null && cardL.l >= 10 && cardL.l <= 35, cardL);
  ok("dark inputs repaint dark (native controls follow)", inputL !== null && inputL.l < 40, inputL);
  ok("dark report-table headers repaint dark", thL !== null && thL.l < 40, thL);
  ok("dark is a blue-hue surface (not grey-black)", bodyL !== null && bodyL.h >= 200 && bodyL.h <= 240, bodyL);
  ok("cards are LIGHTER than the page (proper elevation, not inverted)",
     bodyL && cardL && cardL.l > bodyL.l, { body: bodyL, card: cardL });

  // text is readable: body text is now light
  const textColor = await page.evaluate(() => getComputedStyle(document.body).color);
  const textL = await rgbToHsl(textColor);
  ok("dark body text is light (readable)", textL !== null && textL.l > 70, textColor);

  // explicit selection: light highlight + dark ink, well clear of the page
  const darkSel = await selectionColors();
  const darkSelBg = await rgbToHsl(darkSel.bg);
  const darkSelText = await rgbToHsl(darkSel.color);
  ok("dark selection highlight is LIGHT (visible against the dark page)", darkSelBg !== null && darkSelBg.l > 60, { sel: darkSel, hsl: darkSelBg });
  ok("dark selection text is dark ink (readable inside the highlight)", darkSelText !== null && darkSelText.l < 35, darkSelText);
  ok("dark selection beats the page — no blue-on-blue", darkSelBg && bodyL && darkSelBg.l - bodyL.l > 25, { selBg: darkSelBg, body: bodyL });

  // header bar stays accent-tinted with WHITE text (the white-text contract)
  const headerColor = await page.evaluate(() => getComputedStyle(document.querySelector("header .bg-indigo-700")).color);
  ok("header bar keeps white text in dark mode", /rgb\(255,\s*255,\s*255\)/.test(headerColor), headerColor);

  // ---- 3) Reading (warm): distinct warm hue ------------------------------
  await themeToggle().locator('button[title^="Reading"]').click();
  await D.sleep(400);
  ok("Reading applies html.warm", (await htmlClasses()).includes("warm") && !(await htmlClasses()).includes("dark"), await htmlClasses());
  const warmBody = await lightness("body");
  const warmCard = await lightness(".card");
  ok("warm body is light (reading mode stays light)", warmBody !== null && warmBody.l > 80, warmBody);
  ok("warm body carries a warm hue (orange/yellow family, s > 15%)",
     warmBody !== null && warmBody.h >= 20 && warmBody.h <= 70 && warmBody.s >= 15, warmBody);
  ok("warm cards stay near-white paper", warmCard !== null && warmCard.l > 85, warmCard);
  const warmSel = await selectionColors();
  const warmSelBg = await rgbToHsl(warmSel.bg);
  const warmSelText = await rgbToHsl(warmSel.color);
  ok("warm selection is ochre with dark ink (theme-consistent)",
     warmSelBg !== null && warmSelText !== null && warmSelBg.h >= 25 && warmSelBg.h <= 60 &&
     warmSelBg.s >= 15 && warmSelText.l < 35, { bg: warmSelBg, text: warmSelText });

  // ---- 4) back to Light: stock palette returns ---------------------------
  await themeToggle().locator('button[title^="Light theme"]').click();
  await D.sleep(400);
  ok("Light restores the stock palette (no class)", (await htmlClasses()) === "", await htmlClasses());
  const stockBody = await lightness("body");
  ok("stock body is the cool slate light grey", stockBody !== null && stockBody.l > 85, stockBody);
  const lightSel = await selectionColors();
  const lightSelBg = await rgbToHsl(lightSel.bg);
  const lightSelText = await rgbToHsl(lightSel.color);
  ok("light selection is soft indigo with dark ink",
     lightSelBg !== null && lightSelText !== null && lightSelBg.l > 80 &&
     lightSelBg.h >= 200 && lightSelBg.h <= 260 && lightSelText.l < 40, { bg: lightSelBg, text: lightSelText });

  // ---- 5) persistence across a full reload -------------------------------
  await themeToggle().locator('button[title^="Dark theme"]').click();
  await D.sleep(300);
  await page.reload();
  await page.waitForSelector("table.report-table", { timeout: 15000 });
  await D.sleep(300);
  ok("theme persists across reload (pre-hydration, no flash)", (await htmlClasses()).includes("dark"), await htmlClasses());
  const reloadBody = await lightness("body");
  ok("repaint is dark immediately after reload", reloadBody !== null && reloadBody.l < 35, reloadBody);

  // ---- 6) print honesty: themed session prints light ----------------------
  await page.emulateMedia({ media: "print" });
  await page.goto(`${BASE}/company/${cid}/reports/trial-balance`);
  await page.waitForSelector(".report-table", { timeout: 15000 });
  await D.sleep(400);
  const printTh = await lightness(".report-table th");
  ok("print: themed session still prints black-on-white (th light again)",
     printTh !== null && printTh.l > 90, printTh);
  await page.emulateMedia({ media: "screen" });

  ok("zero page errors across the R-79 scenario", pageErrors.length === 0, pageErrors);

  console.log(`\n== R-79 RESULT: ${pass} passed, ${fail} failed ==`);
  await D.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
