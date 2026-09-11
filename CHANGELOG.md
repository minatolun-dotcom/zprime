# Changelog

## v1.0.0 — Release Baseline (2026-09-11)

Tag: `v1.0.0` · Baseline commit: see `git rev-list -n 1 v1.0.0`

**483/483 checks passed — zero failures.**

### Verification summary (exact commands and results in STATE.md)

| Suite | Command | Checks | Result |
|---|---|---|---|
| Smoke | `python3 scripts/smoke_test.py` | 39 | PASS |
| Adversarial attack | `python3 scripts/attack_test.py` | 88 | PASS |
| Bug-fix regression | `python3 scripts/fix_regression.py` | 65 | PASS |
| Independent reconciliation | `python3 scripts/reconcile.py` | 48 | PASS |
| Final regression (A-/F- findings + fix attacks) | `python3 scripts/final_regression.py` | 97 | PASS |
| Attack-the-fixes | `python3 scripts/attack2.py` | 29 | PASS |
| Real-browser UI acceptance | `node scripts/acceptance/run.js` | 117 | PASS |
| Typecheck | `npm run typecheck` | — | PASS (server + client) |
| Docker fresh volume | `docker compose down -v && docker compose build && docker compose up -d` | — | PASS (healthy ~6s, migrations auto-apply, data survives restart) |

The independent Python expectation engine (shares no code or queries with zprime) reconciles, for three months of a fictional trading business driven through the real UI: Trial Balance, Balance Sheet, P&L (cumulative and monthly), FIFO stock, bills receivable/payable, GSTR-1, GSTR-3B, TDS, cash/bank, and salary register — to the paisa.

### Fixed in this release

- **A-01 (P1)** GSTR-3B white-screen — report renders and reconciles.
- **F-GRP-01 (P1)** Group master unusable — nature inheritance, clean 4xx/409, reserved-parent rules.
- **F-TDS-01 (P1)** TDS sections master 500 — sort key + validation schema.
- **A-07 (P2, reporting integrity)** The ₹1,215 IGST defect: GST reports now treat booked duty amounts as authoritative; supply-type contradictions are flagged (`supplyMismatch`), never silently zeroed. Ledger GST == GSTR-1 == GSTR-3B is an enforced invariant with a permanent regression test.
- **A-02 (P2)** Bill-name collisions across voucher types — auto names are `SHORTCODE-number`; server enforces per-party bill-name uniqueness in-transaction.
- **A-03 (P2)** Negative payroll deductions rejected with clean 400s.
- **A-04 (P2)** TDS report separates deductions from remittances (deducted − remitted = outstanding).
- **A-05 (P2)** On-account amounts merged into party outstanding (synthetic "On Account" bill).
- **A-06 (P2)** Sub-period P&L is period-correct (period movements, not cumulative closings).

Earlier hardening (BUG-001…BUG-009) is included: atomic voucher numbering, bill-allocation integrity guards, RFC-compliant CSV export, input fuzzing resistance, company isolation, payroll/TDS validations.

### Known non-blocking issues (NOT fixed — documented, do not treat as resolved)

- **F-INV-01 (P3):** An inventory-only Stock Journal (no accounting leg) cannot be entered through the UI — no Ledger Entries section renders, so the workflow is blocked rather than supported.
- **O-1 (P4):** The Cash/Bank report's "Closing" figure is an all-time sum (includes vouchers dated after the report's `to` date) while "Opening" respects the period — period semantics are inconsistent on that view.

### Accounting invariants verified at this baseline

- Total Debits = Total Credits on every voucher, report, and period.
- Assets = Liabilities + Capital with no difference banner.
- Ledger == Trial Balance == reports; Sales/Purchase registers == transactions.
- Stock movements == Stock Summary (FIFO, incl. backdated layers).
- GST ledger == GSTR-1 == GSTR-3B.
- TDS deducted − remitted == outstanding == report.
- Bills receivable/payable == named-bill allocations == outstanding reports.
- Payroll vouchers == payslips == Salary Register.
- Company isolation and voucher-numbering protections intact; BUG-002 allocation guards hold in real use.
