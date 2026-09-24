# R-52 Investigation — zprime v1.49.0 · One-Line Text Fit & Wasted Body Space

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-52 CONFIRMED — INVESTIGATION REQUIRED` (P3 visual-correctness class; every finding live-measured in DOM geometry, not eyeballed).
**Baseline:** HEAD `db035d6aa5a5f659fd8a17da4cad65b07810b637` = `v1.49.0-1-gdb035d6` (release commit `48321d6` = tag `v1.49.0`, pushed, 51 tags); working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source modified.

---

## 1. Method (visual = geometric)

Playwright drove every page at **1366×900 and 1920×900**; an in-page audit measured, per element:
- **real text height** via `Range.getBoundingClientRect()` (element height lies when padding/min-height inflate it — v1 of the sweep did exactly that and was corrected);
- **spare width** in the containing cell/card (`parent width − padding vs text width`);
- **wasted body space**: `main.clientWidth − content container width`.

Findings below are measured facts, each with the numbers.

## 2. The two systemic root causes

### RC-1 — dates snap at their own hyphens (affects ~15 report cells)

`dd-mm-yyyy` contains hyphens = legal break opportunities. Under table pressure the date
column collapses toward the width of the year segment and the date renders as two lines.
**Measured (GSTR-1 @1920):** date text is **42px wide**, cell inner width **72px** on a
**1686px-wide table** — it wraps anyway. ~15 `<td>{fmtDate(...)}</td>` cells across
Reports (Day Book, Cash/Bank, B/R-B/P bills, GSTR-1 B2B/B2C/CDNR, GSTR-9, Cheque Register),
Day Book, ChequePrint share this defect.

### RC-2 — pills are inline text and break mid-word (Day Book rows = the reported case)

Day Book type pill ("Physical Stock", "Delivery Note") is `inline` text: measured **57px
wide × 37px tall = 2 lines**, inside a column squeezed to 112px by table auto-layout —
this stretches **every row to 58px**, and is why Date/links on the right read "compressed"
while the Party column only *guarantees* 200px of the ~1130px available. Same inline-pill
pattern exists in Audit Trail.

## 3. Additional measured findings

| # | Where | Measurement | Issue |
|---|---|---|---|
| 3.1 | fkey rail (all shortcut pages) | 168px card; 6 of 12 Day Book labels wrap to 2 lines ("Stock Journal", "Receipt Note"…) at 1366; ≥1 even at 1920 | rail is 48px narrower than its pre-redesign 216px |
| 3.2 | Whole app (wide monitors) | @1920: content 1280px inside 1728px body → **448px dead margins** on every standard page | `max-w-7xl` caps content while body idles |
| 3.3 | Reports "Back to Gateway" links | wrap to 2 lines inside the 168px rail | same 3.1 root cause |
| 3.4 | Masters tables (# / Name / Opening / Del headers) | measured earlier with inflated metric — verified NOT wrapped (padding) | false positive, excluded |
| 3.5 | Tables with `min-w` columns | the min-width guarantees (200px narration etc.) are floor values; surplus goes to the flexible column only | structural, addressed by the same fix |

## 4. Fix plan (not implemented)

1. **`.cell-nowrap` token** in `index.css` (`white-space: nowrap`): applied to all date
   cells, voucher-number cells, fkey-rail key chips, Day Book type cells.
2. **`.pill` token** (`inline-flex items-center whitespace-nowrap rounded-full …`):
   replaces the four inline pill constructions (Day Book ×3, Audit Trail ×1); the Day
   Book type cell gets `whitespace-nowrap` so multi-pill rows stay on one line (two
   pills on one row is correct, two LINES is not).
3. **fkey rail width**: `w-48` → `w-56` (224px) — measured worst label ("Stock Journal"
   chip+text) needs ~205px; 224px fits with margin. Mobile strip already scrolls.
4. **Content width**: standard pages `max-w-7xl` → `max-w-none` via the existing `wide`
   prop used Shell-wide (content now fills the body; tables breathe exactly as requested).
5. Re-run the geometric sweep → expect zero date/pill/rail wraps; full estate gates.

**Scope guard:** CSS + the four pill class strings only. No logic, no data, no API.

## 5. Non-Bugs Verified

- Masters headers (v1 sweep hits): **NOT A BUG — VERIFIED** — inflated metric; text is
  single-line (the v2 corrected sweep no longer flags them).
- VoucherScreen grids: minmax label sizing already correct; no measured wraps.

## 6. Out of Scope

- Fixed-width artifact `ChequeFace` (print geometry, untouched since R-50).
- Print CSS generally; voucher form (R-50 already handled); data/API surfaces.

---

**R-52 CONFIRMED — INVESTIGATION REQUIRED**
