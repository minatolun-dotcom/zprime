# R-84 INVESTIGATION — the deliberate tails: deposit-slip print & batch/lot inventory (worth a follow-up cycle?)

**Trigger (operator):** "Re-read R-83_INVESTIGATION.md and audit the remaining deliberate tails (deposit-slip print, batch/lot inventory) for a possible follow-up cycle" — i.e. after v1.69.0–v1.72.0 closed findings F-83-3…8, decide honestly whether the two named leftovers deserve an implementation cycle, and at what scope. Investigation-only; **zero production code touched**; awaiting approval before any implementation.

**Date:** 2026-09-30 · **Baseline:** v1.72.0 (commit `9cb24c0`, tag `3dce728`; main == remote) · **Method:** R-83_INVESTIGATION.md re-read (the F-83-7 and F-83-9 residue lines) + official TallyPrime docs fetched this session — help.tallysolutions.com **`/deposit-slips/`** ("How to Print Cash and Cheque Deposit Slips in TallyPrime", updated 2026-02-27) and **`/manage-inventory-batch-wise-tally/`** ("How to Manage Inventory Batch-Wise in TallyPrime", updated 2025-10-31) — audited against the as-built tree: `ChequePrint.tsx` (the whole banking-print surface), `banking.ts` (cheque-register / BRS), `stock_items` schema (219–245), `inventory_entries`, `stockSummary` + the Stock Summary report, and the F11/F12 surfaces shipped in v1.70/v1.72.

---

## Executive Summary

**Two different animals.** The **deposit slip is a small, well-bounded print feature** — Tally's model is literally "list the bank's unreconciled Receipt/Contra legs; spacebar-select; print a bank-shaped slip" — and zprime already has every input it needs (BRS legs, instrument metadata from F-83-7, company + bank-ledger master fields). It is a genuine one-cycle feature with small additive surface. **Batch/lot inventory is the largest remaining Tally class zprime does not model** — a second inventory dimension (batches with mfg/expiry dates) threading through masters, every inventory voucher's allocation screen, valuation (FIFO/LIFO *by batch*), and three reports (Batch Summary / Batch Vouchers / expiry views). It is a real multi-cycle program and the only finding family in the whole R-83/84 study that would change the stock engine.

**Recommendation: A1 (deposit slips) now — one focused release; A2 (batch/lot) on explicit operator demand only** — it is the one remaining place where a vertical (pharma/food/FMCG distribution) finds zprime structurally short, but it is not a "polish" item and should not be started casually.

---

## 1. Deposit-slip / payment-advice print — what Tally actually does (official doc, fetched)

From `/deposit-slips/` (TallyPrime):

- Two slip kinds: **Cash Deposit Slip** (F5 from the same report) and **Cheque Deposit Slip**.
- Both are **reports over recorded bank receipts**, not new vouchers: open via Alt+G → "Cash/Cheque Deposit Slip", **select the bank**, the screen lists that bank's deposit-candidate receipts, **Spacebar selects rows**, Ctrl+P prints **selected or all**, with a "Show consolidated" option (one slip for many transactions).
- Cheque slip content: **Received From** (payer), instrument **date/no**, amount, **Account Holder's Name / Bank Name / Branch Name** "as available in the bank ledger", company **telephone/mobile/PAN**.
- Cash slip content: the same bank-block **plus cash denomination details**.
- Configure: Date-of-print, Print Voucher Type/No., margins, Show Received From, phone/mobile/PAN toggles.
- Siblings in the same Banking family: **Payment Advice** (advise-the-bank print over recorded payment vouchers) and "mark slips as printed" bookkeeping.

### zprime as-built (v1.72.0)

- **Banking data: complete for this.** `vouchers` carries txn type, instrument no/date (F-83-7, UI-reachable), Ref ID, post-dated, `reconciledAt` (the BRS "cleared" flag is exactly Tally's printed/not-printed-style state line); `/cheque-register` already lists every instrument leg with bank ledger, amount, direction, status.
- **Bank ledger master: complete.** `ledgers.bankAccountNumber`, name; `chequePayerName`; company master carries address/phones/PAN-adjacent identity (GSTIN) + the R-74 logo.
- **Print surfaces: the pattern exists.** `ChequePrint.tsx` is a pick-an-instrument → print-a-bank-shaped-face page with a `print:` layer; `InvoicePrint` renders company blocks. No deposit-slip, payment-advice, or denomination model exists anywhere (grep clean).

### Verdict — **F-84-1: FEASIBLE, SMALL, REAL (value MEDIUM).**

Scope if approved (**Option A1**):
1. A **Deposit Slips page** (Utilities, beside Cheque Printing): pick a bank → list that bank's **unreconciled Receipt/Contra legs** from the existing register service; Spacebar/click multi-select; **Cheque slip** face (Received From = narration/party, instr. no/date, amount, bank block from the ledger + company identity, logo) and **Cash slip** face (same minus instrument, plus an optional denomination grid that is **print-only, never stored** — zprime records no cash-count facts); per-slip + consolidated print; "mark as printed" as a lightweight `depositSlipPrintedAt`-style additive column so printed slips can be filtered (F8 Incl-Printed parity).
2. **Payment Advice** print on the same page (Tally's sibling): same listing over Payment legs, an advice-shaped face (payee, amount, instrument, "please credit the beneficiary").
3. No new voucher types, no accounting surface, migration = one nullable timestamp column. Suite: extend `r83_ui.js` (I section) + `final_regression.py` (printed-flag filter, listing correctness).

Rough size: **one focused release** (client page + 2 print faces + 1 column + report filter). Lowest-risk item left in the whole study.

## 2. Batch/lot inventory — what Tally actually does (official doc, fetched)

From `/manage-inventory-batch-wise-tally/` (TallyPrime):

- **F11 "Enable Batches"** (+ optional "Maintain Expiry Dates for Batches"); per-item "Maintain in Batches" with per-batch **Batch Number / Manufacturing Date / Expiry Date**.
- Batches double as **rate-wise categorisation** (same item, different purchase lots at different rates, sold from the chosen batch).
- **Entry surface:** the item-allocation sub-screen on every inventory voucher (purchase allocates IN to one/many batches; sales picks the batch — FEFO by policy).
- **Reports:** Batch Summary (per item: opening/inward/outward/closing **per batch**, qty/rate/value, mfg/expiry columns, days-to-expiry, expired-only filter, batch-wise gross profit), Batch Vouchers, Batch Monthly Summary drill-down; sorting by expiry/mfg/qty/rate.
- Valuation implication: stock value becomes **batch-aware** (Tally values outwards from the specific batch under FIFO/per-batch cost tracking).

### zprime as-built (v1.72.0)

- `stock_items`: no batch flag, no batch table; `inventory_entries`: no batch column — the model **is** item × godown with running weighted-avg (or FIFO) valuation in `stockSummary`.
- Stock Summary supports item selection only; no batch dimension anywhere (grep clean).
- The voucher inventory grid has no allocation sub-screen concept.

### Verdict — **F-84-2: THE LARGEST REMAINING GAP — and the only one that changes the stock engine.**

What a real implementation means (**Option A2**, for the record):
1. Schema: `stock_batches` (item, name, mfg_date, expiry_date), `inventory_entries.batchId` or a batch-allocation child table (a sale may consume **multiple batches**), opening balances per batch.
2. **Valuation change:** weighted-avg/FIFO must run **per batch** (Tally's per-batch cost tracking) or zprime must pin one valuation rule batch-agnostically — either way `stockSummary`/stock-value reports change behaviour, and migration must seed opening batches honestly.
3. Entry UX: a batch-allocation sub-grid in the inventory rows (Tally's Stock Item Allocation screen) + FEFO helper; negative-stock guard becomes batch-aware.
4. Reports: Batch Summary (+ expiry filters), batch drill-down, expired-only views.
5. GST/e-invoice: batch is not a statutory field — no compliance pull.

Rough size: **2–3 releases** (schema+entry, valuation+reports, polish) with the highest regression risk of anything studied since R-73 — it touches the engine that every stock report and every inventory voucher shares.

### The honest "who needs this" test

Tally itself gates it behind F11 and most traders never enable it: it matters for **pharma, food/ perishables, chemicals, and rate-lotted distribution**. For zprime's single-company/small-team model (the same test that scoped F-83-8's "LOW for this operator"), it is a vertical feature, not a parity feature. Nothing in the day-one or first-week Tally-migrant journey hits it — you only meet batches when your goods expire.

## 3. The other residue lines, one paragraph each (no cycle warranted)

- **Export details (F-83-4 family):** declined with Option A already — zprime's e-way/e-invoice payloads derive transport from parameters; exporters remain the only constituency. No change.
- **HSN in the entry grid / same-rate consolidation:** cosmetic; HSN is on the face and in GSTR-1 where it is legally required. No cycle.
- **Post-save print prompt (F-83-10):** one browser `confirm()`-style toggle at most; fold it into A1's print work if the operator wants it, else skip.
- **Reversing Journal / Memorandum / POS:** rare classes; Optional drafts cover Memorandum's real use; POS is a retail-counter scenario out of scope. Stays declined (R-83 evidence stands).
- **Connected e-payments:** permanently out — no third-party banking in the threat model (documented posture).

## 4. Findings

- **F-84-1 — Deposit-slip / payment-advice print: ABSENT, SMALL, REAL.** All inputs exist (BRS legs, instrument metadata, bank/company masters, print-face patterns); Tally's model is a report + selection + bank-shaped print, not new accounting. Recommended scope A1 is one release.
- **F-84-2 — Batch/lot inventory: ABSENT, LARGE, VERTICAL.** The only remaining finding that changes the stock engine (per-batch valuation, allocation sub-screen, three reports). 2–3 releases, highest regression risk; matters only to expiry/rate-lot businesses.

## 5. Options for the operator

- **A1 — Deposit Slips + Payment Advice (RECOMMENDED if wanted):** the Utilities page, two print faces, printed-flag column + filter, denomination grid print-only. One focused release; reuses F-83-7's instrument data end-to-end.
- **A2 — Batch/lot inventory (on explicit demand only):** full Tally-shaped program (schema, batch-aware valuation, allocation sub-screen, Batch Summary/expiry reports). Price it as 2–3 releases and only start it if expiry-goods tracking is a real workflow for this operator.
- **B — Fold the F-83-10 post-save print prompt into A1** as a checkbox (cheap add-on).
- **C — Decline both with this document as the evidence** (R-67 precedent) — parity program closed at v1.72.0, tails documented.

## 6. Test plan sketches (only if approved)

- **A1:** new r-section — create bank ledger + receipts (cheque + cash legs) → Deposit Slips page lists exactly the unreconciled legs → select + print (print-layer asserts Received From / instrument / amount / bank block / logo) → consolidated print → printed-flag filters the list (Incl-Printed parity) → Payment Advice face over a Payment leg; `final_regression.py`: printed-flag filter + listing contract; off-state byte-stability (no slips page visit → zero changed surfaces).
- **A2 (if ever):** batch lifecycle suite — enable per item → purchase into 2 batches (mfg/expiry) → sell FEFO across both → Batch Summary nets qty/value per batch → expired-only filter → valuation report drift-pinned against today's engine on non-batch items (zero behavioural change when the flag is off).

## 7. Risks / Open questions / Next step

- **A1 risks:** print-layout drift (mitigate: separate faces, off-state contract); "printed" state honesty (mitigate: explicit timestamp column, operator action only — never inferred).
- **A2 risks:** engine correctness (valuation migration), report regressions across the whole stock estate, scope creep. Mitigation if approved: phase 1 lands the model **dark** (flag off = byte-identical today), phase 2 switches valuation, phase 3 reports.
- **Open questions:** (1) does this operator's business actually deposit via printed slips (A1 is worthless if they bank fully digitally)? (2) does the operator handle expiring/rate-lotted goods (A2)? (3) fold B into A1?
- **Proposed next step:** operator picks A1 / A2 / B / C (or any mix). Per protocol: approved items → implementation cycle → gates → fresh-volume estate → release. This investigation is the cycle's deliverable: **zero production code changed.**
