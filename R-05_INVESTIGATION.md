# R-05 Investigation — zprime v1.4.0
## Credit/Debit-Note (CN/DN) GST reporting — sign inversion + missing CDNR (finding B-06)

---

## 1. Executive Summary

**Finding B-06 from the production action plan is CONFIRMED as a live P1 defect on v1.4.0, and the investigation surfaced a second, structural half the action plan did not fully characterize: GST returns have no CDNR (Table 9B) section at all — credit/debit notes are counted as if they were sales/purchases.**

Reproduced live on the v1.4.0 build (fresh company, July 2026, B2B sale + credit note + purchase + debit note, duty ledgers per the app's own conventions):

| Report | zprime v1.4.0 reports | Correct (per books + GST law) | Error |
|---|---|---|---|
| GSTR-1 B2B taxable | 17,000 | **13,000** (10,000 + 5,000 − 2,000 CN) | CN *adds* 2,000 |
| GSTR-1 B2B CGST | 1,080 | **720** (900 − 180 CN) | CN *adds* 180 |
| GSTR-1 B2B SGST | 1,080 | **720** | CN *adds* 180 |
| GSTR-3B outward taxable | 17,000 | 13,000 | +4,000 |
| GSTR-3B ITC (CGST) | 810 | **630** (720 − 90 DN) | DN *adds* 90 |
| **GSTR-3B net payable** | **1,440** | **1,080** | **+360 of tax never owed** |

The Trial Balance of the same company proves the books are right (CGST ledger nets to a 90 credit = output 720 − CN 180, ITC 720 − DN 90 → net CGST payable 90; total net payable 1,080). **The GST reports disagree with the company's own ledger by construction.** Every filing built from these numbers overstates liability.

Secondary findings: the GSTR-1 payload's `cdnr` field is hardcoded `[]` (Table 9B unimplemented, admitted in-code as "future work"); the UI has no CDNR section; and one direction of the bug (IGST) is currently masked only because an interstate sale reversal wasn't exercised — the code path is symmetric, so an interstate CN would inflate IGST identically.

**Verdict: R-05 CONFIRMED — INVESTIGATION REQUIRED (P1).** Scope: one service file (`server/src/services/gst.ts`), one small UI addition (CDNR table in `Gstr1View`), plus regression tests. No schema change, no migration, no accounting-engine change.

---

## 2. Baseline Integrity

Verified at session start and again after all probes:

```
git rev-parse HEAD   → 2e313ab7636dcca1ec9d0d17708e9c17e9d61fa5  (= tag v1.4.0)
git describe --tags  → v1.4.0
git status --short   → ?? ZLEDGER_PRODUCTION_ACTION_PLAN.md   (intentional, untouched)
```

All probes ran against the running v1.4.0 Docker stack (`localhost:3100`, disposable data in `zprime-db-1`, probe company id 7). No source, test, migration, or documentation file was modified by this investigation. `docker-compose.override.r04.yaml` was removed at release; the stack retains the port mapping only as runtime state.

---

## 3. Source Review — `server/src/services/gst.ts`

The entire GST report surface flows through one service, `voucherGst()`, consumed by exactly two endpoints (`GET /api/c/:cid/reports/gstr1`, `GET /api/c/:cid/reports/gstr3b` — both cid()-authorized per R-03):

1. **Type sets.** `outward = ["Sales", "Credit Note"]`, `inward = ["Purchase", "Debit Note"]`. CNs and DNs are classified as ordinary supplies.
2. **Magnitude aggregation.** Every row is folded with `Math.abs(num(e.amount))` — for taxable rows *and* duty rows. The reversal sign a CN/DN carries in the books is erased.
3. **Dead code as evidence of intent.** `const sign = kind === "outward" ? -1 : 1;` is computed and never used. The reversal direction was anticipated and dropped.
4. **Hardcoded gap.** `gstr1()` returns `cdnr: []` with the in-code comment *"credit notes appear via typeName; kept in b2b/b2c with negative impact future work"* — an explicit, acknowledged defect ("negative impact").
5. **UI.** `Gstr1View` (client/src/pages/Reports.tsx) renders B2B, B2C, HSN only — there is no CDNR/CDNUR section a user could even see. `Gstr3bView` renders Table 3.1/4/net only.
6. **HSN (Table 12)** queries `voucherTypes.name = "Sales"` only — correct per R-01's documented rule, and CNs are *not* netted into Table 12. That decision was correct for R-01's scope, but it left the CDNR relationship open (same comment block).

**Root cause:** `voucherGst()` aggregates CN/DN rows as positive magnitudes instead of reversals, and `gstr1()` has no CDNR section. The books are never touched — this is purely a report-layer defect.

---

## 4. Live Reproduction (v1.4.0, company 7, period 2026-07-01..31)

Setup (all via the public API, the same path a user's browser takes): ledgers with `taxability="taxable"` + `dutyHead` ledgers (CGST/SGST/IGST); intrastate B2B sale 10,000 + CGST 900/SGST 900; interstate B2B sale 5,000 + IGST 900; **Credit Note 2,000 + CGST 180/SGST 180** (party Cr 2,360 — the true reversal); purchase 8,000 + CGST 720/SGST 720; **Debit Note 1,000 + CGST −90/SGST −90**.

| Assertion | Reported | Correct | Verdict |
|---|---|---|---|
| GSTR-1 `b2bTaxable` | 17,000 | 13,000 | ❌ CN added |
| GSTR-1 `b2bCgst` / `b2bSgst` | 1,080 / 1,080 | 720 / 720 | ❌ CN duty added |
| GSTR-1 `b2bIgst` | 900 | 900 | ✓ only because no interstate CN was exercised |
| GSTR-1 `cdnr` | `[]` | 1 CN row (Table 9B) | ❌ unimplemented |
| GSTR-3B outward | 17,000 / 900 / 1,080 / 1,080 | 13,000 / 900 / 720 / 720 | ❌ |
| GSTR-3B ITC | 810 / 810 | 630 / 630 | ❌ DN added |
| GSTR-3B net | **1,440** | **1,080** | ❌ **₹360 tax never owed** |
| Trial Balance (same data) | CGST ledger net = 90 Cr; net payable 1,080 | — | books are correct |

Also reproduced (probe 2): **cancel** the CN → CN row vanishes from GSTR-1/GSTR-3B (totals revert to 15,000/900/900/900); **uncancel** → CN returns. The R-02 cancellation interaction with GST reports is correct (see §7).

Why dangerous: GSTR-1/GSTR-3B are statutory filings. A user who issues any credit note — a routine event — files overstated output tax and understated ITC netting, paying tax on amounts already reversed in the books. The error is silent: the report is internally consistent and matches no warning flag.

---

## 5. The Correct GST Model (target semantics, not implementation)

- **GSTR-1 Table 9B (CDNR):** credit notes against B2B supplies are reported **as their own section** (GSTIN-wise, positive magnitudes, with the note's own rate breakup). B2C notes fall under CDNUR. Table 9 (B2B/B2C) shows net *or* gross depending on filing practice; zprime's cleanest internally-consistent choice, consistent with R-01's "duty heads posted are the truth" canonical rule: **B2B/B2C totals = net outward supplies (sales − CNs); CDNR lists the CNs separately with positive magnitudes.** Sum of Table 9 + Table 9B then reconciles exactly with the ledger.
- **GSTR-3B:** Table 3.1 shows net outward supplies; Table 4 shows eligible ITC net of DN reversals. (Fine-grained 3B sub-tables like 4B/4C remain out of scope; the existing single-row ITC presentation is preserved.)
- **Debit notes** increase the reported base/duty of the supply they amend — with the proposed signed model this happens naturally (a DN posts *positive* duty on the books, so it adds).
- The canonical A-07 rule ("duty heads posted on the voucher are the accounting truth") is preserved: CN/DN duty heads are still reported as posted — only their *direction* is respected instead of erased.

---

## 6. Proposed R-05 Scope (Phase 2, NOT implemented)

1. `server/src/services/gst.ts` — `voucherGst()`: remove `Math.abs()` folding in favor of direction-aware aggregation (CN rows negate within `outward`, DN rows negate within `inward`; sales/purchases unchanged); delete the dead `sign` variable; return per-voucher rows with a `noteDirection`/`isNote` marker. Bounded change: aggregation loop + row marker only. Rate buckets and A-07 mismatch logic keep their shapes.
2. `gstr1()`: populate `cdnr` (B2B notes, positive magnitudes, GSTIN + rate breakup) and `cdnur` (B2C notes); totals become net (Table 9) + separate CDNR sums, so `b2b + cdnr` reconciles with the ledger.
3. `client/src/pages/Reports.tsx` — `Gstr1View`: add a CDNR table (same columns as B2B) and surface `cdnur` as a B2C-style section; `Gstr3bView` needs no structural change (net figures simply become correct).
4. Tests: new R-05 block in `scripts/final_regression.py` (B2B sale + CN intra/inter, purchase + DN; exact GSTR-1 totals incl. cdnr rows; exact 3B outward/ITC/net; cancel/uncancel regression; DN *increasing* a supplier's reported supply), and a `reconcile.py`-style independent-expectation scenario for notes.
5. No schema/migration/JWT change. Both endpoints already cid()-protected.

Regression risks: existing GST expectations in reconcile.py (no notes → identical numbers expected); R-01 HSN assertions untouched (Table 12 stays Sales-only per documented rule); final_regression's documented "credit note NOT netted into HSN" assertion remains valid.

---

## 7. NOT A BUG — VERIFIED (checked during this investigation)

- **R-02 cancel/uncancel × GST reports:** cancelled CN/DN excluded from every GST section (probe: cancel CN → row gone from GSTR-1 and 3B totals; uncancel → restored). Correct.
- **IGST direction:** not separately broken — same `Math.abs()` path; currently "passes" only because no interstate note was posted. The fix must cover IGST (it does, by construction).
- **HSN Table 12 excluding notes:** intentional R-01 decision, re-verified as documented ("credit notes are NOT netted into Table 12"); the R-05 CDNR work completes the story but does not alter Table 12.
- **A-07 supply-mismatch flag:** behaves correctly on note vouchers (duty-heads-win rule unchanged).

---

## 8. Out of Scope (post-investigation)

GSTR-9, e-invoice, e-way bill, TCS, RCM self-invoices, GSTR-2 (abolished), fine-grained 3B sub-tables (4B/4C/5A), CDNUR "exports" sub-classification, portal-ready JSON export. None are prerequisites for the B-06 fix.

---

## 9. Historical Cross-Check (R-01 pattern)

R-01 fixed GSTR-1 HSN contamination by narrowing the Table-12 population to voucher-type semantics. B-06 is the adjacent path R-01 explicitly left open: the same service, the note-type rows, one level up. The lesson holds — fixing one report's population did not fix the sibling's sign model, and the `cdnr: []` comment shows the gap was known. R-05 should close the service-level model (direction-aware aggregation) rather than patching individual totals, so no third adjacent path remains.

---

## 10. Prioritized Finding Table (R-05 investigation scope)

| ID | Area | Finding | Status | Severity | Reproducible | Impact | Coverage | Evidence | Action | R-05? |
|---|---|---|---|---|---|---|---|---|---|---|
| B-06 | GST reports | CN/DN counted as positive supplies; CDNR unimplemented (`cdnr: []`) | CONFIRMED BUG | **P1** | YES (live, company 7) | Statutory overstatement of net tax (₹360 on ₹20k fixture; unbounded in real use) | NONE — no test asserts note treatment in GST reports | gst.ts source + live probes §4 | Direction-aware aggregation + CDNR section (scope §6) | YES |
| — | GST reports | R-02 cancel/uncancel excludes notes correctly | NOT A BUG — VERIFIED | — | YES | — | partial (cancel tests exist, not GST-specific) | probe §7 | optional test | no |
| — | GST reports | HSN Table 12 excludes notes by design | NOT A BUG — VERIFIED | — | — | — | asserted (R-01) | final_regression:754 | none | no |

---

## FINAL VERDICT

# R-05 CONFIRMED — INVESTIGATION REQUIRED

- **Severity:** P1 (statutory GST reports overstate liability; silent; no data corruption; no security impact)
- **Root cause:** `voucherGst()` folds CN/DN rows with `Math.abs()` (reversal sign erased; `sign` computed but dead) and `gstr1()` hardcodes `cdnr: []`
- **Evidence:** live reproduction on v1.4.0 (GSTR-3B net 1,440 vs book truth 1,080; GSTR-1 taxable 17,000 vs 13,000), source audit, zero existing test coverage of notes-in-GST
- **Scope:** `server/src/services/gst.ts` + CDNR table in `client/src/pages/Reports.tsx` + regression tests; no migration, no schema, no accounting-engine change
- **Sequencing note:** per the action plan's original ranking B-01 (negative stock) and B-02 (opening balances) remain next; B-06 is selected first because it is live-reproduced on the current build, has the smallest blast radius, and completes the R-01 GST-integrity thread.
