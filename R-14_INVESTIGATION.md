# R-14 Investigation — zprime v1.13.0 · TB Health Indicator (Gateway "out of balance" surface)

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-14 CONFIRMED — INVESTIGATION REQUIRED` (one confirmed UX-hardening gap, P3; zero production defects found in the candidate areas).
**Baseline:** HEAD `bb0f1aa7584dcd90ea934e282a9288bf3b0bb15e` = tag `v1.13.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified.

---

## 1. Executive Summary

With B-01…B-12 dispositioned and R-13 closing the last security-class item, the remaining action-plan candidates are the §12 UX items. All three were re-verified against v1.13.0 — and the picture has materially improved since the plan was written:

| Candidate | Plan claim (§12) | v1.13.0 reality | Disposition |
|---|---|---|---|
| 1. VoucherScreen negative-stock warning | "does not warn when a sale would drive an item negative" | Correct **without** a warning: since R-06 the **server rejects** overselling (4xx), so a silent negative can no longer be posted; the client surfaces the server error. A pre-save warning is a convenience nicety, not a correctness gap. | NOT A BUG — VERIFIED (convenience nicety only) |
| 2. TB out-of-balance indicator on Gateway/Dashboard | "would have surfaced B-03 immediately" | **Confirmed gap.** The TB **report page** shows Dr and Cr totals side-by-side but no explicit out-of-balance warning; the **Gateway** has no health surface at all. A user who never opens Trial Balance sees nothing. | **SELECTED as R-14** (P3) |
| 3. Import per-voucher error surfacing | "does not surface per-voucher validation failures before committing" | **Superseded by design**: since R-04 the import is all-or-nothing (single transaction) and rejects with a per-voucher error — live-probed: `400 {"error":"Voucher PRB-2 (Journal): Debits and credits do not balance (difference 200.00)"}`, zero vouchers persisted, TB difference 0. The ImportXml page displays `result.errors` (per-voucher warnings list) after a completed import. | NOT A BUG — VERIFIED (superseded by R-04) |

Live evidence (v1.13.0 stack, disposable company, fully cleaned up afterward): the atomic-import probe above.

Why candidate 2 wins: B-03-class corruption (import bypassing double-entry) is the plan's single most dangerous defect *class*, and R-04's server-side validation is the guard. But a silent books imbalance can still arise from operator data (e.g., opening balances entered asymmetrically — exactly the historical B-02 failure mode) and today the only witness is a person who opens Trial Balance and manually compares two columns. The plan's own rationale: "would have surfaced B-03 immediately." One server field + one client banner closes the loop between the data and the human.

## 2. Baseline Integrity

- `git rev-parse HEAD` → `bb0f1aa7584dcd90ea934e282a9288bf3b0bb15e`
- `git describe --tags` → `v1.13.0`
- `git status --short` → clean except intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`
- Baseline: **854/854** Python (39+88+65+61+572+29) + **208/208** browser.
- Probe cleanup: disposable company + rows deleted via SQL; verified `count(*)=0`; probe script removed.

## 3. Current Architecture Facts (verified in source)

1. `trialBalance()` (`server/src/services/accounting.ts:145`) computes `totalDebit` and `totalCredit` and returns `{ rows, totalDebit, totalCredit }` — **it does not return any difference field**.
2. `TrialBalanceView` (`client/src/pages/Reports.tsx:293`) renders both totals adjacent in the Totals row but adds **no out-of-balance warning**.
3. `BalanceSheetView` **already implements the exact pattern proposed**: amber banner when `Math.abs(data.difference) > 0.004` (`client/src/pages/Reports.tsx:200`), served by the balance-sheet endpoint's `difference` field.
4. `Gateway.tsx` has no TB/health surface.
5. Import (`server/src/routes/import.ts:121+`) returns per-voucher `errors[]`; ImportXml.tsx renders them — plus all-or-nothing atomicity since R-04.

## 4. Proposed R-14 Scope (smallest honest shape — NOT implemented)

**Server (1 file, ~4 lines):** `trialBalance()` returns `difference: r2(totalDebit - totalCredit)` alongside the existing totals. Pure addition; no existing field changes meaning; no accounting calculation touched (it subtracts two already-computed totals for display only — same class as the existing BS `difference`).

**Client (2 files, minimal, pattern-copied):**
1. `TrialBalanceView`: amber banner under the Totals row when `Math.abs(data.difference) > 0.004` — text mirrors the existing BS banner ("Difference in books: X — check opening balances or unposted entries."). Banner only; zero layout/logic change otherwise. Follows the explicit R-14 rule "no redesign".
2. `Gateway`: compact TB health line (e.g., `TB ✓ balanced` / `TB ✗ out by X`) via one lightweight `GET /api/c/:cid/reports/trial-balance` fetch. Gate: only render when fetch succeeds; **degrade silently to nothing on error/empty** so no existing behavior can regress.

**Tests:**
- Browser (new `r14_ui.js`, ~4 checks): balanced company → no banner, health shows balanced; craft an out-of-balance state via an asymmetric opening entry → TB banner visible, Gateway shows out-by; banner disappears once corrected.
- Python (2 checks in `final_regression.py` R-14 block): `difference` field present and 0 for balanced books; equals the injected imbalance for a seeded asymmetric-opening company (API-level, no client assumptions).
- Regression risk: zero behavioral change to any existing endpoint response shape (additive field); browser baseline 208/208 must remain green.

**Out of scope (explicit):** no auto-repair, no opening-journal generator (F-07-2 Model A decision stands), no restructure of TB UI, no new endpoints.

## 5. Prioritized Findings

| ID | Area | Finding | Status | Severity | Reproducible | Existing Coverage | Recommended Action | R-14 |
|---|---|---|---|---|---|---|---|---|
| F-14-1 | UX/Reports | TB has no out-of-balance surface (report page or Gateway) | CONFIRMED (source-verified) | P3 | YES (visual) | none | add `difference` + banner + Gateway health line | YES |
| F-14-2 | UX/Voucher | No pre-save negative-stock warning | NOT A BUG — VERIFIED (server-side guard since R-06 makes it convenience-only) | P4 | — | R-06 suites | optional future polish | no |
| F-14-3 | UX/Import | Import doesn't surface per-voucher errors pre-commit | NOT A BUG — VERIFIED (superseded: R-04 atomic all-or-nothing + per-voucher error; live-probed) | P4 | — | R-04 suites | none needed | no |
| F-14-4 | UX/Settings | No opening-stock journal helper | KNOWN LIMITATION (F-07-2 documented Model A decision in R-07) | P4 | — | — | remains out of scope | no |

## 6. Non-Bugs Verified

- **F-14-2** — the plan's premise ("VoucherScreen does not warn") predates R-06 (v1.6.0). Since R-06, overselling is *rejected by the server*; the UI cannot silently create the corruption the warning was meant to catch. NOT A BUG — VERIFIED.
- **F-14-3** — the plan's premise predates R-04 (v1.4.0). Import is now single-transaction; the unbalanced-voucher probe was rejected atomically with a per-voucher message, and the client renders `result.errors`. NOT A BUG — VERIFIED.

## 7. Final Recommendation

Proceed to HUMAN_REVIEW with the scope in §4. It is the last unaddressed item from the plan's §12 UX list, it is the smallest change that materially shortens the detection path for books imbalance (the B-03/B-02 failure *class*), and the BS banner proves the pattern already exists in the codebase to copy. Zero migration, zero accounting-math change, additive-only API.

**R-14 CONFIRMED — INVESTIGATION REQUIRED**
