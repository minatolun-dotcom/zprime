# Changelog

## Post-v1.1.0 — R-01 GSTR-1 HSN outward-supply reporting fix (unreleased)

**711/711 checks passed — zero failures.**

### R-01 — GSTR-1 HSN summary direction & attribution (FIXED, P1 reporting integrity)

**Root cause (investigation-confirmed):** the GSTR-1 HSN summary (Table 12) selected inventory rows by *quantity direction* (`qty > 0`) instead of outward voucher semantics. In zprime's signed convention (+ = stock in, − = stock out) this silently included **purchases, receipt notes, stock-journal targets** and **excluded sales**; it also had no voucher-type filter at all. Additionally the HSN code and GST rate were read only from inventory snapshot columns that UI-created vouchers leave NULL, so rows rendered as `hsn="-"`, `rate=0`. B2B/B2C and GSTR-3B use a different, correct pipeline (`voucherGst(..., "outward")`), which is why the 622-check baseline (asserting only b2b/b2c/3B totals) never caught it.

**Fix (server/src/services/gst.ts, `gstr1()` only):** the HSN population is now defined by voucher type — `voucherTypes.name = "Sales"` — the same semantics as `voucherGst(..., "outward")`; Credit/Debit Notes stay out of Table 12 (CDNR remains a documented gap). HSN/rate resolve snapshot → stock-item master fallback (`inventoryEntries.hsnSac ?? stockItems.hsnSac`, same for rate); historical imported snapshots still win. Outward quantity is reported positive (`Math.abs`). Ledger/TB/BS/P&L/GSTR-3B/TDS/stock/numbering are untouched — the change affects only the HSN block of one read-only report.

**Regression coverage:** `final_regression.py` grew 224 → **283** (+59): purchase-only HSN empty; exact sale row (code/qty/taxable/rate); the ₹91,111 canary purchase vs ₹1,000 sale on the same HSN (must be absent — this check fails against the old implementation); Receipt Note / Delivery Note / Stock Journal / Physical Stock non-pollution; master-fallback attribution (HSN 9999 @ 12% from the item master); stored-snapshot precedence; multiple HSNs aggregating independently; intra- and inter-state rows; backdated/edited/deleted sale propagation; documented population relationship (HSN = Sales-with-inventory taxable; credit notes NOT netted; accounting-only Sales excluded). The independent engine's HSN expectation is now actually consumed: `engine.py` emits `hsnMonth` (Sales-only, computed from recorded items) and `run.js` asserts each rendered HSN row's qty/taxable/rate cell-by-cell plus purchase-exclusion canaries — **+11 UI checks, 129 → 140**.

### Verification record (post-v1.1.0 R-01 fix)

| Suite | Checks | Result |
|---|---|---|
| Smoke | 39 | PASS |
| Adversarial attack | 88 | PASS |
| Bug-fix regression | 65 | PASS |
| Independent reconciliation | 48 | PASS |
| Final regression (now incl. R-01) | 283 | PASS |
| Attack-the-fixes | 29 | PASS |
| Real-browser UI acceptance (now incl. HSN reconciliation) | 140 | PASS |
| Typecheck (server + client) | — | PASS |
| Docker fresh volume + restart persistence + HSN probe | — | PASS |

**Total: 711/711 checks — zero failures** (v1.1.0 was 622; +89, none removed or weakened). Not tagged yet; v1.0.0 and v1.1.0 remain untouched.

## v1.1.0 — Inventory-only vouchers and report coverage (2026-09-12)

**622/622 checks passed — zero failures.** Previous baseline v1.0.0 (483 checks) remains tagged and untouched. No new tag had been created for the post-release work until this release; see sections below for the exact per-suite record.

### F-INV-01 — Inventory-only Stock Journal / Physical Stock (FIXED)

Inventory-category vouchers (Stock Journal, Physical Stock, Delivery/Receipt Note, Mfg Journal) may now be **inventory-only** through the real UI: zero accounting rows (`entries: []`) are accepted when at least one real stock movement (item + non-zero qty) exists. Accounting-only vouchers still require valid, balanced double-entry rows — nothing else was relaxed. A Physical Stock counted quantity cannot be negative. The inventory `kind` enum mismatch (`physical` rejected by schema though sent by the client) was corrected. No phantom accounting entries are created by inventory-only vouchers (TB/BS/P&L/GST/cash/bank/AR-AP untouched). Verified via API regression, adversarial tests, concurrency, cross-company isolation, independent reconciliation, the real browser (`inv/sj-only`, `inv/ps-only` scenarios), and a clean Docker deployment with restart persistence.

### O-1 — Cash/Bank period coverage (CLOSED — NOT REPRODUCIBLE)

**Production Cash/Bank closing logic was verified correct. No production Cash/Bank logic was changed.** The originally suspected all-time-closing defect does not exist: Opening is postings before `from`, Movement is `[from, to]` inclusive, Closing = Opening + Dr − Cr, and future transactions are excluded (controlled reproduction + cross-report audit; code character-identical to v1.0.0). The genuine weakness was a test-coverage gap — every prior check used FY→month-end windows, which cannot distinguish period-correct closing from an all-time sum. Additional regression and UI coverage was added to prevent recurrence: 92 API-level sub-period/boundary/edit/backdate/delete checks (mutation analysis: an all-time closing would fail April δ 1,405, May δ 913, one-day δ 1,412), an independent engine `cashBankSub` snapshot for a fixed May window, and the `jun/cb-subperiod` real-browser scenario that opens a historical report while later vouchers exist, asserting opening, Period Dr/Cr, closing, and the identity from UI-rendered numbers only. O-1 is **not** a production bug fix.

### Verification record (this release)

| Suite | Command | Checks | Result |
|---|---|---|---|
| Smoke | `python3 scripts/smoke_test.py` | 39 | PASS |
| Adversarial attack | `python3 scripts/attack_test.py` | 88 | PASS |
| Bug-fix regression | `python3 scripts/fix_regression.py` | 65 | PASS |
| Independent reconciliation | `python3 scripts/reconcile.py` | 48 | PASS |
| Final regression (F-INV-01 + O-1 + fix attacks) | `python3 scripts/final_regression.py` | 224 | PASS |
| Attack-the-fixes | `python3 scripts/attack2.py` | 29 | PASS |
| Real-browser UI acceptance | `node scripts/acceptance/run.js` | 129 | PASS |
| Typecheck | `npm run typecheck` | — | PASS |
| Docker fresh volume + restart persistence + in-container probes | `docker compose down -v && build && up -d && restart` | — | PASS |

**Total: 622/622 checks — zero failures** (v1.0.0 was 483; +139, none removed or weakened).

### Detailed F-INV-01 / O-1 work record

### Fixed: F-INV-01 (P3) — inventory-only Stock Journal & Physical Stock via UI

**Original behavior:** the client unconditionally rejected vouchers with zero ledger entries, so an inventory-only Stock Journal (godown-style transfer) or Physical Stock count could not be composed or saved through the UI, even though the server already supported them.

**Correct semantics (documented):**
- *Accounting-only* vouchers (Payment, Receipt, Journal, Sales, Purchase, …) still require ≥1 non-zero, balanced ledger entry — unchanged.
- *Inventory-category* vouchers (Stock Journal, Physical Stock, Delivery/Receipt Note, Mfg Journal) may be **inventory-only** (`entries: []`) when at least one valid inventory row (item + non-zero qty) exists; mixed inventory + accounting vouchers behave exactly as before.
- A Physical Stock counted quantity cannot be negative (a count is an absolute quantity).
- No artificial accounting entries are created: TB, BS, P&L, GST, cash/bank and AR/AP are untouched by an inventory-only voucher; only stock position/valuation move (server and the independent engine share these documented semantics — the engine was not changed to force agreement).

**Implementation (minimal):**
- `server/src/routes/vouchers.ts` — `assertLedgersTx` allows zero ledger ids (reference validation for the ids that exist); `validateEntries` remains the authoritative gate and only permits the zero-entry case for inventory-category vouchers with ≥1 real movement; new `assertPhysicalRows` rejects negative counted quantities; both POST and PUT are covered.
- `client/src/pages/VoucherScreen.tsx` — the save gate permits zero ledger rows only when the voucher type is inventory-category and a valid inventory row exists; small hint shown for inventory-only composition; ledger grid stays fully usable for mixed vouchers.
- No changes to stock valuation, FIFO/WAV algorithms, accounting posting, numbering, bill allocation or company isolation.

**Latent defect also fixed en route:** the Zod inventory-row schema accepted only `stock|source|target` while the client sends `kind: "physical"` for Physical Stock — the value is now part of the schema enum, and `stock.ts` handling of it is unchanged.

### Closed: O-1 (P4) — NOT REPRODUCIBLE, coverage added

Phase 1 investigation (no code changed) proved the alleged defect does not exist: Cash/Bank receives the correct `from`/`to`; Opening is postings before `from` (`≤ from−1`); Movement is `[from, to]` inclusive; Closing = Opening + Dr − Cr; future transactions are correctly excluded (controlled reproduction: April report with a May +500 voucher shows closing 10,060, not 10,560); the relevant code is character-identical to v1.0.0; the cross-report audit found no affected report. **No production Cash/Bank logic was modified.**

The original observation is attributed to a coverage gap: every existing check used FY→month-end windows, which cannot distinguish period-correct closing from an all-time sum.

**Test-only remediation (+128 checks):**
- `scripts/final_regression.py` — 92 new checks on a dedicated probe ledger (opening 10,000) with boundary-placed vouchers: April window excludes May/June; May opening = April closing (continuity); one-day windows; `to`-inclusive canary (Apr 30 +7 in April, May 1 +3 in May); future canary (Jun 10 +900 excluded from every historical window); empty late window; identity `closing = opening + Dr − Cr` per window; edit-into-period (+50), backdate-out-of-period (April/May opening shift, June cumulative invariant), and delete-remove-effect propagation. Mutation analysis: an all-time closing would fail April (δ 1,405), May (δ 913) and one-day (δ 1,412) assertions.
- `scripts/acceptance/engine.py` — `cashBankSub` snapshot: the independent engine's period-correct `cash_bank()` computed for a fixed May 1–31 window (no accounting-semantics change).
- `scripts/acceptance/run.js` — `jun/cb-subperiod` real-browser scenario: the May Cash/Bank report opened in the browser while June vouchers exist; per-ledger UI closing/movement vs the independent engine, opening via ledger drill-down, the identity recomputed from UI-rendered numbers only, and a canary that the May-window closing differs from the FY-window closing.

**Verification:**

| Suite | Command | Checks | Result |
|---|---|---|---|
| Smoke | `python3 scripts/smoke_test.py` | 39 | PASS |
| Adversarial attack | `python3 scripts/attack_test.py` | 88 | PASS |
| Bug-fix regression | `python3 scripts/fix_regression.py` | 65 | PASS |
| Independent reconciliation | `python3 scripts/reconcile.py` | 48 | PASS |
| Final regression (incl. F-INV-01 + O-1 sub-period coverage) | `python3 scripts/final_regression.py` | 224 | PASS |
| Attack-the-fixes | `python3 scripts/attack2.py` | 29 | PASS |
| Real-browser UI acceptance (incl. `inv/sj-only`, `inv/ps-only`, `jun/cb-subperiod`) | `node scripts/acceptance/run.js` | 129 | PASS |
| Typecheck | `npm run typecheck` | — | PASS |
| Docker fresh volume + restart persistence + in-container inventory-only SJ | `docker compose down -v && build && up -d && restart` | — | PASS |

**Total: 622/622 checks passed — zero failures** (baseline was 483 at v1.0.0; +35 F-INV-01 checks, +104 O-1 API-level checks within final_regression, +12 O-1 UI checks, +12 acceptance-rig checks from the F-INV-01 scenarios; none removed or weakened).

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

- None open. O-1 (P4) is **CLOSED — NOT REPRODUCIBLE**: the application was verified correct (see the O-1 section above); only regression coverage was added.

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
