# zprime — QA Plan (Adversarial Pass)

Mission: BREAK the application. The existing 39-check smoke suite only proves happy paths.

## 1. Existing coverage (scripts/smoke_test.py — 39 checks)

- login / bad login
- company create (seeds 28 groups, 14 voucher types, 8 starter ledgers)
- masters CRUD happy path (ledger, stock item, unit)
- vouchers: sales w/ GST + inventory, unbalanced rejection, purchase, receipt vs bill, payment w/ cheque + TDS, stock journal
- reports: trial balance totals, day book count, ledger vouchers closing, receivables/payables totals, stock summary (WA), balance sheet identity, P&L shape, GSTR-1 B2B + HSN, GSTR-3B net, TDS by section, cheque register
- voucher detail roundtrip, delete
- payroll process + duplicate guard + salary register
- XML import: 1 ledger/item/voucher, duplicate skip
- static client served

## 2. Missing coverage (gaps found by inspection)

- Cross-company isolation (only one company ever tested)
- Authorization attacks (forged/missing JWT — only bad password tested)
- Mass assignment (extra/ID fields in POST bodies)
- Voucher item/company validation (assertLedgers exists; no assertItem — suspected IDOR)
- Voucher numbering: manual duplicates, concurrency, prefix/suffix, deletions
- Atomicity: failure mid-create (overflow amounts, invalid item id after valid entries)
- GST: credit/debit note direction, multi-rate invoices, CESS, rounding (0.01-level), exempt/nil
- Bill-wise: advances, on-account (unused variable suspected), over-allocation, negative bills, delete referenced invoice
- Inventory: FIFO layers, WA math with backdated entries, negative stock, fractional qty, zero rate/qty, manufacturing valuation
- Payroll concurrency, employee deletion after payroll
- TDS threshold (never enforced in code?)
- XML fuzzing (malformed, huge, prototype-pollution keys, negative/invalid data)
- Input fuzzing (dates like 2025-99-99, 1e309, Unicode, empty strings)
- Performance (N+1 in register(); stockSummary full-scan; report timings at scale)
- Concurrency (duplicate voucher numbers — no unique index)
- CSV export correctness/injection; cheque words edge cases
- Docker restart persistence (volume + idempotent migrations)
- Keyboard UX (code review: Ctrl+A hijack suspected, Esc data loss)

## 3. High-risk modules

| Module | Risk |
|---|---|
| server/src/routes/vouchers.ts | item validation gap, atomicity, numbering race |
| server/src/services/accounting.ts | on-account dropped, sign conventions |
| server/src/services/gst.ts | note direction, bucket rounding, deriveRate snapping |
| server/src/services/stock.ts | negative stock clamping inconsistency, FIFO exhaustion |
| server/src/routes/import.ts | nature misclassification, no transaction, fuzz robustness |
| server/src/routes/masters.ts (crud) | mass assignment, 500s on PG errors |
| client hotkeys / VoucherScreen | Ctrl+A hijack, Esc data loss |

## 4. Invariants to verify

Accounting:
- I1: Σ debits = Σ credits per voucher (DB level)
- I2: Trial balance: Σ Dr = Σ Cr, always, after every operation
- I3: Balance Sheet: assets = liabilities + capital (diff = 0) with opening entry present
- I4: Ledger closing = opening + Σ postings (spot checks)
- I5: Receivables per ledger + on-account = ledger closing (Sundry Debtors)

Security:
- S1: every /api/* route requires valid JWT except login/health
- S2: no read/write of Company A data via Company B session (all IDs)
- S3: client cannot set id/isReserved/companyId via POST
- S4: no SQL injection via any text field
- S5: no stored XSS execution (React escaping)

Data integrity:
- D1: voucher + entries + inventory + bills all-or-nothing
- D2: unique (company, name) per master
- D3: unique voucher number per (company, type) — suspected missing
- D4: delete used master → blocked or harmless (no dangling reports)
- D5: restart → data survives, migrations idempotent

## 5. Planned attack scenarios

Parts 1–37 of the mission brief, executed via:
- scripts/qa_attack.py (API-level: isolation, bypass, edge values, concurrency, fuzz, perf)
- code review for browser-only behavior (keyboard, React state)
- docker restart cycle test

Deliverables: BUG_REPORT.md (per-bug), QA_REPORT.md (scores, reconciliation, release call).
