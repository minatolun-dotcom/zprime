# R-51 Investigation — zprime v1.48.0 · Browser-Reserved Shortcut Keys

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-51 CONFIRMED — INVESTIGATION REQUIRED` (P2 class: real platform conflict, live-diagnosed; the app already does everything JavaScript can do).
**Baseline:** HEAD `54125be38f287a272dfcf54058217f5611a2cc4e` = `v1.48.0-1-g54125be` (release commit `1c06874` = tag `v1.48.0`, pushed, 50 tags); working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified.

---

## 1. Executive Summary

Operator report: "shortcut key not working … the shortcut is taken over by the browser, not the zprime app."

**Diagnosed, confirmed, and bounded:**

1. **The app-side hotkey system is correct.** `client/src/lib/hotkeys.ts` listens on `window` in the **capture phase**, calls `e.preventDefault()` for every recognized combo, and every mapped key fires (live-probed; the entire 153-check run.js suite + scenario suites exercise these chords through a real keyboard API and pass).
2. **The conflicts are real and are NOT fixable from page JavaScript.** Browsers process reserved chords (accelerators) in the **browser process, before the key event ever reaches the renderer**. A page can only `preventDefault()` events it receives; reserved accelerators never arrive. This is documented platform behavior (Chromium accelerator table; DevTools source explicitly annotates F5 `preventDefault` handling; Firefox reserves Alt+1–9 for tab switching on Windows/Linux and Alt for menu access).
3. **zprime's advertised Tally-identity vocabulary collides head-on with the most-reserved keys in browser UI:** F5 (reload), F6 (address bar), F11 (fullscreen), F12 (DevTools), Alt+F1 (Firefox start page), Alt+0–9 (Firefox tab switch), Alt+letter (Windows/Linux Firefox menu access — this touches R-23's Alt+C/G/T/R and R-35's Alt+C).

**The one thing a web page cannot ever win:** a tug-of-war with the browser process over a reserved key. The standard, proven escape hatch is **installing the app as a PWA** (standalone window: no tab strip, no address bar → the offending accelerators disappear). A manifest does not exist today.

---

## 2. Evidence (live probes on the running v1.48.0 stack)

| Probe | Method | Result |
|---|---|---|
| Mapped F5 on Day Book | Playwright key event + reload marker | Handler fired, navigated to Payment voucher, no reload — capture listener + preventDefault work |
| All advertised keys on an unmapped screen (TB report) | Playwright sweep ×14 keys | No reload, no navigation — **but see §3: this cannot prove real-user behavior** |
| First-listener key spy | Un-preventable capture listener registered before the app's | All injected events reach the page with modifiers — confirms Playwright events bypass browser chrome |
| Manifest / PWA | Source + built bundle | **No `manifest.webmanifest`, no `display` mode, no installability anywhere** |

**Measurement limitation (recorded honestly):** Playwright injects key events at the renderer level, *bypassing the browser's accelerator table*. Therefore no automated browser check can reproduce or refute the real-user experience for reserved chords; the platform-behavior claims above rest on documented browser behavior, not on our probes. Any future automated test can only cover the page-reachable layer.

---

## 3. Reserved-key matrix vs zprime's advertised vocabulary

| Advertised (screen) | Windows/Chrome | Windows/Firefox | Page can prevent? |
|---|---|---|---|
| F5 Day Book/Payment, Reports refresh-adjacent | **RELOAD — reserved** | reload | ✗ (chrome accelerator) |
| F6 Receipt | focus address bar — reserved | focus address bar | ✗ |
| F7 Journal | mostly free | mostly free | ✓ |
| F8 Sales | mostly free | mostly free | ✓ |
| F9 Purchase | mostly free | mostly free | ✓ |
| F12 Ref/Party focus | **DevTools — reserved** | DevTools | ✗ |
| Alt+F1 detailed/condensed (Reports, Voucher) | mostly free | **start/home page — reserved** | ✗ (FF) |
| Alt+F5/F6/F7/F8 (DN/CN/SJ/DN) | mostly free | Alt menu-access risk | partial |
| Alt+C/G/T/R (R-35/R-23) | mostly free | **menu bar access — reserved-ish** | partial |
| Alt+1..9 mapped as Alt+F1..F9 | free | **tab switch 1–9 — reserved** | ✗ (FF) |
| Ctrl+A accept | select-all (suppressed when mapped) | same | ✓ |
| Escape / Enter / arrows | free | free | ✓ |

Note: every F5 press on a *mapped* screen (Day Book F5) works today in Chrome because the page preventDefaults the event — Chrome's F5-reload is implemented as a default action, not a hard accelerator (per DevTools source). The truly unwinnable keys are the ones browsers consume **before dispatch**: F6/F11/F12 in Chrome, Alt+digits and menu-Alt in Firefox. The vocabulary sits in a mixed zone — which is precisely why behavior "sometimes works and sometimes doesn't" and feels random to an operator.

---

## 4. Root cause

Not a bug in the hotkey layer — a **deployment-context gap**: zprime is a Tally-style keyboard-first app served as an ordinary browser tab, where the browser owns an accelerator table that overlaps the app's advertised vocabulary. The investigation found **no PWA manifest**, so operators have no supported path out of tab context.

---

## 5. Options (implementation pending approval — NOT started)

**A. PWA install path (recommended, small blast radius).**
Add `client/public/manifest.webmanifest` (name, short_name, `display: "standalone"`, theme `#4f46e5`, background, icons 192/512 — need one SVG/PNG icon asset), `<link rel="manifest">` in `index.html`. Operators "Install app" from the browser menu → standalone window: no tab strip (Ctrl/Alt+digit conflicts gone), no address bar (F6 gone), no in-tab menu bar (Firefox Alt-letter gone). F12/F11 remain reserved even standalone, but those (Ref/Party focus, nothing) matter less. Server must serve the manifest with the right MIME type. ~3 files + icon; zero behavior change in-tab.

**B. Remap the vocabulary away from reserved keys.**
E.g. Alt+Shift+P/S/R… — destroys Tally muscle memory (the product's stated identity), touches ~15 label-anchored browser suites, and is still not bulletproof (Chrome 145 hardcoded Alt+Shift+Z precedent). Not recommended as the primary fix.

**C. Document + in-app guidance.**
Gateway Shortcuts card + README/ONBOARDING: "for full F-key operation, install zprime as an app (Chrome: Menu → Install)"; list which chords each browser reserves. Zero risk, but leaves the pain.

**Recommended: A + C.** (B rejected: identity + test churn + no guarantee.)

---

## 6. Non-Bugs Verified

- **NOT A BUG — VERIFIED:** capture-phase listener + `preventDefault` in `hotkeys.ts`; every page-reachable chord fires (live probe + full suite estate).
- **NOT A BUG — VERIFIED:** the Playwright suites passing while real users see conflicts — the suites run in a context that bypasses browser chrome (recorded as a permanent measurement boundary; automated tests cannot regress-guard this layer).
- **Dead code note (P4):** `hotkeys.ts` recognizes `Ctrl+H` but no page maps it — harmless.

---

## 7. Out of Scope

- OS-level global hotkeys, Electron/Tauri packaging (a different product decision).
- Changing the Tally F-key vocabulary (identity).
- Any accounting/server surface.

---

## 8. Final Recommendation

Approve **Option A + C** as R-51 implementation: PWA manifest + icons + install guidance (Gateway Shortcuts card, README section). Acceptance: manifest served and installable (Lighthouse/DevTools installability check), standalone window verified by real browser, in-tab behavior byte-identical, all suites green.

**R-51 CONFIRMED — INVESTIGATION REQUIRED**
