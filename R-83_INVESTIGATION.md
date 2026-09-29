# R-83 INVESTIGATION — Voucher transactions vs TallyPrime: are zprime's transactions/vouchers on par (fields, features, muscle memory)?

**Trigger (operator):** "in dept study/compare/contract transactions/voucher their features/fields if they are on par with tally prime, mostly focus on the vouchers, they should be identical/similar to tallyprime so that tallyprime users will have zero issues using it" — i.e. audit the voucher estate field-by-field against TallyPrime and report the honest gap list with options. Investigation-only; **zero production code touched**; awaiting approval before any implementation.

**Date:** 2026-09-29 · **Baseline:** v1.68.3 (commit `3f38669`, tag `902b9e1`; main == remote) · **Method:** full as-built audit of the voucher estate on the released tree — `server/src/lib/defaults.ts` (DEFAULT_VOUCHER_TYPES / DEFAULT_GROUPS), `server/src/db/schema.ts` (`voucher_types` ~131, `vouchers` 253–296), `server/src/routes/vouchers.ts` (`validateEntries` ~217, `nextNumber`, party locks, bill-wise, settlement guards), `client/src/pages/VoucherScreen.tsx` (1,199 lines, every field walked), InvoicePrint / PayrollProcess / gatewayMenu — against **official TallyPrime documentation fetched this session**: help.tallysolutions.com `keyboard-shortcuts-tally-prime` (updated 2026-09-24 — the authoritative default key map), `sales-of-goods-services` (complete sales voucher flow + the shared F12 configuration table), `purchase-goods-and-services-tally`, `payments-and-receipts-tally` / `banking-setup` (Bank Allocation screen), plus the standard shortcut lists cross-checked against the official page.

---

## Executive Summary

**The verdict is better than "similar": on the accounting DATA model, the type estate, the key map, and the core entry contract, zprime is at or near parity with TallyPrime — a Tally user's day-one voucher entry works.** Every one of Tally's 16 working voucher types exists with the same name, category, and stock semantics (orders commitment-only, exactly Tally's model); the F4–F9 / Alt+F5–F9 / Ctrl+F7 key map matches TallyPrime's official defaults; numbering (auto/manual, prefix/suffix, start, per-FY restart), F2 date, party invoice-no/date, narration, bill-wise new/against refs, RCM, zero-value opt-in, optional drafts (Ctrl+L), cancel (Alt+X), duplicate (Alt+2), and the banking essentials (transaction type, cheque no/date, BRS) all match. The Dr/Cr ledger grid + inventory grid that zprime always shows is Tally's own "As Voucher" mode.

**The honest gaps are concentrated in the invoice HEADER — the descriptive screens around the accounting core — and in during-entry context, not in the accounting:**

1. **Dispatch / Party (buyer-consignee mailing) / Order / Export detail screens are absent.** Tally toggles these on per voucher (F12) and prints them on the invoice face. zprime has `placeOfSupply` and the party master only — a printed zprime invoice cannot carry dispatch-through/vehicle/LR-RR or a ship-to address that differs from the party master. This is the single real "zero issues" blocker for goods businesses that put transport data on invoices.
2. **During-entry context is thinner:** Tally shows the party's running balance on the party screen and lists OPEN BILLS to allocate against; zprime free-texts bill names (display is fine since R-69/R-70, entry is blind) and shows party turnover only in the Gateway. Negative-cash warning is also absent (negative-stock warning exists).
3. **F12 muscle memory lands on nothing** — zprime hardcodes the field set. Several underlying toggles already exist (zero-value, per-type), just surfaced in the master, not an in-entry F12.
4. Deep tails are partial or deliberately out of scope: PDC class, bank Ref ID, deposit slips, cost centres, batch/lot inventory, Reversing Journal/Memorandum/POS types, connected e-payments (deliberate — no third-party banking).

**Recommendation: Option A** — an "invoice-face completeness" pack (party + dispatch + order detail sections on the invoice-class vouchers, printable; open-bills picker; party balance during entry; negative-cash warning). It converts every ❌ that a Tally user meets in the first week of real usage into parity, with additive-only schema. **B** (a literal F12 configuration surface incl. Ctrl+H mode switch / To-By wording) is muscle-memory polish worth doing only after A; **C** (context-only, no new fields) is the cheap floor; **D** (cost centres) and **E** (decline with evidence) priced below. **Nothing is implemented until the operator picks.**

---

## 1. The voucher-type estate, side by side

TallyPrime's standard set vs zprime's seeded types (`DEFAULT_VOUCHER_TYPES`, `defaults.ts` 54–75). zprime allows custom types too (Tally parity), so the comparison is the default estate.

| TallyPrime type | TallyPrime key | zprime type | zprime key | Verdict |
|---|---|---|---|---|
| Contra | F4 | Contra | F4 | ✅ exact |
| Payment | F5 | Payment | F5 | ✅ exact |
| Receipt | F6 | Receipt | F6 | ✅ exact |
| Journal | F7 | Journal | F7 | ✅ exact |
| Sales | F8 | Sales | F8 | ✅ exact |
| Purchase | F9 | Purchase | F9 | ✅ exact |
| Credit Note | Alt+F6 | Credit Note | Alt+F6 | ✅ exact (TallyPrime convention; ERP 9 used Ctrl+F8) |
| Debit Note | Alt+F5 | Debit Note | Alt+F5 | ✅ exact (TallyPrime; ERP 9: Ctrl+F9) |
| Delivery Note | Alt+F8 | Delivery Note | Alt+F8 | ✅ exact |
| Receipt Note | Alt+F9 | Receipt Note | Alt+F9 | ✅ exact |
| Stock Journal | Alt+F7 | Stock Journal | Alt+F7 | ✅ exact |
| Physical Stock | Ctrl+F7 | Physical Stock | Ctrl+F7 | ✅ exact (TallyPrime; ERP 9: Alt+F10) |
| Manufacturing Journal | F10 → other-vouchers list | Manufacturing Journal | F10 (direct) | ✅ type exact; one-key presentation diff (zprime opens it directly, Tally's F10 lists it) |
| Sales Order | Ctrl+F8 | Sale Order | keyless | ⚠️ deliberate divergence (R-73): zprime's Ctrl+F8-slot vocabulary is taken by Credit/Debit Note (R-53c scheme forbids duplicate chords); reachable via Gateway/Day Book |
| Purchase Order | Ctrl+F9 | Purchase Order | keyless | ⚠️ same deliberate divergence |
| Payroll | (feature-gated) | Payroll | keyless (PayrollProcess page) | ✅ present, different surface |
| Reversing Journal | F10 list | — | — | ❌ absent (rare; non-accounting auto-reversal) |
| Memorandum | F10 list | — | — | ❌ absent (Tally's rough-notes class; zprime's Optional drafts cover most of the need) |
| POS Invoice | (feature) | — | — | ❌ absent (retail counter scenario out of scope) |

Groups: zprime seeds **28 standard Tally groups** (✅). Type metadata parity: name, short code, **category (Accounting/Inventory/Payroll)**, `affectsStock` (orders correctly false — commitments move no stock, exactly Tally), numbering automatic|manual + prefix/suffix/start **+ per-FY restart** (R-57, Tally's numbering periodicity), `allowZeroValueEntries` (R-73, Tally F12's zero-value opt-in), function key. **F-83-1: SUBSTANTIAL PARITY** — the only absent classes are Tally's rarely-used special classes; the order-key divergence is recorded rationale, not an oversight.

## 2. The core entry contract — field-by-field (all voucher classes)

zprime `VoucherScreen.tsx` (1,199 lines) against the TallyPrime voucher screens from the official docs. Blocks appear in Tally's screen order.

| TallyPrime field / behavior | zprime | Verdict |
|---|---|---|
| Voucher No. (auto/manual, prefix/suffix, restart) | v-number; `voucher_types` numbering + R-57 FY bucket + atomic counter | ✅ parity (>16-char warning absent — Tally warns, zprime truncates nothing) |
| Date **F2** | v-date, F2 | ✅ |
| Change voucher type mid-entry | type chosen on open; no mid-entry switch | ⚠️ minor (open the right one — muscle memory only) |
| Party A/c (ledger) + **Alt+C create-on-the-fly** | TypeAhead + quick-create modal (Name/Under Group/Taxability/GST Rate %) | ✅ parity |
| Supplier Invoice No. / Ref + Date | v-ref + ref date | ✅ |
| **Party Details screen** (buyer/consignee mailing address, printable) | none — party master only | ❌ **F-83-4** |
| **Dispatch Details** (doc no, via, destination, carrier LR-RR, vehicle no., ports) | none — `placeOfSupply` only | ❌ **F-83-4** |
| **Order Details** (buyer order no/date, mode/terms of payment, other refs, terms of delivery) | Against-Order **linkage** + pending quantities (R-73) but no meta fields | ⚠️ half → ❌ **F-83-4** |
| **Export Details** (ports, country, shipping bill no/date) | none | ❌ F-83-4 family (exporters only) |
| Item grid (item, godown when detailed, qty, rate, disc %, amount) | inventory grid, identical columns incl. R-73 discount | ✅ |
| Batch/lot numbers in item allocation | absent (no batch-wise inventory model) | ❌ inventory-depth, F-83-9 |
| HSN/SAC visible in entry | items carry HSN; shown on the invoice face, not the entry grid | ⚠️ minor |
| Per-line narration / additional descriptions | line narration (R-73) | ✅ |
| Ledger grid **To/By (As Invoice) vs Dr/Cr (As Voucher)**, Ctrl+H mode switch | always Dr/Cr + inventory grid = Tally's **As Voucher** mode always-on; no Ctrl+H | ⚠️ **F-83-3** (presentation, not function) |
| Bill-wise allocation (New Ref / Against Ref / Advance), list of open bills | entries carry `bills[]` new_ref/against_ref, party row locked FOR UPDATE, settled-bill guard — **but the bill name is free text; no pending-bills picker during entry** | ⚠️ **F-83-6** (display parity ✅ since R-69/R-70; entry picker ❌) |
| Show current/final party balance during entry | turnover shown in Gateway only | ❌ **F-83-6** |
| Duty computation (auto post per ledger taxability) / **Apply GST** | Apply GST helper (Alt+J) + duty heads + RCM toggle (Purchase/DN, Alt+R) + TDS/TCS helpers | ✅ near-parity (explicit apply vs Tally's auto; RCM scoping narrower) |
| Negative-stock warning | warn + opt-in override | ✅ |
| **Negative-cash warning** | absent | ❌ F-83-6 |
| Bank Allocation screen: **Transaction Type** (Cheque default, RTGS/NEFT/UPI/e-transfer), instrument no/date, **Ref ID**, instrument-date default | Transaction Type (cheque|rtgs|neft|upi|other), chequeNumber/chequeDate, reconciledAt + BRS | ✅ essentials / ⚠️ **F-83-7** (no Ref ID, no PDC class Ctrl+T, no deposit-slip/payment-advice print, no e-payments — deliberate) |
| Narration ("Being…") | narration | ✅ |
| Accept **Ctrl+A** | Accept/Alter Ctrl+A | ✅ |
| Optional **Ctrl+L** | Save as Optional Ctrl+L (OPT-n provisional numbers, excluded everywhere, Day Book Accept) | ✅ (R-73) |
| Post-dated **Ctrl+T** | absent | ❌ F-83-7 |
| Cancel **Alt+X** / Delete **Alt+D** | cancel (banner + read-only, guard vs settled bills) / delete (same guard) | ✅ |
| Duplicate **Alt+2** | Ctrl+D (Alt+2 alias) | ✅ (R-73) |
| **F12 (Configure)** in voucher | no in-entry configuration surface | ❌ **F-83-5** |
| Calculator panel (Ctrl+N / Alt+C from Amount) | absent | ⚠️ minor |
| Print after save / Ctrl+P from voucher; templates (Alt+O-class) | Print Invoice button (Sales/Delivery Note edit mode) + Tally-style face (GST breakdown, amount-in-words, logo, IRN QR) | ✅ on the invoice classes / ⚠️ no post-save prompt, no other-voucher faces (browser print covers), **F-83-10** |
| Cost centres / cost categories on ledger lines | absent entirely | ❌ **F-83-8** |

**F-83-2: CORE PARITY.** The accounting contract — what debits, what credits, what moves stock, what the ledger and outstanding reports see — is Tally's contract. The gaps are descriptive/contextual, not computational.

## 3. The F12 configuration table, honestly mapped

Tally's shared voucher-entry F12 set (official sales/purchase/banking docs) vs zprime as-built:

| Tally F12 option | zprime |
|---|---|
| Provide Dispatch, Order, and Export details | ❌ no such fields (F-83-4) |
| Provide separate Buyer and Consignee / Party details | ❌ (F-83-4) |
| Provide Receipt, Order, and Import details (purchase) | ⚠️ Against Order ✅; receipt/import details ❌ |
| Allow 0-valued entries in voucher | ✅ per-type `allowZeroValueEntries` (R-73) — surfaced in the voucher-type master, not in-entry F12 |
| Provide VAT/GST/statutory details | ✅ via Apply GST + duty heads + RCM (different mechanism, same bookings) |
| Use common ledger for item allocation | ➖ n/a (zprime books via party + Apply GST, no per-item ledger allocation) |
| Show inventory details (godown) | ✅ godown column when company is detailed |
| Show Cash/Bank balances during entry | ❌ (F-83-6) |
| Show current/final party balance during entry | ❌ (F-83-6) |
| Show list of bills during bill allocation | ❌ free-text bill names (F-83-6) |
| Default bank instrument date = voucher date | ❌ (F-83-7) |
| Marks/Container No., No. of Packages | ❌ (F-83-4 family) |
| Warn on negative stock | ✅ |
| Warn on negative cash | ❌ |
| Voucher number >16 chars warning | ❌ |
| Cr/Dr vs To/By + mode (Ctrl+H) | ❌ always Dr/Cr (F-83-3) |
| Consolidate items with same rate / compound units | ❌ (minor) |
| Additional descriptions (ledger/stock) on the invoice | ✅ per-line narration (R-73) |
| Calculate tax on current subtotal (preclose) | ➖ n/a (Apply GST computes on line totals) |

**F-83-5 verdict:** the *underlying toggles that matter* mostly exist (zero-value, godown detail, negative-stock warn) but are configured in masters/settings, not an in-entry F12. A Tally user pressing F12 gets silence — muscle-memory miss, not a capability miss.

## 4. Findings

- **F-83-1 — Type estate & key map: PARITY ✅.** 16/16 working types with exact names, categories, stock semantics, and (except the two deliberately keyless orders) TallyPrime's official default keys. Absent: Reversing Journal, Memorandum, POS (rare classes; Optional drafts cover Memorandum's real use).
- **F-83-2 — Core entry contract: PARITY ✅.** Numbering (incl. per-FY restart), date F2, party + invoice-no/date, item grid, Dr/Cr grid, bill-wise with party locks and settlement guards, GST/TDS/TCS application, RCM, banking essentials, narration, Ctrl+A/Ctrl+L/Alt+X/Alt+D/Alt+2, optional drafts.
- **F-83-3 — Invoice-mode duality: DIVERGENCE ⚠️ (low).** zprime is permanently "As Voucher" (Dr/Cr + item grid); no Ctrl+H, no To/By wording. Nothing is un-enterable; it is wording/muscle memory.
- **F-83-4 — Descriptive detail screens: GAP ❌ (MEDIUM-HIGH — the real one).** Party (buyer/consignee mailing), Dispatch (doc no/via/destination/carrier/vehicle/ports), Order meta (buyer order no/date, payment & delivery terms), Export details, marks/packages. Consequences: printed invoices can't carry ship-to or transport data (e-way-grade fields), different-ship-to sales force master edits, and Tally users' screens look bare on invoice-class vouchers.
- **F-83-5 — In-entry F12 configuration: GAP ❌ (MEDIUM-LOW).** No F12 surface; existing equivalents live in masters/settings.
- **F-83-6 — During-entry context: GAP ❌ (MEDIUM).** No party running balance during entry, no open-bills picker at allocation (free-text fragments outstanding via typos), no cash/bank balance display, no negative-cash warning. High user-visible value; all data already exists server-side.
- **F-83-7 — Banking depth: PARTIAL ⚠️ (MEDIUM-LOW).** Essentials present (txn type, instrument no/date, BRS, Cheque Register). Missing: PDC class (Ctrl+T), bank Ref ID, instrument-date default, deposit-slip/payment-advice prints, connected e-payments (deliberate — no third-party banking in the threat model).
- **F-83-8 — Cost centres/categories: ABSENT ❌ (LOW for this operator).** Tally F11 feature used for department profitability; large schema+report surface; out of the single-company/small-team model.
- **F-83-9 — Inventory depth at entry: PARTIAL ⚠️ (LOW-MEDIUM).** No batch/lot allocation; HSN not in the entry grid (it is on the face); no same-rate consolidation.
- **F-83-10 — Print ergonomics: PARTIAL ⚠️ (LOW).** Invoice face is genuinely Tally-style (GST breakdown, words, logo, IRN QR); no post-save print prompt; non-invoice vouchers print via browser (plain face).

**Net:** for "a TallyPrime user has zero issues" — F-83-1/2 deliver day-one entry; F-83-4 + F-83-6 are what they hit in the first week of real usage (printing an invoice with transport/ship-to details; allocating against a pending bill without seeing the bills). Those two are the parity program.

## 5. Options for the operator

- **Option A — Invoice-face completeness pack (RECOMMENDED).** On invoice-class vouchers (Sales, Purchase, Credit Note, Debit Note, Delivery Note): collapsible **Party Details** (buyer + consignee mailing), **Dispatch Details** (dispatch doc no, via, destination, carrier LR-RR, vehicle no.; port-of-loading/discharge only when place-of-supply is outside India), **Order Details** (buyer order no/date, mode/terms of payment, other references, terms of delivery) — per-voucher, additive columns/JSONB, rendered on the InvoicePrint face (Tally's own layout order). Plus the F-83-6 context items: **open-bills picker** in bill allocation (bills already exist from R-69/R-70 — a picker, not free text), **party running balance** on the party row (fetch the existing outstanding service), **negative-cash warning** alongside the existing negative-stock one. Migration additive-only; no accounting surface change; new r-suite pins fields → face → picker. Rough size: one release (schema + VoucherScreen sections + InvoicePrint + small server bits).
- **Option B — Full F12/mode parity (defer after A).** An in-entry F12 configure modal exposing the toggles Tally exposes (including Ctrl+H mode switch and To/By presentation, common-ledger allocation, consolidation options). High muscle-memory value, near-zero accounting value; worth doing only once A lands.
- **Option C — Context-only floor (cheapest).** Just F-83-6: bills picker + party balance + negative-cash warn. No new screens/fields, no print-face change. Fixes the daily-use context gaps but invoices still can't carry dispatch/ship-to.
- **Option D — Cost centres (defer).** Real Tally feature class; large schema (categories, cost-centre allocations on ledger lines, new reports). Only on explicit demand.
- **Option E — Decline with evidence (R-67 precedent).** Record parity achieved at the data/accounting level (F-83-1/2) and the documented divergences; no release.

## 6. Test plan sketches (only if an option is approved)

- **Option A:** new `r83_ui.js` — Sales voucher: enable Party+Dispatch+Order sections, fill, save, open Print face → assert ship-to/transport/order rows render (screen + `@media print`); party-details omission keeps face identical to today (additive, off-state byte-stable); bills picker: create two invoices against a bill-wise party → receipt allocation shows exactly the two open bills → allocate Against one → Bills Receivable shows the residual; party balance probe on Payment entry (balance drops by the amount live); negative-cash warn fires on an over-payment and is overridable per Tally; run.js/final_regression extensions for the new server fields; fresh-volume estate exactly once.
- **Option C:** subset of the above (picker + balance + warn), no schema work.
- **Option B:** contract test that F12 opens the modal and each toggle changes the advertised entry surface; Ctrl+H flips Dr/Cr ↔ To/By labels without changing bookings (accounting output asserted byte-identical).

## 7. Risks / Open questions / Next step

- **Risks of Option A:** schema growth on `vouchers` (mitigate: one additive JSONB/details table, nullable — zero backfill); InvoicePrint layout drift on faces that don't use the new sections (mitigate: off-state byte-stable contract, suite-pinned); scope creep toward full F12 (keep B out).
- **Risks of declining:** a Tally migrant printing goods invoices hits the ship-to/transport gap immediately — this is the one place "zero issues" genuinely fails today.
- **Open questions for the operator:** (1) Option A as scoped — approve / trim / reorder (party details before dispatch?); (2) do exporters matter (port/shipping-bill fields) or are they dead weight; (3) is Option B wanted at all (muscle-memory polish), and Option D (cost centres) on any horizon; (4) PDC class — wanted, or does the Optional-drafts class cover the post-dated parking use?
- **Proposed next step:** operator picks A / C / B / D / E (or a mix). Per protocol: approved items → implementation cycle → gates → fresh-volume estate → release. This investigation itself is the deliverable of the current cycle: **zero production code changed.**
