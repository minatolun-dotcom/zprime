# R-23 Investigation — zprime v1.21.0 · RCM (Reverse Charge Mechanism)

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-23 CONFIRMED — GENUINE COMPLIANCE GAP, FULLY SCOPED` (approved product decision to open the postponed GST family; no defect in current behavior — v1.21.0 simply has no RCM concept at all).
**Baseline:** HEAD `a3d59ba9…` = tag `v1.21.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source/test/doc modified.

---

## 1. What reverse charge is (and what the user asked for)

Under section 9(3)/9(4) CGST Act, the **recipient** pays GST directly to the government on specified inward supplies (certain goods, GTA, legal services, imports of services, purchases from unregistered suppliers under mandated categories). The supplier does **not** charge the tax. Consequences for the books:

1. The inward voucher (Purchase) posts **no duty lines** — the supplier charged none.
2. The recipient **self-accounts**: Dr expense/purchase, Cr "RCM Payable" duty ledger(s) for the tax they owe.
3. On GSTR-3B, that self-assessed tax appears in **Table 4(A)(3) "Intra-state / Inter-state supplies attracting reverse charge"** (inward-side), and — unlike regular ITC — the RCM liability and its ITC **both** appear: net cash effect nil when ITC is claimed in the same period (4(A)(3) raises liability; 4(B)(2)/(B)(4) style ITC claim offsets it), but **both numbers must be reported**; they are not silently netted to zero.
4. Self-invoicing is required (section 9(3)/31(3)(f)) when buying from an unregistered supplier — a documentation obligation, not an accounting one; a voucher number exists either way in zprime.

## 2. Current v1.21.0 state — verified, no RCM concept exists

`grep -rn "RCM\|rcm" server/src client/src scripts/` → **zero matches**. Everything below is source-verified:

| Layer | Current behavior | RCM relevance |
|---|---|---|
| Ledger master | `taxability` ∈ {taxable, exempt, nil, none}; `gstRegistrationType` ∈ {regular, composition, unregistered, consumer, none}; `dutyHead` ∈ {IGST, CGST, SGST, CESS, TDS} (MasterPage select, seeded ledgers) | The three fields RCM needs **all exist as columns**; only the vocabulary and downstream semantics are missing |
| Posting | Duty lines are ordinary `voucher_entries` on `dutyHead` ledgers; `voucherGst()` classifies a row as duty iff `dutyHead && dutyHead !== "TDS"` | An RCM self-assessed line **posts identically** — the machinery exists; the report must stop treating it as regular ITC |
| `voucherGst()` | Inward rows: `taxableRows` (taxability="taxable", no dutyHead) + `dutyRows` → igst/cgst/sgst/cess per voucher | Today a self-assessed RCM duty line lands in `itc` — indistinguishable from supplier-charged tax. **This is the gap** |
| `gstr3b()` | `outward` (3.1), `itc` (4A aggregate), `net` = outward − ITC | No Table 4(A)(3); an RCM liability currently **reduces** the net payable via the ITC bucket — arithmetically wrong for RCM reporting (liability and ITC are separate table lines) |
| GSTR-3B UI (`Gstr3bView`) | Renders exactly `outward` / `itc` / `net` | Would gain 4(A)(3) + RCM-ITC rows |
| TDS precedent | `dutyHead: "TDS"` ledger; report splits deductions (credits) vs remittances (debits) on that ledger, by section, with payable balances | The exact symmetric pattern: RCM report = liability (credits) vs ITC claimed (debits) per duty head, on an `RCM` duty ledger |
| Import | `classifyTaxability()` + registration-type mapping exist (R-04/B-13) | RCM flag import can reuse the same conventions later (out of R-23 scope) |
| Engine | `gstr3b()`/`gstr3b_app()` mirror outward/itc/net only | Must be extended **independently** (no production-code import) with an RCM mirror |

## 3. Design decisions proposed

1. **Mark RCM at the transaction, not the supplier.** A single supplier can have both RCM and regular purchases (e.g. GTA transport + regular goods). The voucher is the unit of reverse charge. → `vouchers.isRcm` boolean, `NOT NULL DEFAULT false` — zero ambiguity for existing rows (every existing voucher is regular-charge), no backfill, additive migration 0009.
2. **Tax ledger via the existing `dutyHead` vocabulary, extended by one value: `"RCM"`.** No new ledger table, no new FK. Seeding adds one starter ledger "RCM Payable" (`dutyHead: "RCM"`, Duties & Taxes). The TDS report's split-on-duty-ledger pattern replicates exactly.
3. **The gateway rule stays:** every voucher posts Dr=Cr. An RCM purchase = purchase line Dr 590 (or expense Dr 500 + liability Cr 590 split into tax) — the user posts the self-assessed duty lines as ordinary rows; zprime classifies them. No posting engine changes at all.
4. **GSTR-3B gets Table 4 properly:** `inwardRcm` (4(A)(3): taxable + duty from vouchers `isRcm=true`, types Purchase/Debit Note — debit note reversal flows through the existing R-05 sign logic), `rcmItc` (4(B)-style ITC claimed on the same RCM duty), and `net` continues to reconcile to the **ledgers** (outward duty − regular ITC; RCM nets to nil on the ledger and must net to nil on the report — a reconciliation assertion, not a report line).
5. **Self-invoice:** no separate feature. The voucher number (manual or automatic) IS the document; the `isRcm` flag on it satisfies the classification need. Section 31(3)(f) documentation workflow is a later product decision.
6. **Exports/imports/e-commerce 9(5)** explicitly out of scope (different tables, different liability direction).

## 4. Blast radius

- **Accounting math:** untouched — no posting, valuation, or calculation change. RCM is classification of *existing* duty rows in reports + a boolean flag. The R-05/A-07 invariant "posted duty heads are the truth" is preserved (RCM duty is still duty; it is *additionally* RCM-flagged).
- **Migration:** one additive column (`vouchers.is_rcm`) + one seeded ledger per company (INSERT for new companies; for existing companies an idempotent seeding backfill INSERT ... WHERE NOT EXISTS — additive, deterministic, honest). 10/10 migrations.
- **Existing reports:** GSTR-1 unchanged (RCM inward supplies are not outward supplies). GSTR-3B output shape gains keys (additive); existing keys/values identical for non-RCM books — all existing assertions keep passing unchanged.
- **UI:** voucher form gains an "R" toggle visible for Purchase/Debit Note (keyboard-first: `Alt+R`), stored on save; GSTR-3B view gains two table sections; Ledger form's Duty Head select gains "RCM".
- **Tests:** final_regression +10 R-23 checks → 659 (RCM purchase → 4(A)(3) taxable+duty, ITC split, net unchanged-vs-ledgers, non-RCM purchase unaffected, Debit Note reversal, cancel/uncancel flows through, cross-company 404); engine gains `gstr3bAppMonth.rcm` mirror independently; new `r23_ui.js` (~10 checks: toggle, badge in Day Book, 3B rows, reconcile).
- **Projected totals:** Python 941/941, browser ~265/265. Proposed release: **v1.22.0 — "reverse charge (RCM)"**.

## 5. Non-bugs / out of scope

- Current GSTR-3B is **NOT A BUG** for non-RCM books — every existing assertion holds; the gap only materializes when a user self-accounts RCM, which zprime today cannot express.
- Import mapping of RCM flags, self-invoice workflow, 9(5), GSTR-9 RCM cross-checks: documented out of scope for R-23.

---

**Final verdict:** `R-23 CONFIRMED — GENUINE COMPLIANCE GAP, FULLY SCOPED · AWAITING SCOPE APPROVAL`
