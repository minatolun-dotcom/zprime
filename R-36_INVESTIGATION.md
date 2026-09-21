# R-36 Investigation — zprime v1.34.0 · D-4 Arrow-Key Grid Navigation

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-36 CONFIRMED — GENUINE UX GAP, FULLY SCOPED` (D-4, the last R-34 deferral; no P0/P1 defect — an approved-feature investigation).
**Baseline:** HEAD `2c912fce2062a343e00c0ad3eab2650bdcd16335` = tag `v1.34.0` (pushed, `v1.34.0-1-g2c912fc` on the ledger-docs commit); working tree clean apart from the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md` (and `scripts/__pycache__/`). No source, test, migration, or doc file modified.

---

## 1. Executive Summary

The voucher grid — the screen an accountant lives in — navigates with **mouse clicks and Tab only**. Arrow keys do nothing between rows: ArrowDown in the ledger cell goes nowhere (when the TypeAhead dropdown is closed, the key is silently ignored), and there is no same-column row movement anywhere in the entries or inventory grids. Tally's grid flows on arrows/Enter without touching the mouse. This is D-4 from R-34's deferred list — the last polish item on that roadmap, and the highest-friction remaining data-entry gap for keyboard-first users.

**The enabling discovery: the interaction model is already arrow-safe.** The hotkey engine (`hotkeys.ts`) registers arrows nowhere; `TypeAhead` owns ArrowUp/Down **only while its dropdown has matches**; and no existing browser suite presses arrows in any grid (verified: zero `ArrowDown`/`ArrowUp` across `scripts/acceptance/*.js`) — suites drive cells with `.fill()`/`pickAhead`, so **locator churn is zero**. The change is purely additive: one `stopPropagation` in TypeAhead (dropdown-open case) plus a tbody-level arrow handler with `data-col` attributes on row inputs. Client-only: no server, no schema, no accounting surface.

**Recommended scope (Option A, ≈ v1.35.0):** ArrowDown/ArrowUp move focus **within the same column** to the next/previous row in the entries grid and the inventory grid; disabled inputs (the against-bill cell when the ledger isn't bill-wise) and selects (godown, kind) are skipped by column mapping; TypeAhead keeps its dropdown arrows when matches are open; **Enter semantics unchanged** (the advertised "Enter on last amount row adds a new line" is load-bearing for tests and muscle memory); Left/Right stay caret keys (editing amounts needs them). ~10–12 new browser checks in `r36_ui.js` with real key presses.

## 2. Baseline Integrity

- `git rev-parse HEAD` → `2c912fce2062a343e00c0ad3eab2650bdcd16335` (ledger-docs commit); `git describe --tags` → `v1.34.0-1-g2c912fc`; tag → release commit `d3ecfc6bfd026eaddfb1bad1e8fdd6eed1198a2e` verified; remote matches.
- Verification estate: 1197 automated + 440 browser; 36 immutable tags.

## 3. Current Grid Model (evidence)

- **Entries grid** (VoucherScreen.tsx ~700–760): per row — ledger `TypeAhead` (ref-collected in `ledgerInputRefs`), against-bill `<input>` (present only when `detailed`, **disabled** unless the ledger is `billWise`), Dr `<input type=number>`, Cr `<input type=number>`, ✕ button. Always-present Total strip row at the bottom (no inputs).
- **Existing keyboard flow:** Enter after a ledger **pick** on the last row focuses the next row's ledger cell (`ledgerInputRefs.current[i+1]`, :716–718); Enter on the **last amount row** appends a row and focuses it (:740–745 — the advertised hint at :796). Everything else: browser Tab order (which **skips disabled inputs silently** — the de-facto column walk) and mouse.
- **Inventory grid** (:615–670): item TypeAhead, godown `<select>` (when `detailed`), kind `<select>` (Stock Journal only), qty/rate numeric inputs, ✕. No ref collection, no keyboard flow at all.
- **TypeAhead** (TypeAhead.tsx:51–52): ArrowDown/Up adjust the dropdown highlight and `preventDefault()` — but only meaningful when `matches.length > 0`; with zero matches the keys fall through, ignored.
- **Hotkey engine** (hotkeys.ts): window-level **capture** listener; matches F-keys, Ctrl+A/H, Alt+digit, Alt+letter, Escape, Alt+Enter — **never plain arrows**. No interference.

## 4. The Gap (D-4)

- No same-column row movement in either grid (grep: `Arrow` in VoucherScreen.tsx → **zero hits** outside the TypeAhead import usage).
- Mouse-first correction workflow: move from row 1's amount to row 2's ledger = mouse click (or Tab through bill/dr/cr and across rows in DOM order).
- Every existing suite drives grids with `.fill()`/`pickAhead` — the arrow layer is invisible to them (verified zero arrow usage in acceptance scripts).

## 5. Interaction Design (for approval)

- **ArrowDown / ArrowUp** (entries grid): from any input in row `i`, focus the input with the **same `data-col`** in row `i±1`; skip disabled inputs (a non-bill-wise row's bill cell has no counterpart target — the map simply misses and focus stays; a bill-wise/non-bill-wise mix therefore degrades gracefully). Down on the last data row: **does not add a row** (the advertised Enter affordance stays unique — Option C rejected).
- **ArrowDown / ArrowUp** (inventory grid): same `data-col` mechanism over item/qty/rate; selects (godown, kind) carry no `data-col` and are never arrow targets (arrowing "into" a select would fight its native option cycling).
- **TypeAhead conflict rule:** when the dropdown is open with matches, ArrowUp/Down keep their dropdown-highlight meaning — implemented by `e.stopPropagation()` in TypeAhead's existing arrow branch; the grid handler (React synthetic, bubbling on `<tbody>`) only sees arrows when the dropdown is closed or empty. Enter-on-zero-matches (R-35) is Enter, not an arrow — untouched.
- **Modifier safety:** the tbody handler ignores arrows with alt/ctrl/meta/shift held (the window-capture hotkeys already matched and prevented Alt-chords before bubbling, but the guard makes intent explicit and blocks future clashes).
- **Left/Right stay caret keys** — amounts are edited in place; hijacking them would break value editing (Option B rejected).
- **Enter unchanged** in all cells. Tab unchanged.

## 6. Blast Radius Analysis

| Change | Files | Risk | Mitigation |
|---|---|---|---|
| `data-col` attributes on entries + inventory row inputs | VoucherScreen.tsx | additive attribute — no styling/test dependency | none needed |
| tbody-level ArrowDown/Up handler (both grids) | VoucherScreen.tsx | could fight TypeAhead arrows or hotkeys | stopPropagation rule + modifier guard; hotkey map has no arrows |
| TypeAhead `stopPropagation` on handled arrows | TypeAhead.tsx | could break Enter-on-zero-matches (r35) | it's Enter-scoped; arrows-only change; r35 re-run proves it |
| New `r36_ui.js` (~10–12 checks) | scripts/acceptance/ | additive | — |

**No server file, no schema, no migration, no accounting-math change.** Zero existing-suite locator churn.

## 7. Security / Accounting Check

Pure client focus movement — no new API calls, no state mutation beyond focus, no trust surface, no posting implications. Cancelled-voucher read-only view is untouched (inputs there are never focused for editing).

## 8. Test Plan (for approval)

- **r36_ui.js (real key presses):** Down/Up same-column movement across three entries rows; column preserved from Dr → next-row Dr; skips the disabled bill cell (non-bill-wise row) and never lands on selects in the inventory grid; TypeAhead dropdown arrows still walk the highlight when matches are open (and don't move the grid cell); arrows don't fire while Alt/Ctrl held; Enter on last amount row still adds a row (regression anchor); Down on last row does NOT add a row; R-35 quick-create + Alt+G flows unaffected; end-to-end voucher save after arrow-driven entry.
- **Python:** no new checks — focus movement has no server trace; the battery re-run proves no regression.

## 9. Scope Options

- **Option A (recommended, ≈ v1.35.0):** as designed — Up/Down same-column in both grids, TypeAhead arrows preserved, Enter/Tab/Left/Right unchanged, r36_ui.js. Client-only, minimal.
- **Option B:** A + Left/Right cell movement — requires caret-position detection to avoid breaking amount editing; brittle for marginal gain.
- **Option C:** A + Down-on-last-row adds a row — competes with the advertised Enter affordance and risks accidental empty-row creation in quick entry.
- **Option D:** defer. Legitimate; the gap is documented, not a defect.

## 10. R-36 Scope Statement (if approved)

**Title:** "Arrow-key grid navigation: the voucher grid moves like a spreadsheet."
**Requirements:** data-col mapping on entries + inventory inputs; tbody arrow handler with disabled-cell skip + modifier guard; TypeAhead arrow stopPropagation; r36_ui.js (~10–12 checks); typecheck; full Python + browser batteries on a verified-fresh volume; no server diff.
**Acceptance criteria:** same-column Up/Down works in both grids; TypeAhead dropdown arrows unaffected; Enter-adds-row unchanged; all existing suites green unchanged; 1197+ automated and 440+ browser checks remain green.

---

**Final verdict:**

# R-36 CONFIRMED — GENUINE UX GAP, FULLY SCOPED

Awaiting human review of scope (A / B / C / D) before any implementation. No code has been changed.
