# R-11 Investigation — zprime v1.10.0 · B-11 Purchase-Return / Debit-Note Coverage

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `NO P1/P2 DEFECT CONFIRMED — TEST HARDENING / READINESS REVIEW RECOMMENDED` (B-11 reclassified: CONFIRMED coverage gap, no defect found).
**Baseline:** HEAD `1ffcad28962807394f688e5fe3de3ddfa5d00d92` = tag `v1.10.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified. All probe data lived in the disposable docker stack and was fully deleted (verified: 8 vouchers + company removed).

---

## 1. Executive Summary

B-11 claimed *"Purchase return / Debit Note flows untested — no suite coverage (P2)"*. The investigation **confirms the coverage gap is real** but **finds no defect**: on live v1.10.0, the complete supplier-side bill-wise lifecycle — purchase bill → Debit Note settling it (mixed-sign `against_ref` against a negative open bill) → partial payment → AP netting → advance-to-creditor → advance netted against a later purchase bill → adversarial over-/wrong-direction settlement attempts → GSTR-1/3B ITC reversal → stock restoration → TB/BS identity — **behaves correctly at every step**.

The credit-side (debtors) path has deep adversarial coverage (fix_regression BUG-002, 13+ checks) and the reconciliation engine models CN/DN independently; the supplier side has only incidental coverage (one partial payment in reconcile.py, one no-bill DN in the R-05 block, two full-suite DN postings with party rows but no explicit AP assertions). The single most valuable missing artifact is a **purchase-side settlement regression block** in `final_regression.py` mirroring BUG-002's adversarial rigor, plus **explicit AP assertions in reconcile.py's hand-computed scenario**.

No code change is warranted. The correct R-11 outcome is a **test-hardening-only** change (per the action plan's own classification: *"Regression scenarios"*, not a bug fix).

## 2. Baseline Integrity

- `git rev-parse HEAD` → `1ffcad28962807394f688e5fe3de3ddfa5d00d92`
- `git describe --tags` → `v1.10.0`
- `git status --short` → `?? ZLEDGER_PRODUCTION_ACTION_PLAN.md` only (intentional)
- Test baseline at v1.10.0: Python 813/813, browser 208/208 (recorded in RELEASES.md)

## 3. B-11 Original Claim (action plan §15)

> | B-11 | Purchase return / Debit Note flows untested | No suite coverage | P2 | — | Regression scenarios |

And §17.5: *"supplier-side (Sundry Creditors) settlement flows are under-tested relative to debtors — the code is symmetric, but nothing proves purchase-bill settlements at regression level."*

Both statements verified accurate against v1.10.0 source and suites.

## 4. Architecture: There Is No Separate "Purchase Return" Route

zprime models returns/amendments as **standard voucher types**: `Credit Note` (CRN, affectsStock) and `Debit Note` (DRN, affectsStock) — seeded in `server/src/lib/defaults.ts:60-61`. They flow through the same `POST /vouchers` → `insertVoucherTx` path as every other voucher, which already runs the full guard chain: `assertTypeTx` → `assertLedgersTx` → `assertRefsTx` → `validateEntries` → `assertStockAvailabilityTx` → `validateBillsTx` (server/src/routes/vouchers.ts:425-433). No dedicated purchase-return code path exists — so the B-11 question reduces to: **does the shared machinery behave correctly for supplier-side flows, and is that proven by tests?**

## 5. Existing Coverage — Exact Map

| Suite | Supplier-side content | Bill-wise? | Explicit AP assertion? |
|---|---|---|---|
| `fix_regression.py` BUG-002 | **Debtor-only**: 13+ adversarial allocation checks (wrong party, nonexistent bill, over-entry, over-open, direction, non-billwise, zero, partial, full, split-entry over-allocation, advance) — all `Sundry Debtors`/Receipts | yes | AR implicitly |
| `reconcile.py` | Purchase PUR-1 `new_ref` → partial Payment `against_ref` (30,000 of 59,000) → hand-computed **BP: Sigma open PUR-1 = -29,000** | yes | **yes (one)** |
| `reconcile.py` R-05 block | DN-1 vs Sigma — but **on-account, no bill allocation** | no | no |
| `final_regression.py` R-05 block | DN vs supplier with party row, no bills | no | no |
| `attack_test.py` / `attack2.py` | no purchase-bill scenarios found | — | — |
| `acceptance/run.js` (browser) | DN-1 vs Sunrise Agencies with inventory + party row; full-suite engine models CN/DN payables — **but the DN carries no bill allocation** | no | engine-side only |
| `smoke_test.py` | creditor created; payables total checked once | no | total only |
| `acceptance/engine.py` | models DN as `add_out` (stock) and includes CN/DN in party voucher set — **independent expectation machinery exists** | yes | yes |

**Gap confirmed:** nowhere in the Python suites does a Debit Note settle a purchase bill; nowhere are creditor-side adversarial allocation cases (wrong party, over-open, direction, split-entry) exercised; reconcile.py's single BP check is the only hand-computed AP assertion. The engine *can* verify these (browser full-suite months end with payables checked against independent expectations), but the regression-level Python battery does not.

## 6. Live Probe Results (v1.10.0, disposable company, real HTTP)

**Probe 1 — supplier lifecycle (20/24 checks passed; all 4 "failures" were probe bugs, see §7):**

| Step | Result |
|---|---|
| Purchase 5,900 on `new_ref` PUR-1 | 200; AP: PUR-1 open **-5,900**; AP total -5,900 |
| **Debit Note 2,180 settling PUR-1 via `against_ref`** (positive allocation vs negative open bill) | **200**; AP: PUR-1 net **-3,720** |
| Payment 3,720 `against_ref` remainder | 200; vendor **fully settled** (absent from AP) |
| Stock after DN return (100 − 40 units) | closing **60** ✓ (inventory restoration works) |
| GSTR-1 Sep | B2B/net taxable **0** (inward supplies correctly not reported as outward) |
| GSTR-3B Sep | ITC CGST/SGST = **360** each (450 − 90 DN reversal) ✓ |
| Advance to creditor (`advance`, -1,000) → purchase PUR-2 (-800) | 200; AP: ADV-V1 -1,000, PUR-2 -800 |
| Over-settlement attempt (+500 vs -1,000 open) | **200 — correct**: 500 < 1,000 open is a legal partial settle (probe mislabeled it) |
| TB / BS | **balanced / difference 0** after every stage |

**Probe 2 — corrected adversarial (6/8; the 2 "failures" are app-rejecting-probe, i.e. correct):**

| Check | Result |
|---|---|
| T1: true over-settlement +1,500 vs ADV-V1 open -500 | **400** rejected ✓ |
| T2: direction-mismatched allocation (-400 `against_ref` on a negative bill) | **400** rejected ✓ |
| T3: same-sign `against_ref` (+800 and -800 settling two negative bills) | **400** — `"Bill \"ADV-V1\" is not open in the expected direction"` — **correct**: against_ref must always oppose the bill's sign; same-sign allocations are a semantic error, and the advance-consumption pattern is instead expressed as two opposing entries (proven working in T4's split-allocation shape) |
| T4: one entry settling two open bills (split allocations +300/+300) | **200**; AP shows each bill reduced ✓ |
| TB after all flows | balanced ✓ |

## 7. Probe "Failures" Disposition — All Probe Bugs, NOT App Bugs

1. *"journal nets advance against purchase bill"* 409 — my probe reused `billType: "advance"` for the consumption allocation. The A-02 uniqueness invariant correctly treats a second `advance` allocation with the same bill name as a NEW bill. Correct app behavior; probe bug.
2. *AP after netting* — consequence of (1). Correct app behavior.
3. *"over-settlement rejected"* 200 — 500 against a -1,000 open bill is a legal partial settlement, not an over-settlement. Probe bug. True over-settlement (T1) is rejected 400.
4. *cleanup DELETE /companies* 400 — **verified correct (NOT A BUG)**: by design there is no company-deletion route (R-03 investigation finding, retained deliberately). Cleanup done via SQL in the disposable stack instead.

## 8. GST / Inventory Cross-Checks (purchase side)

- **GSTR-1:** purchases and purchase-side Debit Notes are excluded from outward supplies (B2B/net = 0 in a purchases-only month) — matches GST law: inward supplies are not reported in GSTR-1; the DN reduces ITC via GSTR-2A/3B mechanics, not GSTR-1.
- **GSTR-3B:** DN duty reversals flow into ITC correctly (−90 per probe). R-05's May-window test already proves the periodic/independent identity (`netCgst − ITC == CGST ledger net credit`) including a DN.
- **Inventory:** DN with `inventoryEntries` restores stock (60 units after returning 40) and stock valuation remains coherent (TB balanced, BS difference 0). The independent engine models DN as `add_out` — consistent.

## 9. Security Review (regression-level)

No new surface: DN/purchase flows run through `cid()`-authorized, company-scoped routes with the R-08 master-reference validation and R-10 idempotency available. No authentication or authorization change since v1.10.0. **R-03 security status: GREEN (no regression).**

## 10. Root Cause of the Original P2 Classification

The action plan graded B-11 as a *defect-class* item ("flows untested" → P2) in a table where "no suite coverage" reads like missing functionality. The investigation shows the flows are **implemented, guarded, and correct**; only the proof is missing. Reclassified: **TEST-COVERAGE GAP** (the plan's own "Regression scenarios" remedy was right).

## 11. Findings Table

| ID | Area | Finding | Status | Severity | Reproducible | Existing Coverage | Evidence | Recommended Action | R-11 candidate |
|---|---|---|---|---|---|---|---|---|---|
| B-11 | Outstanding/billing | Purchase-side bill-wise settlement + DN flows have no Python regression coverage | CONFIRMED (coverage gap) | **P3** (downgraded from P2: no defect behind it) | yes (gap demonstrable) | engine-side only | §5 coverage map, §6 probes | Add purchase-side settlement regression block | **YES — test-hardening only** |
| F-11-1 | Voucher validation | `against_ref` is direction-strict (same-sign allocation rejected 400 with clear message) | NOT A BUG — VERIFIED | P4 | yes | T2/T3 | §6 probe 2 | Document in report only | no |
| F-11-2 | Bill allocation | One entry may settle two open bills via split allocations | NOT A BUG — VERIFIED (useful, works) | P4 | yes | T4 | §6 probe 2 | Cover in new regression block | no |
| F-11-3 | Companies | No company-deletion route (DELETE /companies 400) | NOT A BUG — VERIFIED (deliberate, R-03) | P4 | yes | prior investigation | §7.4 | none | no |

## 12. Non-Bugs Verified

- **Direction-strict `against_ref`** — F-11-1 above: same-sign allocation attempts are rejected with an actionable message; the legitimate advance-netting pattern (two opposing entries, or split allocations) works.
- **Mixed-sign settlement** — positive DN/Payment allocations against negative purchase bills settle correctly with exact open-amount arithmetic (probes 1 & 2).
- **Split-allocation multi-bill settlement** — F-11-2.
- **No company-deletion route** — F-11-3.
- **A-02 bill-name uniqueness on `advance` reuse** — probe-1's 409 is the invariant working as designed.

## 13. Out-of-Scope Items

- GST purchase-register report (exists in reports; separate reporting surface, untouched here).
- e-Way bill / e-invoice / GSTR-9 / RCM (postponed per action plan Phase 7).
- Any change to `validateBillsTx` semantics — none warranted.
- Company deletion (deliberately absent).

## 14. Final Recommendation

**NO P1/P2 DEFECT CONFIRMED — TEST HARDENING / READINESS REVIEW RECOMMENDED**

R-11, if approved, is a **test-only change** (no source, no migration):

1. `final_regression.py` — new **R-11 block (~15 checks)**: creditor-side mirror of BUG-002 (wrong-party, nonexistent bill, over-open, direction mismatch, split-entry over-allocation on the creditor), DN-settles-purchase-bill (mixed-sign), advance-to-creditor → netted against a later purchase bill, split-allocation multi-bill settlement, GSTR-3B ITC reversal from a DN, AP report assertions at each stage, TB balanced throughout.
2. `reconcile.py` — extend the hand-computed scenario with a **Debit Note against PUR-1 with `against_ref`** and independent expected values woven into the existing BP/TB/BS assertions (the R-05 DN there stays on-account for its May-window purpose; add the bill-wise DN as a separate April transaction with recomputed expectations).
3. `acceptance/run.js` (optional, browser) — add an explicit bills-payable drill-down check after DN-1 (engine already models it; make the assertion visible at UI level).

Total new checks ≈ 18–20 → new baseline ≈ 831/813→831 Python + 208 browser.

**Severity of doing nothing:** P3 — the code is correct today; the risk is regression protection for the most intricate arithmetic in the app (signed bill netting), which currently has zero purchase-side regression coverage.
