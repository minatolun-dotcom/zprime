# zprime — FINAL QA REPORT (Adversarial Pass)

**Date:** 2026-09-08 · **Suites:** `scripts/smoke_test.py` (39 checks, happy paths) + `scripts/attack_test.py` (88 checks, adversarial) + manual probes
**Plan:** see `QA_PLAN.md` · **Bug inventory:** see `BUG_REPORT.md`

## Totals

| | Count |
|---|---|
| **Total checks executed** | **127** (39 smoke + 88 attack) |
| **Passed** | **118** |
| **Failed** | **9** (→ 9 confirmed bugs) |
| **Blocked** | 0 |
| **Not tested** | UI/keyboard flows, long-horizon perf, Docker chaos (see below) |

## Bugs by severity

| Severity | IDs |
|---|---|
| **P0 catastrophic** | — none found |
| **P1 critical** | BUG-002 (bill-wise accepts wrong-party / mismatched allocations) |
| **P2 major** | BUG-001 (voucher number reuse + concurrency duplicates), BUG-003 (zero/negative vouchers accepted), BUG-004 (invalid date → 500 + SQL leak), BUG-009 (CSV escaping/formula injection — P2 when exported to Excel) |
| **P3 moderate** | BUG-005 (nonexistent company → 200 []), BUG-007 (duplicate ledger name → 500), BUG-008 (unbounded narration) |
| **P4 minor** | BUG-006 (misleading `{ok:true}` on no-op delete) |

## Category verdicts

**Accounting** — Core engine held under every attack: single-sided, unbalanced, zero, empty, nonexistent-ledger, null-ledger, string-amount, NaN, Infinity, 1e15, 0.005 sub-paisa — all either correctly rejected or posted with TB/BS still balanced to the paisa. Period carry-forward verified (`Mar closing 500 = Apr opening 500`).

**GST** — 18%/5% rate cases incl. hard-rounding values (99.99, 100.01, 1234.56, 1.01) post cleanly; GSTR-1 totals finite and consistent. Not attacked: RCM, CESS, exempt/nil-rated mixes, multi-rate invoices (out of scope of implemented helper; noted as coverage gap).

**Inventory** — Negative-stock sale handled without crash; nonexistent item rejected cleanly with **no orphan voucher** (atomicity verified in DB). FK `inventory_entries_item_id` = NO ACTION prevents item deletion corrupting history. Deep FIFO/backdated-layer attacks not executed this pass (smoke suite covers weighted-avg and basic FIFO).

**Payroll / TDS** — Smoke suite covers posting, duplicate-month guard, TDS by section. Adversarial variants (salary change after processing, employee deletion after payroll, threshold boundaries) **not yet executed** — flagged, not failed.

**XML import** — Malformed/empty/huge/SQLi-laden XML all handled without crash or injection; duplicate skipping verified in smoke suite. Memory-bomb scale (100 MB+) not tested.

**Security** — Unauthenticated access to companies and company data: **blocked** (401/403). Forged JWT: rejected. SQLi in login/search/XML: parameterized, no effect. Cross-company IDOR on read/update/post: **blocked** on every vector tested. The only isolation wart is response-shape (BUG-005/006), not data exposure. Single shared login (`admin/admin123`, no roles) remains a deployment-level risk for multi-user installs.

**Data integrity** — Referential integrity solid: deleting posted ledgers/parties/items is FK-blocked (0 orphan rows in DB after the full attack run). Voucher cascade deletes children atomically. Atomicity on failed saves verified (no partial vouchers).

**UX / Keyboard** — Not executed (headless). Highest-priority remaining risk area, since keyboard-first operation is a core product claim.

**Performance** — Small-data latencies excellent (masters 0.01 s, TB 0.02 s, BS 0.04 s). Known scaling smell: per-row `sum()` subquery in Day Book listing; unbounded `.limit(5000)` list. No 10k-voucher soak test run.

**Docker / Database** — Previously verified live (build, boot migrations, healthcheck, seeded login). Restart/chaos drills not re-run in this pass.

## Reconciliation summary

| Identity | Status |
|---|---|
| Total Debits = Total Credits | ✅ PASS (all attack scenarios) |
| Assets = Liabilities + Capital | ✅ PASS (BS difference ≈ 0 after full attack dataset) |
| Ledger totals = Trial Balance | ✅ PASS |
| Sales transactions = Sales Register | ✅ PASS (smoke) |
| Purchase transactions = Purchase Register | ✅ PASS (smoke) |
| Stock movements = Stock Summary | ✅ PASS (smoke) |
| GST transactions = GST reports | ✅ PASS (smoke + rate-matrix probes) |
| TDS transactions = TDS report | ✅ PASS (smoke) |
| Payroll vouchers = Salary Register | ✅ PASS (smoke) |
| Outstanding = Bills Receivable/Payable | ⚠️ PARTIAL — bill-level allocations can be corrupted via API (BUG-002); ledger-level totals remain correct |

## Scores

| Area | Score | Notes |
|---|---|---|
| Accounting correctness | **8.5/10** | Engine solid; zero/negative-voucher acceptance and bill-level validation gaps |
| GST correctness | **8/10** | Core rates verified; RCM/CESS/exempt untested |
| Inventory correctness | **8/10** | Atomic, FK-safe; FIFO edge cases untested |
| Payroll correctness | **8/10** | Happy paths verified; adversarial variants pending |
| TDS correctness | **8/10** | Section posting verified; threshold edges untested |
| Data integrity | **8.5/10** | FK design excellent; numbering uniqueness missing |
| Security | **8/10** | Auth + isolation held under attack; single-user model limits exposure |
| Keyboard UX | **n/t** | Requires browser session |
| General UX | **n/t** | Requires browser session |
| Performance | **7.5/10** | Fast at small scale; N+1 smell, no soak test |
| Docker reliability | **8.5/10** | Verified live earlier; chaos drills pending |

## Release status: **SHIP WITH CONDITIONS**

Why not clean SHIP: BUG-002 corrupts bill-level receivables truth via plain API calls, and BUG-001 produces duplicate statutory invoice numbers — both are accounting-credibility defects a real business would hit within weeks.

Must-fix before trusting real books (all small, well-localized fixes):
1. **BUG-001** — unique index on (company, type, number) + max-based numbering in a transaction.
2. **BUG-002** — validate bill allocations (party match, amount ≤ entry/outstanding, sign).
3. **BUG-003/004** — tighten Zod (non-zero amounts, calendar dates) and map DB errors to 400.

Should-fix soon: BUG-005/006/007 (response contracts), BUG-009 (CSV escaping).

Then schedule: browser-based keyboard-UX pass, payroll/TDS adversarial variants, 10k-voucher soak, Docker restart drills.
