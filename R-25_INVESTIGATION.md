# R-25 Investigation — zprime v1.23.0 · E-way Bill (EWB-01)

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-25 CONFIRMED — GENUINE COMPLIANCE GAP, FULLY SCOPED`
**Baseline:** HEAD `ccc5366f747502682224354ea2978499dc907076` = tag `v1.23.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified.

---

## 1. Executive Summary

R-24 gave registered suppliers the e-invoice JSON; the adjacent compliance artefact is the **e-way bill (EWB-01)** — the consignment document required for movement of goods above the ₹50,000 threshold. Verified gap: `grep -rn "eway|e-way|vehicle|transporter" server/src client/src` → **zero matches**. E-way bills were parked in ROADMAP's out-of-scope row; this investigation retires them the same way R-24 retired e-invoicing: a bounded, additive, read-only **payload generation + download** feature with **zero migration**, built almost entirely from data R-24's service already assembles.

**Recommended scope:** Option A (§4) — Part-A generation always; Part-B (vehicle/transporter) as optional request parameters; download-only. No IRP/e-way connectivity, no persisted transport state, no schema change.

## 2. Baseline Integrity

- `git rev-parse HEAD` → `ccc5366f…` = `v1.23.0` ✓ (`git describe --tags` → `v1.23.0`)
- `git status --short` → only `?? ZLEDGER_PRODUCTION_ACTION_PLAN.md` (intentional) + this report at write time
- Verification estate at baseline: 991/991 Python + 285/285 browser across 25 immutable tags

## 3. EWB-01 Requirements vs zprime's Data (v1.23.0, verified in code)

| EWB-01 field | Source in zprime | Present? |
|---|---|---|
| userGstin / fromGstin | `companies.gstin` | ✓ |
| toGstin | `ledgers.gstin` (regular buyer) | ✓ |
| supplyType / subType | fixed `O` / `Supply` for approved scope | ✓ |
| docType / docNo / docDate | `Sales→INV`, `Credit Note→CRN` (same mapping as R-24); `vouchers.number/date` | ✓ |
| from/actFrom/to/actTo state codes | seller state + POS via R-24's state-code map (dispatch-from = seller state; ship-to = POS/buyer — approximation documented) | ✓ |
| taxable + IGST/CGST/SGST values | `voucherGst()` — the verified pipeline | ✓ |
| totInvValue | `voucherGst().total` | ✓ |
| ItemList: HSN, qty, UQC, rate, taxable, rates | `inventory_entries` snapshots + units symbol→UQC (R-24 mapping) — **shared code with `einvoice.ts`, not duplicated** | ✓ |
| Part-B: vehicleNo, mode, transDocNo/Date, transporter | **request-time parameters only** (not persisted — zprime holds no EWB number, so there is nothing to update; Part-B can also be supplied at the portal) | optional |
| HSN validity | EWB wants meaningful HSN digits — validator **fails loudly** on items whose HSN is shorter than 4 digits and warns < 6 | new check |
| Value threshold | consignment value < ₹50,000 → payload carries a **warning** (portal enforces exemption; zprime informs, never blocks) | new advisory |

## 4. Scope Decision — Same Posture as R-24

- **Option A (recommended): generate + download, stateless.** `GET /reports/ewaybill/:voucherId?vehicleNo=&transMode=&transDocNo=&transDocDate=&transporterName=` (all Part-B params optional, cid-gated) returns `{ ok, errors, warnings, payload }`. Zero migration, zero persisted transport state, no network, no credentials. Operator uploads via portal/GSP.
- **Option B (rejected for R-25): live EWB API + EWB-number/vehicle-update persistence.** Requires external-service decision (same family as R-24's deferred connectivity) AND a schema for EWB numbers + transport history. Nothing in Option A blocks it; it is a separate product decision.
- **Reuse discipline:** the goods-line extractor (HSN/qty/UQC/rate/taxable) moves to a shared export used by both `einvoice.ts` and the new `ewaybill.ts` — one source of truth for line projection, both payloads cross-assert the same numbers.

## 5. Proposed Scope (§ for review)

1. **Server:** `services/ewaybill.ts` (Part-A builder + Part-B passthrough + strict all-at-once validation + warnings); small shared-line refactor in `einvoice.ts` (export the goods-line builder; behavior unchanged); `GET /reports/ewaybill/:voucherId` in `reports.ts`. **No migration. No schema change.**
2. **Client:** "e-way" action beside R-24's "e-inv" on GSTR-1 B2B rows; JSON download; amber validation banner; warnings shown as neutral notes.
3. **Tests:** `final_regression.py` +14 R-25 checks → 723 (determinism, state codes, duty vs voucherGst, CRN mapping, HSN short validation, sub-50k warning, Part-B params reflected, no-Part-B payload omits vehicle, non-member 404, e-invoice/e-way totals agreement); new `r25_ui.js` ~10 → ~295.
4. **Proposed release: v1.24.0 — "e-way bill payload generation (Part-A/Part-B)".**

**Blast radius:** one read-only route, one new service, a behavior-preserving export refactor in `einvoice.ts`, UI action. No accounting math, no posting path, no existing report keys, no schema.

## 6. Non-Bugs / Boundary Decisions

- **NOT A BUG — VERIFIED:** `voucherGst()` already computes everything Part-A needs; Delivery Note is not an EWB source document (EWB rides on tax documents — Sales/Credit Note are correct anchors).
- Dispatch-from ≈ seller state is an approximation for the single-godown model zprime has (godowns exist but carry no addresses); documented in code. Multi-godown dispatch addresses belong to the deferred Option B.
- E-way bill for imports/exports/SEZ/job-work sub-types: out of scope; the fixed `Supply` sub-type is the B2B mainstream.

## 7. Failure Conditions Checked

No migration assumption; no cid() bypass (standard gate); no accounting surface; read-only endpoint; no JWT change; shared-line refactor is behavior-preserving and covered by the existing R-24 block (payload must stay byte-identical) plus the new R-25 block.

## 8. Final Recommendation

Approve Option A scope (§5) → implementation. v1.24.0 as proposed. Do NOT bundle Option B (EWB connectivity/persistence).

**R-25 CONFIRMED — GENUINE COMPLIANCE GAP, FULLY SCOPED**
