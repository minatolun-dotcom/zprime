# R-24 Investigation — zprime v1.22.0 · E-invoicing (IRN)

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-24 CONFIRMED — GENUINE COMPLIANCE GAP, FULLY SCOPED`
**Baseline:** HEAD `51fcf246a3535d0e335685b9832707fa809ea7cd` = tag `v1.22.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified.

---

## 1. Executive Summary

zprime can produce every number a GST return needs (R-01/R-05/R-23), but it cannot produce the one artefact a registered supplier must hand the Invoice Registration Portal for B2B supplies: the **NIC e-invoice JSON (schema v1.01)**. Verified gap: `grep -rn "einvoice\|e-invoice\|IRN\|irp" server/src client/src scripts/` → **zero matches**. E-invoicing was explicitly listed in ROADMAP's "out of scope" row — this investigation retires it the same way R-23 retired RCM: it is a bounded, additive report-artefact feature whose data surface almost entirely exists already.

**Recommended scope:** payload **generation + download** (Option A, §5), not live IRP/GSP connectivity. The operator uploads the generated JSON to their chosen IRP channel (NIC portal or a GSP). This matches zprime's self-hosted, no-external-service posture and keeps the blast radius read-only.

---

## 2. Baseline Integrity

- `git rev-parse HEAD` → `51fcf246a3535d0e335685b9832707fa809ea7cd` = `v1.22.0` ✓ (`git describe --tags` → `v1.22.0`)
- `git status --short` → only `?? ZLEDGER_PRODUCTION_ACTION_PLAN.md` (intentional) + this report at write time
- Verification estate at baseline: 964/964 Python + 267/267 browser across 24 immutable tags

## 3. What the IRP Payload Requires (NIC schema v1.01, B2B mandatory set)

| Block | Mandatory fields | Purpose in zprime today |
|---|---|---|
| TranDtls | TaxScheme=`GST`, SupTyp (`B2B`/`B2CL`…) | supply classification exists (`voucherGst.supplyType`, party registration) |
| DocDtls | Typ (`INV`/`CRN`/`DBN`), No, Dt | `vouchers.number`, `vouchers.date`, type name — present |
| SellerDtls | Gstin, LglNm, Addr1, Loc, Pin, Stcd | `companies.gstin/name/address/city/pincode/stateCode` — **all present** |
| BuyerDtls | Gstin, LglNm, Addr1, Pos, Stcd, **Pin** | `ledgers.gstin/name/partyAddress/partyState` + `vouchers.placeOfSupply` (name → code via the existing state map). **Pincode: NOT stored — the one schema gap** |
| ItemList | SlNo, HsnCd, Qty, Unit (UQC), UnitPrice, AssAmt, GstRt, Igst/Cgst/SgstAmt, TotItemAmt | goods: `inventory_entries` (hsn/qty/rate/amount/gstRate snapshots); services: `voucher_entries.hsnSac/gstRate` snapshots; units: `units.symbol` — **symbol ≠ UQC code; needs a mapping** |
| ValDtls | AssVal, CgstVal, SgstVal, IgstVal, RndOffAmt, TotInvVal | `voucherGst()` totals + `r2` rounding — present |

## 4. Data-Source Verification (actual code, v1.22.0)

- **Per-invoice classification**: `voucherGst()` (`gst.ts:64`) already computes per-voucher taxable/IGST/CGST/SGST/cess, POS-vs-state classification with the honest `supplyMismatch` advisory, rate buckets, and R-05 note-sign semantics. An e-invoice for a Sales voucher or Credit Note is a **re-projection of the same verified data**, not a new calculation — accounting math untouched.
- **Line-level detail**: goods lines live in `inventory_entries` (HSN/rate snapshots, signed qty), service lines in `voucher_entries` (hsnSac/gstRate snapshots). The payload builder joins both for the chosen voucher.
- **Bulk surface**: `GET /gstr1` already returns the `b2b`/`cdnr` arrays — the natural per-row anchor for "generate e-invoice JSON" actions in the GSTR-1 view.
- **Type mapping**: `Sales → INV`, `Credit Note → CRN` (scheme only requires these two for the approved scope; Debit Note → DBN if later approved for inward-side use, which NIC does not accept from the supplier side — out of scope).

## 5. Scope Decision — Generation vs Connectivity

- **Option A (recommended): generate + download.** Endpoint `GET /reports/einvoice/:voucherId` (cid-gated) returns the validated NIC v1.01 JSON; client actions on VoucherScreen/DayBook and GSTR-1 B2B/CDNR rows. Operator uploads to the IRP channel of their choice. No network code, no secrets, no external dependency, no new trust surface.
- **Option B (rejected for R-24): live IRP/GSP integration.** Requires GSP credentials, RSA signing of payloads, QR/IRN response handling, network + secret management. Contradicts the product's no-external-service posture (same rationale family as B-12's declined in-product backup surface) and needs a business decision before any code. Documented as future-possible; nothing in Option A blocks it.

## 6. Proposed Scope (§ for review)

1. **Migration `0010`** (additive, no backfill): `ledgers.party_pincode` text NULL + schema field; MasterPage ledger form gains Pincode. (Company pincode already exists.)
2. **Server:** new `server/src/services/einvoice.ts` — `eInvoicePayload(companyId, voucherId)`: type mapping, seller/buyer/POS resolution (existing state-code map), line join, UQC mapping table (code-level: `NOS→NOS, PCS→PCS, KGS→KGS…` with fallback validation), rounding line; **strict mandatory-field validation that reports ALL missing fields at once** ("Buyer PIN code missing — set it on ledger 'Acme Traders'"), never a half-formed payload. Route `GET /reports/einvoice/:voucherId` in `reports.ts` (cid() gate as every report route).
3. **Client:** Download-e-invoice action on GSTR-1 B2B + CDNR rows and in VoucherScreen for eligible vouchers (Sales/Credit Note with registered party); error banner listing the validation gaps.
4. **Tests:** `final_regression.py` +12 R-24 checks → 694 (payload determinism, field validation completeness, B2C/unregistered rejection, credit-note CRN projection, RCM voucher rejection, cross-company 404); new `r24_ui.js` ~10 browser checks → ~277.
5. **Proposed release: v1.23.0 — "e-invoice payload generation (IRP upload)".**

**Blast radius:** additive only — one nullable column, one read-only route, one new service, UI actions. No accounting math, no posting path, no existing report keys change. Engine independence preserved (payload values cross-asserted against `voucherGst` output, not recomputed from production posting code).

## 7. Non-Bugs / Boundary Decisions

- **NOT A BUG — VERIFIED:** GSTR-1 B2B rows carry everything needed for bulk anchoring (party GSTIN, taxable, duty splits); no defect — this is a missing artefact, not a wrong number.
- UQC vs `units.symbol`: a mapping/presentation concern, not a schema defect; documented mapping table in code with validation failure on unknown symbols (operator renames unit to a valid UQC).
- E-way bill / GSTR-9 / TCS remain out of scope (each its own R-cycle).

## 8. Failure Conditions Checked

No migration assumption risk (single nullable column, no backfill); no cid() bypass (route uses the standard gate); no accounting surface; no JWT change. Nothing in this scope can alter posted state — the endpoint is read-only.

## 9. Final Recommendation

Approve Option A scope (§6) → implementation. v1.23.0 as proposed. Do NOT bundle Option B (IRP connectivity) into R-24; it requires a product decision on external services and credential handling first.

**R-24 CONFIRMED — GENUINE COMPLIANCE GAP, FULLY SCOPED**
