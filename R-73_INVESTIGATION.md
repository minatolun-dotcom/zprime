# R-73 INVESTIGATION — Voucher workings & features: zprime vs TallyPrime

**Type:** Investigation only (per `AGENTS.md` lifecycle) — **zero production code changed**, no release warranted by this study alone. Candidate follow-ups are listed at the end for operator approval.

**Method:** evidence sweep of the running code (`client/src/pages/VoucherScreen.tsx`, `client/src/components/InvoicePrint.tsx`, `server/src/routes/vouchers.ts`, `server/src/routes/banking.ts`, `server/src/db/schema.ts`, `server/src/services/accounting.ts`, `client/src/lib/hotkeys.ts` + the acceptance corpus), clause mapped against TallyPrime's voucher-entry feature surface (TallyPrime 4.x/5.x: voucher type configuration, F12 configurables, item invoice / accounting invoice modes, banking overlay, order-linked flows).

---

## 1. The yardstick: what TallyPrime does in voucher entry

A TallyPrime voucher screen carries, per type: F12 configurables (per-type: optional vouchers, allow zero-value entries, use common narration, provide details of Order/Delivery Note/Despatch/Receipt/Challan, e-way bill details, discount column, bank transaction details/transaction type, cheque range warnings); voucher class selection; Alt+C / Alt+I / Alt+E invoice-mode switching (item vs accounting vs intermediate); Alt+D duplicate; Ctrl+A accept; Ctrl+H change view/mode (detailed/condensed/verification/statutory); post-dated and optional voucher classes; cost-centre and bill-wise allocation; interest calculations on ledgers; budget/scenario controls; multi-currency amounts; batch/lot + manufacturing dates + expiry in batches; credit period on party payment behaviour; Bank Allocation screen (transaction type: cheque/RTGS/NEFT/UPI, cheque range validation); auto bank reconciliation (BRS) from bank statements; order processing vouchers (Sale/Purchase Order, Delivery Note, Receipt Note, Rejection In) with pending-quantity tracking; job costing; payroll attendance vouchers; TDS/TCS statutory details; e-invoice/e-way bill generation (union of the above).

## 2. Parity matrix (evidence-based)

| TallyPrime capability | zprime status | Evidence |
|---|---|---|
| 13+ voucher types, custom types, per-type F-keys | **PARITY** | 13 seeded types + user-defined types with own `functionKey` (`schema.ts` voucher_types; Shell global floor layer, R-54/R-64) |
| Keyboard-first entry, Ctrl+A accept, Esc ladder | **PARITY (exceeds)** | Ctrl+A accept incl. master editors (R-72); capture-phase hotkeys; Tally's own universal accept replicated |
| Party A/c + ledger/inventory grids, type-ahead | **PARITY** | `VoucherScreen` party TypeAhead auto-inserts party row; ledger/item type-ahead with Alt+C quick-create (R-35) |
| Apply GST (statutory details) | **PARITY** | Alt+J Apply-GST (R-54, Tally's statutory slot), R-34 F-34-1 both-half fix, RCM toggle on inward (R-23) |
| Bill-wise (New Ref/Against/Advance/On Account + due dates) | **PARITY** | `validateBillsTx`; bills visible per-party in Outstanding (R-69/R-70/R-71); settled-bill cancel guard (R-02) |
| Voucher numbering (auto/manual, prefix/suffix, per-FY restart) | **PARITY** | R-57 periodicity + FY-bucketed unique indexes; next-number re-peek on date change |
| Cancellation (cancel/uncancel, no reversal entries) | **PARITY** | R-02 Model A mark+exclude; settled/payroll guards |
| Double-entry validation, atomic writes, FOR UPDATE party locking | **PARITY** | `validateEntries`, transactional writes, idempotency keys (R-10) |
| Negative stock (Model 1 reject + opt-out, chronological chain guard) | **PARITY (exceeds)** | R-06 chain-comparison guard incl. edit/cancel/uncancel/import; Tally allows negative by default — zprime is stricter by design, opt-out exists |
| Date advisory (pre-books/future) | **PARITY** | R-56 non-blocking amber advisories; Tally warns, does not block |
| Voucher classes | **PARTIAL→ABS** | No class concept; zprime's nearest is per-type config only (`voucher_types` has no class axis; nothing to select at entry time) |
| Optional vouchers (Ctrl+L / save-as-optional) | **ABS** | No `isOptional`/draft concept in schema or routes; every accepted voucher posts (grep: zero hits in `vouchers.ts`/`VoucherScreen.tsx`) |
| Post-dated vouchers (class) | **ABS (advisory only)** | Future dates accepted with R-56 advisory and report-visible on arrival — the *honest* part of the behaviour exists, the held-for-future *class* does not |
| Duplicate voucher (Alt+2) | **ABS** | No duplicate endpoint or UI action |
| F12: discount column (item-level) | **ABS** | No discount field anywhere in `inventory_entries`; invoice print has no discount column |
| F12: order/despatch/challan/Receipt-Note details block | **PARTIAL** | `InvoicePrint` derives despatch details from inventory lines (item/qty/rate) but there is no Order No / Despatch Doc / Challan / Port / Vessel field set, and no order-linked tracking |
| F12: zero-value entries allowed toggle | **PARTIAL** | zprime *rejects* zero-amount entries outright (`validateEntries`); Tally default also rejects but can permit per type — no opt-in here |
| F12: use different narrations per line | **ABS** | Single voucher-level `narration`; no per-line narration field |
| Bank Allocation screen (txn type, cheque range, favouring name) | **PARTIAL** | `chequeNumber`/`chequeDate` + `ChequePrint` with payer name exist; no transaction-type taxonomy (RTGS/NEFT/UPI), no cheque-range config/warnings |
| Bank reconciliation (BRS) | **ABS** | No bank-statement import, no reconciliation date per ledger entry |
| Cost centres / cost categories | **ABS** | Zero schema hits |
| Batches / lots / mfg date / expiry | **ABS** | `inventory_entries` has item/godown/qty/rate/kind only |
| Multi-currency | **ABS** | Deliberate (PROJECT.md OUT OF SCOPE) |
| Interest calculation on ledgers | **ABS** | Zero schema hits; no invoicing-of-interest flow |
| Budgets / scenarios | **ABS** | Zero hits; deliberate scope boundary |
| Credit period on party | **PARTIAL** | Per-bill `dueDate` exists (drives R-71 overdue highlighting), but no party-level default credit period applied at bill creation |
| Order processing (Sale/Purchase Order, pending-qty tracking, RN/DN against orders) | **ABS** | No order voucher types; Delivery/Receipt Notes are free-standing (zprime's DN/RN map to Tally's "as invoice"/"as inventory" flow only) |
| Payroll: attendance vouchers, PF/ESI/PT statutory heads | **PARTIAL** | Employees/pay heads/salary structures/processing/payslips (R-22 provance) but no attendance/leave vocab, no statutory-contribution head types |
| TDS/TCS at voucher (sections, helpers, advisories) | **PARITY (exceeds)** | R-33/R-37 per-payee FY thresholds with aggregate/single modes — Tally warns similarly; zprime never auto-blocks (documented posture) |
| E-invoice / e-way bill (IRN, EWB from IRN, direct B2C EWB, lifecycle) | **PARITY** | R-24…R-31 + R-68 IRN QR on the invoice face; hard idempotency; verbatim legal records |
| Audit trail / provance (who posted/edited) | **PARITY (exceeds)** | R-18/R-20 append-only audit + Day Book tooltips |
| Multi-godown inventory | **PARITY** | Godown per inventory row, godown stock summary |
| Amount-in-words on printed docs | **PARITY** | `amountWords()` shared by invoice + cheque faces |

## 3. Where zprime matches or exceeds Tally

1. **Entry mechanics are genuinely Tally-shaped.** Party row auto-insert, type-ahead, Alt+C on-the-fly master, Alt+J statutory apply, Ctrl+A accept, Esc ladder, F2 date, +/- day stepping — the muscle-memory set matches, and R-64/R-65/R-72 closed the advertised-vs-actual keyboard gaps that Tally never has.
2. **Integrity posture is stronger than Tally's defaults.** Chronological negative-stock chain guard with edit/cancel/uncancel/import coverage, atomic idempotent writes with double-accept protection, settled-bill cancel protection, append-only audit trail, independent expectation engine. Tally trades several of these for flexibility (negative stock allowed by default, weaker provance).
3. **GST lifecycle depth is at parity** for a non-filing tool: GSTR-1/3B/9 composition, RCM Table 4(A)(3), CDNR sign semantics, per-payee TDS/TCS threshold advisories, e-invoice/EWB submission with lifecycle and IRN QR — this is the strongest area.

## 4. Findings

- **F-73-1 (P2, workflow gap):** **No Optional/draft voucher class.** A half-finished voucher must either post or be discarded; there is no park-for-later. Tally's optional flow (Ctrl+L → later Alt+A to accept) is a daily-use feature for accountants. Candidate follow-up (additive `status` or `isOptional` column + exclude-from-reports filter + Day Book draft badge).
- **F-73-2 (P3, convenience):** **No duplicate voucher.** Recurring entries (rent, salaries via manual journal, recurring purchases) must be re-typed or XML-imported. Tally's Alt+2 is heavily used. Low-risk additive feature (GET voucher → prefill POST).
- **F-73-3 (P3, data fidelity):** **No item-level discount.** Indian invoicing routinely uses trade discounts before GST; zprime forces net-rate entry. Correct GST math survives (rate becomes net), but the printed invoice cannot show MRP − discount, and Tally books migrating in lose the discount axis. Candidate additive column + invoice column + GST on net (Tally's own behaviour).
- **F-73-4 (P3, compliance surface):** **Order processing absent** (Sale/Purchase Order, pending-quantity fulfilment, DN/RN against orders, order-to-invoice linkage). zprime deliberately ships invoice-only DN/RN. Large surface; only worth it if the operator's flow runs through orders.
- **F-73-5 (P3, banking):** **Bank allocation shallow** (cheque no/date only; no RTGS/NEFT/UPI transaction type, no range validation) and **no BRS**. Tally's BRS is a flagship; zprime's honest posture would be statement-import + reconciliation-date columns, not auto-matching.
- **F-73-6 (P4, correctness footnote):** **Per-line narration absent** (Tally F12: common vs different narrations). Fine for most books; audit-heavy users miss it.
- **F-73-7 (P4):** **Zero-value entry rejection is absolute** — Tally permits per-type opt-in. Interacts harmlessly with F-INV-01's inventory-only allowance; only matters for edge cases (0-rated service lines are better posted as exempt taxability here).
- **F-73-8 (P4, deliberate — NO ACTION):** Cost centres, batches/lots/expiry, multi-currency, interest automation, budgets/scenarios, job costing, attendance/PF/ESI payroll depth are **absent and were scoped out** (PROJECT.md boundaries). Recorded for completeness; they are not defects. Revisit only on operator demand.
- **F-73-9 (observation, strength):** Where Tally offers a *class* to defer a voucher (optional/post-dated), zprime's advisory model already keeps the *accounting* honest (R-56 pre-books/future advisories, future vouchers report-visible on arrival). The gap is workflow convenience, not correctness.

## 5. Candidate follow-ups (awaiting operator approval — none scheduled)

| # | Candidate | Size | Notes |
|---|---|---|---|
| 1 | Optional/draft vouchers (F-73-1) | Medium | Additive status column + report/Day Book filters + accept action; strongest daily-workflow win |
| 2 | Duplicate voucher (F-73-2) | Small | Server GET → client prefill on a new form; reuses existing validation |
| 3 | Item discount (F-73-3) | Medium | Additive column + invoice print + GST-on-net math + CSV |
| 4 | Party credit-period default (PARTIAL→PARITY) | Small | Party master field applied to new bills' dueDate; feeds R-71 automatically |
| 5 | Bank transaction types (PARTIAL→PARITY) | Small | Taxonomy column + Cheque Register/CSV facets; no BRS |
| 6 | Per-line narration (F-73-6) | Small-Medium | Additive column + ledger-level print option |

**Investigation outcome:** no code change required by this study. zprime's voucher engine matches TallyPrime on every correctness-bearing working (double entry, bill-wise, GST, numbering, cancellation, provance, e-invoice) and exceeds it on integrity posture; the real gaps are workflow conveniences (optional/draft, duplicate, discounts, order processing, BRS), each independently valuable and none blocking a small-business books workflow.
