# R-34 Investigation — zprime v1.32.0 · UX Backlog (Keyboard-First & Drill-Down)

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-34 CONFIRMED — GENUINE UX DEFECTS, FULLY SCOPED` (three confirmed defects: one P2 keyboard-integrity pair, two P3 affordance/drill-down gaps; no P0/P1, no accounting or security exposure).
**Baseline:** HEAD `ec8b1301bff6de36e83752ef1d76d68d33eaf58e` = tag `v1.32.0` (pushed); working tree carries only the ledger docs recording the release plus the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified.

---

## 1. Executive Summary

The product's declared identity (PROJECT.md, README, the original audit's feature matrix row 45) is **keyboard-first, Tally-inspired**. The actual client has exactly **one** global hotkey engine (`client/src/lib/hotkeys.ts`), one voucher-grid Enter handler, and type-ahead arrow/Enter support — but the keyboard story is only partially wired. This investigation audited every advertised key, every clickable-looking surface, and every drill-down path.

**Confirmed defects (all client-only, none touch accounting or the server):**

1. **P2 — Alt+G ("Apply GST") and Alt+T ("Deduct TDS") are dead.** The VoucherScreen F-key panel advertises both, but the `FKeyButton` entries carry **no `onClick`** and the `useHotkeys` map has **no `"Alt+G"`/`"Alt+T"` entries** (VoucherScreen.tsx:416,418 vs 403–410). Clicking the panel button does nothing. The working "+ Apply GST" / "− Deduct TDS" inline buttons exist elsewhere on the screen, so operators can complete the action — but the advertised affordance is a lie, and the keyboard chord never works. Tally-parity and honesty both demand the panel buttons and the chords work.
2. **P2 — Six Day Book voucher types are button-only, contradicting the printed F-key legend.** Debit Note (Alt+F5), Credit Note (Alt+F6), Stock Journal (Alt+F7), Delivery Note (Alt+F8), Receipt Note (Alt+F9), Physical Stock (Ctrl+F7) appear as key chips in the panel, but `DayBook.tsx`'s `useHotkeys` map (lines 81–89) only registers F4/F5/F6/F7/F8/F9. The hotkey engine already produces `Alt+F5`-style combos correctly (hotkeys.ts:15 `e.altKey ? \`Alt+${k}\``) — the map entries are simply missing. The browser driver documents this as an **"App quirk"** and works around it by clicking buttons instead of pressing keys (driver.js:185–204 `CLICK_OPEN`), which is test-suite accommodation of a defect.
3. **P3 — Day Book rows are styled clickable but do nothing.** Rows carry the `row-link` class (cursor-pointer + hover highlight, index.css:34) but no `onClick`/`Link` — only the tiny Alter/Cancel/Del text buttons act. Every report that lists vouchers *does* navigate on row click (Reports.tsx:447 ledger-vouchers → voucher edit). A user hovering a Day Book row gets an affordance that goes nowhere. Meanwhile report drill-down rows navigate correctly — the gap is Day-Book-row → voucher.

**NOT A BUG — VERIFIED (2):** the two-step drill chain Gateway → report → ledger-vouchers → voucher edit is complete and keyboard-reachable via Esc chaining (Esc semantics are consistent per screen); the voucher grid's Enter-on-last-row behavior (new row + focus) is correct Tally-style flow and needs no change.

**Recommended scope (Option A, ≈ v1.33.0):** wire the dead affordances — Alt+G/Alt+T (onClick + hotkey entries), the six missing Day Book chords (map entries only; the engine already supports them), Day Book row click → voucher edit (with `stopPropagation` on the existing row action buttons). Client-only; no server, no schema, no accounting surface. Blast radius: small and enumerated (below). ~10–14 new browser checks drive every fixed affordance with **real key presses**.

---

## 2. Baseline Integrity

- `git rev-parse HEAD` → `ec8b1301bff6de36e83752ef1d76d68d33eaf58e`
- `git describe --tags` → `v1.32.0`
- `git ls-remote origin main` → `ec8b1301…` (pushed, matches local)
- Working tree: `M CHANGELOG.md CONTINUE.md RELEASES.md STATE.md` (ledger docs recording v1.32.0, riding with the next commit per convention), untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md` (untouched) and `scripts/__pycache__/`.
- Verification estate at baseline: 1197 automated + 399 browser checks; 34 immutable tags.

## 3. Scope of This Investigation

Approved focus: the **UX backlog** — keyboard-first polish, voucher-entry friction, report drill-down. Method: exhaustively map the *advertised* keyboard surface (every F-key chip in every `Shell` panel, every `useHotkeys` map), compare against what actually fires; map every *visually clickable* surface (row-link, buttons) against actual handlers; trace drill-down chains report → voucher; cross-check browser suites for accommodation of broken affordances ("App quirk" workarounds) and locator pinning that constrains fixes.

## 4. The Keyboard Surface — Advertised vs Actual

**The engine (hotkeys.ts):** captures F1–F12 (bare, and with Alt/Ctrl/Shift prefixes), Ctrl+A, Ctrl+H, Alt+digit (→ `Alt+F<digit>`), Escape, Alt+Enter, and single-letter Alt chords (→ `Alt+<letter>`, R-23). Capture-phase window listener; registered maps are per-screen. The engine is sound — every gap below is a *missing map entry or missing onClick*, not an engine defect.

| Screen | Advertised (panel) | Actually wired (hotkeys map) | Gap |
|---|---|---|---|
| Gateway | F2, F5, F8, F9 | F2, F5, F8, F9 (Gateway.tsx:101–106) | none |
| Day Book | F4–F9, **Alt+F5, Alt+F6, Alt+F7, Alt+F8, Alt+F9, Ctrl+F7**, Esc | F5, F8, F9, F4, F6, F7, Esc (DayBook.tsx:81–89) | **six chords advertised, never fire** (D-2) |
| VoucherScreen | Ctrl+A, F2, F12, **Alt+G, Alt+T**, Alt+R, Alt+F1, Esc | Ctrl+A, Esc, Alt+F1, Alt+R (VoucherScreen.tsx:403–410) | **Alt+G, Alt+T never fire; panel buttons also dead** (D-1); F2/F12 are focus shortcuts without hotkeys (acceptable — clicking the chip focuses the input) |
| Reports | Alt+F1, Esc | Alt+F1, Esc (Reports.tsx:61–64) | none |
| MasterPage | Esc | Esc (MasterPage.tsx:122–124) | none |
| Settings/Import/Cheque/Payroll | Esc | Esc | none |

**F1 (Tally's "help/context") is advertised nowhere** — fine, out of scope.

## 5. Findings

### D-1 (P2) — VoucherScreen: Alt+G / Alt+T advertised but dead
**Evidence:** VoucherScreen.tsx:416 `[{ key: "Alt+G", label: "Apply GST" }]` and :418 `{ key: "Alt+T", label: "Deduct TDS" }` — no `onClick` property (compare :413 Ctrl+A, :414 F2, which have one). The hotkeys map (:403–410) has no `"Alt+G"`/`"Alt+T"`. `Shell.tsx:75` renders `onClick={f.onClick}` — undefined = inert button.
**Why dangerous (product-integrity, not data):** the F-key panel is the product's contract with the keyboard-first operator. A chip that does nothing on click *and* has no chord is a broken promise on the most-used screen in the app. The functions themselves exist (`applyGst` :189, `applyTds` :256) on inline buttons (:661, :664) — the wiring just stops short.
**Test-suite interaction (important):** run.js:652 clicks `aside button:has-text("Deduct TDS")` and asserts the helper inserts **nothing** (F-TDS-01, section masters unusable). It passes *partly because the aside button is dead*. Wiring `onClick: applyTds` keeps the assertion true (applyTds with unusable sections inserts nothing — the inline-button behavior the suites already pin via driver `clickApplyTds`). run.js:900–910's Alt+G probe records both outcomes (inert-conclusive / applied) so it tolerates the fix. Full battery re-run is mandatory regardless.

### D-2 (P2) — Day Book: six advertised chords never fire
**Evidence:** panel lists all twelve keys (DayBook.tsx:91–103); map registers six (:81–89). The engine already normalizes `Alt+F5` etc. (hotkeys.ts:15), so adding six map entries is the whole fix. driver.js:185–189 (`CLICK_OPEN`, "App quirk … button-only (no keyboard handler)") is the test suite *documenting the defect* and routing around it.
**Note:** Ctrl+F7 (Physical Stock) needs no new engine support (Ctrl+F-keys are captured, hotkeys.ts:15 ternary).

### D-3 (P3) — Day Book row affordance lies
**Evidence:** DayBook.tsx:139 `<tr className="row-link …">` with no onClick; the row's only actions are Alter/Cancel/Del text buttons (:166–170). index.css:34 `.row-link { cursor-pointer; hover:bg-indigo-50 }`. Contrast: Reports.tsx:447 rows navigate to voucher edit; :309/:422 rows navigate to ledger-vouchers. The hover highlight on a non-navigating row is a false affordance; the fix (row click → `/company/:cid/voucher/:id/edit`) matches the established drill-down target, with `e.stopPropagation()` added to the three existing action buttons so Cancel/Del/uncancel don't ALSO trigger navigation.

### D-4 (P3, polish — optional in scope) — no arrow-key row navigation in the voucher grid
Tally moves between grid rows with ↑/↓. zprime's grid supports Enter-on-last-row (VoucherScreen.tsx:624–630) and browser-default Tab order. Arrow-key row traversal is genuine Tally-parity polish but touches many inputs and the browser locators. Recommend **defer** (recorded as the known follow-up) to keep R-34's blast radius on the three confirmed defects.

### NOT A BUG — VERIFIED
- **Esc semantics are consistent and complete:** every screen maps Esc (Gateway back, Day Book → Gateway, Voucher → Day Book, Reports → Gateway, masters close, settings/import back). Esc-chaining reaches every screen from every screen. Verified per-screen above.
- **Report drill-down chain is intact:** TB/BS/PL/Outstanding rows → ledger-vouchers (with ledgerId state) → voucher rows → voucher edit. Register rows → register reports. The Day Book row (D-3) is the only hole.
- **TypeAhead keyboard support** (ArrowUp/Down/Enter, TypeAhead.tsx:43–45) is correct.

### Deliberately out of scope (recorded, not investigated as defects)
- Alt+C create-ledger-on-the-fly inside voucher entry (Tally parity; a real feature — new modal + API call — belongs to its own approved scope, not a UX-defect fix).
- Grid arrow navigation (D-4, deferred above).
- Header "← Back (Esc)" tooltip precision (cosmetic, P4).

## 6. Blast Radius Analysis (for the recommended fix)

| Change | Files | Risk | Mitigation |
|---|---|---|---|
| Alt+G/Alt+T onClick + hotkey entries | VoucherScreen.tsx | F-TDS-01/Alt+G-probe assertions (run.js:637–655, 900–910) — analyzed above, both tolerate the fix | full battery re-run |
| Six Day Book chords | DayBook.tsx | driver `CLICK_OPEN` workaround becomes stale — update driver to press the real key (click as fallback), keeping suites honest | run.js + r-suites re-run |
| Day Book row click → edit | DayBook.tsx (+ stopPropagation on the 3 action buttons) | any test clicking a row button would bubble to the new row handler — stopPropagation prevents; no test currently clicks the bare row | full battery re-run |
| New browser suite r34_ui.js (~10–14 checks) | scripts/acceptance/ | additive only | — |

**No server file, no schema, no migration, no accounting path touched.** The verification estate grows; nothing existing is weakened. The `CLICK_OPEN` driver comment ("App quirk") should be deleted together with the workaround — the quirk ceases to exist.

## 7. Scope Options

- **Option A (recommended, ≈ v1.33.0):** fix D-1, D-2, D-3 exactly as scoped in §6 + r34_ui.js driving every fixed affordance with real key presses (chord opens the right voucher type for all six; Alt+G applies GST via keyboard; Alt+T applies TDS via keyboard; Day Book row click opens the voucher; action buttons still work without navigating). Client-only.
- **Option B:** A + D-4 arrow-key grid navigation. More UI churn, higher locator risk — recommend as its own follow-up.
- **Option C:** A + Alt+C ledger-on-the-fly. A feature, not a fix — needs separate approval.
- **Option D:** defer the backlog. Legitimate but leaves the product's headline identity (keyboard-first) partially unwired on its most-used screen.

## 8. Prioritized Findings Table

| ID | Area | Finding | Severity | Actual defect? | Reproducible | Existing coverage | Recommended action | R-34 candidate |
|---|---|---|---|---|---|---|---|---|
| D-1 | Voucher entry | Alt+G/Alt+T chips + chords dead | P2 | YES | YES (click chip → nothing) | run.js clicks inline-equivalent paths only | wire onClick + hotkeys (A) | YES |
| D-2 | Day Book | six advertised chords never fire; test suite documents it as an "App quirk" | P2 | YES | YES (press Alt+F6 → nothing) | driver CLICK_OPEN workaround | add six map entries (A) | YES |
| D-3 | Day Book | row-link affordance without navigation | P3 | YES | YES (hover + click → nothing) | none | row click → voucher edit + stopPropagation (A) | YES |
| D-4 | Voucher grid | no arrow-key row navigation | P3 | polish gap | n/a | none | defer (own scope) | no |
| D-5 | Voucher entry | no Alt+C ledger-on-the-fly | P4 | feature gap | n/a | none | postpone (own feature) | no |
| D-6 | Shell | back-arrow tooltip says "Esc" (Esc is per-screen) | P4 | cosmetic | n/a | none | fold into A or skip | optional |

## 9. Security / Accounting Regression Check

Client-only scope: no route, no cid(), no posting, no report math. The only behavioral server interaction added is navigation to existing pages. No new trust surfaces, no request-shape changes. R-33's advisory fetch and the Apply helpers' server contract are untouched — only their *triggering* gains keyboard paths that already existed as buttons.

## 10. Final Recommendation

`R-04`-style discipline: the three defects are small, honest, and independently reproducible; the fix is client-only with an enumerated blast radius; the verification story is strong (real-key-press browser checks). **Option A is recommended as R-34 ≈ v1.33.0.**

**R-34 title:** "Keyboard integrity: wire the advertised keys and the Day Book drill-down."
**Implementation requirements:** VoucherScreen Alt+G/Alt+T wiring; Day Book six chord entries; Day Book row navigation + stopPropagation; driver CLICK_OPEN removal; r34_ui.js (~10–14 checks); full Python + browser batteries on a fresh volume; typecheck; no schema.
**Acceptance criteria:** every chip printed on a panel fires on key press; every chip fires on click; Day Book row click opens the voucher; Cancel/Del/uncancel do not navigate; 1197+ automated and 399+ browser checks remain green; no accounting assertion changes.

---

**Final verdict:**

# R-34 CONFIRMED — GENUINE UX DEFECTS, FULLY SCOPED

Awaiting human review of scope (A / B / C / D) before any implementation. No code has been changed.
