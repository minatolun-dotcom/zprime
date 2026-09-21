# R-38 Investigation — zprime v1.36.0 · Payee-Threshold Table on the TDS/TCS Report Pages (R-37 Option B)

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-38 CONFIRMED — GENUINE VISIBILITY GAP, FULLY SCOPED` (R-37's explicitly deferred Option B; no P0/P1 defect — the per-payee data shipped in v1.36.0 is correct but API-only; this is an approved-feature investigation).
**Baseline:** HEAD `231a486b24b0b1ba94f04273f0b14a202af8fa45` = tag `v1.36.0` (pushed, one ledger-docs commit ahead, `v1.36.0-1-g231a486`); working tree clean apart from the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md` (and `scripts/__pycache__/`). No source, test, migration, or doc file modified.

---

## 1. Executive Summary

R-37 shipped the per-payee FY TDS/TCS engine — but only as **API data**. `grep -r fyAggregates client/src` returns **zero hits**: the TDS and TCS report pages (`TdsView`/`TcsView` in Reports.tsx) render *period* deductions/remittances/payable-balance cards and never touch the `fyAggregates` (or their `payees[]` arrays) riding the payload. The operator who asks R-37's core question — *"to which payees do I owe TDS from the next payment?"* — must currently call the API by hand. The answer exists server-side; the UI just doesn't show it.

**The enabling discovery: no server change is needed at all.** The TDS/TCS report payloads already carry `fyAggregates[]` with nested `payees[]` (R-36.0 tree: `{ ledgerId, ledgerName, hasPan, fyAmount, maxSingle, count, threshold, thresholdMode }` per section). The gap is purely one render component + one optional status computation — a pure client feature.

**Recommended scope (Option A, ≈ v1.37.0):** a **"FY Threshold Status (per payee)"** card on both TdsView and TcsView — one table per section that has a threshold or postings: Payee · PAN · This FY (base) · Threshold · Status (Over ✓ paid color / Near ⚠ amber / Under slate / No threshold slate) — driven **entirely by the payload the reports already return** (per-payee over/near computed client-side from `fyAmount`/`maxSingle` vs `threshold`+`thresholdMode`, mirroring the server's exact formula). Advisory-only framing on the card ("informational — nothing is withheld or blocked"). ~10–12 browser checks in `r38_ui.js` driving the real report pages with API-seeded fixtures. No server file, no schema, no accounting surface.

## 2. Baseline Integrity

- `git rev-parse HEAD` → `231a486b24b0b1ba94f04273f0b14a202af8fa45`; `git describe --tags` → `v1.36.0-1-g231a486`; tag `v1.36.0` → `740d016…` verified; remote matches.
- Verification estate: 1222 automated + 480 browser; 38 immutable tags.

## 3. Current Report Surface (evidence)

- **Reports.tsx** (client/src/pages/Reports.tsx): one generic page — `ENDPOINTS` map (`tds: "tds"`, `tcs: "tcs"`), `useQuery` on `/api/c/{cid}/reports/{tds|tcs}?from&to`, then `key === "tds" && data && <TdsView data={data} />` (:122–123).
- **TdsView** (:840–883): three cards — *Deductions by Section* (`data.sections`: section/count/amount, **period**-scoped), *Remittances in Period*, *TDS Payable Balance (Outstanding)*. **Does not read `data.fyAggregates`** (zero references).
- **TcsView** (:885–935): mirror image — *Collections by Section*, *Remittances in Period*, *TCS Payable Balance*. Same gap.
- **The data is already there:** server `/reports/tds` + `/reports/tcs` return `fyAggregates: await tdsTcsFyAggregates(c, ...)` (R-33), which since R-37 nests `payees[]` per section with `threshold`/`thresholdMode` on the section row.
- **No competing consumer:** `threshold-check`/`advisories` appear nowhere in Reports.tsx — the only client consumer of advisory wordings is VoucherScreen's amber strip (R-33). The new card is additive, not a second rendering of the same screen.
- **Navigation for tests:** r27_ui already drives `/company/{cid}/reports/tcs` and waits on `"Collections by Section"` — the exact conventions r38_ui needs.

## 4. The Gap

- Per-payee threshold truth (R-37's whole point) is invisible in the UI.
- The period cards show *what was deducted this period*; nothing shows *where each payee stands against the threshold for the FY* — the forward-looking compliance question.
- Reports.tsx never reads `fyAggregates` — the field is dead weight on the client.

## 5. Design (for approval)

- **New shared component `FyPayeeThresholdCard({ fyAggregates, dutyHead })`** rendered by both views (bottom of the grid, full width):
  - One block per section in `fyAggregates` (already filtered server-side to sections with a threshold or postings), header: `Section {section} · threshold ₹N · {mode === "single" ? "per-payment threshold" : "FY aggregate threshold"} · FY-to-date {fyWindow}`.
  - One row per payee: **Payee** (ledgerName) · **PAN** (hasPan → "on file" / "not recorded" slate) · **This FY** (fyAmount, en-IN) · **Largest single** (maxSingle) · **Status** — computed client-side with the server's exact formula: aggregate mode → `fyAmount >= threshold` over, `>= 0.8×threshold` near; single mode → `maxSingle` compared the same way. Colors: over = amber-strong (`text-amber-700 bg-amber-50`, matching the R-33 advisory strip family), near = amber, under = slate, no-threshold = slate with the honest "confirm applicability manually" text.
  - Section rollup line beneath the payee rows: `Section total ₹X across payees` — the R-37 label, preserving "the sum never masquerades as per-payee truth" in the UI.
  - Card footer: `FY-to-date informational thresholds — nothing is withheld or blocked; TDS/TCS judgment remains the operator's.` (A-04 posture, stated in the product.)
- **Empty states:** sections with `threshold <= 0` and no payees → the block renders the honest no-threshold line only; `fyAggregates` empty → card renders "No section declarations with FY activity".
- **TcsView parity:** identical card; the dutyHead only changes the header wording (collection vs payment base).

## 6. Blast Radius Analysis

| Change | Files | Risk | Mitigation |
|---|---|---|---|
| `FyPayeeThresholdCard` component + render in TdsView/TcsView | Reports.tsx | new card on an existing page — zero behavioral change to other views | additive; existing r27_ui assertions (Collections by Section, remittance, outstanding) untouched |
| New `r38_ui.js` (~10–12 checks) | scripts/acceptance/ | additive | — |

**No server file, no schema, no migration, no accounting-math change.** Pure client addition; the page's other cards untouched.

## 7. Security / Accounting Check

- The card renders data the cid-gated report endpoints already returned to this member — no new authorization surface, no extra fetches.
- Read-only rendering; no posting, voucher, or master interaction. Status math is a mirror of the server's advisory formula (and advisory-only by design).

## 8. Test Plan (for approval)

- **r38_ui.js (~10–12 checks, real UI):** company with two 194J payees (A with GSTIN ₹40k→near, B without ₹72k→over) + one 194C single-mode payee; navigate to `/reports/tds`: card renders per-section blocks; payee A row shows "near" status + PAN on file; payee B row shows "over" + "not recorded" + the amber styling; section rollup line reads "across payees"; threshold figure appears; no-threshold section shows the honest wording; TCS page: card renders (empty or with data honestly); no page errors.
- **Python:** no new checks required — the card renders existing endpoint payloads (already covered by 20 R-37 + 22 R-33 checks); battery re-run proves no regression.

## 9. Scope Options

- **Option A (recommended, ≈ v1.37.0):** the card on both report pages + r38_ui.js. Minimal, complete, zero server diff.
- **Option B:** A + also render the card's data inside VoucherScreen's advisory strip area — rejected: the strip is a moment-in-time nudge during entry; duplicating FY tables there clutters the entry flow. The report page is the right home.
- **Option C:** A + CSV export of the payee table — small, but no operator has asked; defer to demand.
- **Option D:** defer — legitimate; the data is API-available today.

## 10. R-38 Scope Statement (if approved)

**Title:** "FY threshold status, per payee, on the TDS/TCS report pages."
**Requirements:** `FyPayeeThresholdCard` in Reports.tsx rendered by TdsView + TcsView from the existing payload; client-side status formula mirroring the server's; rollup + advisory-only footer; r38_ui.js (~10–12 checks); typecheck; full Python + browser batteries on a verified-fresh volume; no server diff.
**Acceptance criteria:** the payee table renders with correct per-payee over/near statuses from seeded fixtures; existing suites untouched and green; 1222+ automated and 480+ browser checks remain green.

---

**Final verdict:**

# R-38 CONFIRMED — GENUINE VISIBILITY GAP, FULLY SCOPED

Awaiting human review of scope (A / B / C / D) before any implementation. No code has been changed.
