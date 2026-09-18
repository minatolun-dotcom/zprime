# R-26 Investigation — zprime v1.24.0 · GSTR-9 (Annual Return)

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-26 CONFIRMED — GENUINE COMPLIANCE GAP, FULLY SCOPED`
**Baseline:** HEAD `f352c03b56bc02e5c509a6f30eca7f0838f638dd` = tag `v1.24.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified.

---

## 1. Executive Summary

The last parked GST-family report is the **GSTR-9 annual return**. Verified gap: `grep -rn "gstr9|gstr-9" server/src client/src` → **zero matches**. Unlike the transaction-adjacent R-23/R-24/R-25 cycles, GSTR-9 is a pure **report-family projection**: every number it needs is already computed by `gstr1()` / `gstr3b()` (both FY-parameterizable in one call — no monthly summation) plus the duty-ledger positions `ledgerBalances()` already produces for Table 8's ITC reconciliation. No migration, no accounting math, no new transaction semantics.

**Recommended scope:** Option A (§5) — a `gstr9(companyId, fyStart, fyEnd)` service returning the core tables (4, 5, 6/7, 8, 9, 12, 13) with cross-table consistency checks and honest zero/document limitation rows; Gateway entry + read-only view.

## 2. Baseline Integrity

- `git rev-parse HEAD` → `f352c03b…` = `v1.24.0` ✓ (`git describe --tags` → `v1.24.0`)
- `git status --short` → only `?? ZLEDGER_PRODUCTION_ACTION_PLAN.md` (intentional) + this report at write time
- Verification estate at baseline: 1005/1005 Python + 298/298 browser across 26 immutable tags

## 3. GSTR-9 Requirements vs zprime's Data (v1.24.0, verified in code)

| GSTR-9 table | Source | Derivation |
|---|---|---|
| **Table 4** — Eligible ITC (A: current-yr ITC: A(3) RCM, A(5) regular) | `gstr3b().itc` + `gstr3b().rcmItc` over the FY | one `gstr3b(companyId, fyStart, fyEnd)` call; keys already split regular vs RCM (R-23) |
| **Table 5** — ITC reversals | none | zprime has **no ITC-reversal transaction surface** → honest zeros + a stated limitation (adding reversals is a transaction feature, out of scope) |
| **Table 6/7** — inward/outward supply detail | `gstr3b().outward/inwardRcm` | same call |
| **Table 8** — ITC reconciliation (opening → claimed → closing) | `ledgerBalances(companyId, fyStart, fyEnd)` filtered to `dutyHead ∈ {IGST, CGST, SGST, CESS}` | opening credit position + FY claims (Table 4) → computed closing vs **actual** ledger closing; any gap = unposted/unclaimed ITC, surfaced honestly (R-15's opening-GST semantics: opening position is on the ledger, returns are period-only — Table 8 is exactly where that becomes visible) |
| **Table 9** — supplies declared | `gstr1().totals` + `gstr3b().outward` | b2b/b2c/cdnr/cdnur nets; **cross-check**: GSTR-1 net outward ≈ 3B outward (mismatch rows surfaced, R-01/R-05 semantics guarantee agreement for non-cancelled books) |
| **Table 12/13** — annual HSN (outward/inward) | `gstr1().hsn` over the FY | same population rule as R-01 (Sales-type outward supplies); Table 13 inward deferred (no inward HSN snapshot today — documented) |

Notes: `voucherGst`/`gstr1`/`gstr3b` take from/to — the FY is one query window, so no 12-month aggregation or rounding drift. Amendment tables (10/11) and refund tables are out of scope (no surface) and rendered as explicit "not maintained" rows rather than fake zeros.

## 4. Non-Bugs / Boundary Decisions

- **NOT A BUG — VERIFIED:** R-15 proved GSTR returns are period-only and duty ledgers carry openings; GSTR-9's Table 8 is precisely the honest reconciliation surface for that semantics.
- Table 13 (inward HSN) is a documented limitation: inventory-entry HSN exists, but purchase-side service lines and R-01's outward-only HSN population rule make a full Table 13 a later scope.
- No amendments/late-fee/autofill — zprime reports what the books contain.

## 5. Proposed Scope (§ for review)

1. **Server:** `services/gstr9.ts` — `gstr9(companyId, from, to)` returning `{ table4, table5, table6_7, table8, table9, table12, consistency }`; `consistency` carries the Table 9 vs 3B cross-check and Table 8 closing-vs-ledger gaps. Route `GET /reports/gstr9` (cid-gated) with the standard `period()` helper defaulting to the FY.
2. **Client:** `Gstr9View` in `Reports.tsx` (tables as report-table cards; consistency rows highlighted amber when a gap is non-zero); Gateway Reports card + registry entries (ENDPOINTS/TITLES).
3. **Tests:** `final_regression.py` +12 R-26 checks → 741 (Table 4 = 3B FY aggregate; Table 8 opening→closing reconciliation on duty ledgers incl. an R-15-style unpaired opening surfacing as a gap; Table 9 vs 3B cross-check pass; CDNR netting; Table 12 annual HSN sum; consistency flags flip when a mismatch is injected via unpaired duty); new `r26_ui.js` ~8 → ~306 (Gateway entry, view renders tables, consistency visible, drill from card).
4. **Proposed release: v1.25.0 — "GSTR-9 annual return".**

**Blast radius:** one read-only route, one new service, one view component + registry/Gateway lines. No migration, no accounting math, no existing report keys change; all GSTR-9 numbers are sums of already-tested projections.

## 6. Failure Conditions Checked

No migration assumption; standard cid() gate; read-only endpoint; no JWT change; no existing suites touched (new service, additive route, additive view).

## 7. Final Recommendation

Approve Option A scope (§5) → implementation. v1.25.0 as proposed. Do NOT bundle ITC-reversal transactions, amendments, or Table 13 inward HSN.

**R-26 CONFIRMED — GENUINE COMPLIANCE GAP, FULLY SCOPED**
