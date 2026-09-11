# zprime — REGRESSION TEST SUMMARY

**Date:** 2026-09-08 · After fixes for BUG-001…BUG-009.

## Before → After

| | Before fixes | After fixes |
|---|---|---|
| Total checks | 127 (39 smoke + 88 attack) | **269** (39 smoke + 88 attack + 65 fix-regression + 29 fix-attack + 48 reconciliation) |
| Passed | 118 | **269** |
| Failed | 9 findings | **0** |
| Open bugs | 9 (1×P1, 3×P2, 3×P3, 1×P3, 1×P4) | **0 open** (all 9 fixed & regression-tested) |

## Per-bug regression coverage

| Bug | Fix verified by | Checks |
|---|---|---|
| BUG-002 bill allocations | wrong/nonexistent/wrong-party bills, over/under allocation, direction, partial+full settlement lifecycle, race serialization, edit-shrink, delete guards, receivables reconcile | 16 + 5 (attack2) |
| BUG-001 numbering | delete-no-reuse, manual dup 409, per-type isolation, prefix/startNumber, 12-way + **50-way** concurrency (unique & sequential), restart, FY-crossing, 2-company concurrency, import counter sync | 8 + 10 (attack2) |
| BUG-003 zero/negative | zero voucher/entry/sub-paisa rejected; balanced ± journal and inventory-only stock journal valid | 5 |
| BUG-004 dates | 7 impossible/edge dates, leap-year acceptance, query-string dates, nested bill/cheque/ref dates, malformed JSON, no internals leaked | 10 + 3 (attack2) |
| BUG-009 CSV | RFC 4180 escaping + formula guard in shared lib; single producer wired through it | manual/unit |
| BUG-005 company ids | bogus/negative/near-miss ids → 400/404, never `200 []` | 3 |
| BUG-006 delete contracts | nonexistent → 404; settled-invoice delete blocked; in-use master delete → explicit 400 | 5 |
| BUG-007 unique violations | duplicate names on ledgers/companies/employees → 400 (was 500) via drizzle-error unwrapping | 3 |
| BUG-008 field caps | oversized narration/name rejected with 400 and not stored; caps on all free-text schema fields | 4 |

## Attack-the-fix highlights (all passed)

- **50 concurrent auto-numbered vouchers**: 50/50 succeeded, numbers unique **and** exactly sequential 1..50 (atomic `UPDATE…RETURNING` counter + unique index).
- **Concurrent settlement race**: two simultaneous 600-settlements of a 1,000 bill — exactly one accepted; open amount stays exactly 400 (`FOR UPDATE` party lock).
- **Payroll double-run race**: one 200, one 4xx; TB balanced; no double salary.
- **Restart resilience**: next number identical after full server restart (counter is DB state, not memory).
- **FY boundary**: 2026-03-30 → 2026-04-02 payments numbered uniquely, in order.
- **XML import with duplicate in-file voucher numbers**: 1 imported, 1 skipped; auto numbering afterwards skips imported numbers.
- **200-entry voucher** (100 debits × 1.01 vs 100 credits × 1.01): accepted, balanced.

## Smoke-test independence

The original `smoke_test.py` was **not modified** to accommodate fixes. One attack-suite expectation was corrected for policy reasons only (balanced ± journal is valid accounting — BUG-003 Phase-3 decision); the smoke suite itself passes as-is: **39/39**.

## Verdict

All 9 QA findings are fixed, each with regression coverage at the API boundary, and each fix was then attacked (concurrency, restart, edits, deletes, races). Full reconciliation against hand-computed numbers confirms every accounting identity.

**Recommended status: SHIP.**

---

# Final acceptance-repair pass — regression summary (2026-09-10)

All suites re-run after the A-01…A-07 / F-GRP-01 / F-TDS-01 fixes on a fresh schema:

| Suite | Checks | Result |
|---|---|---|
| smoke_test.py | 39 | PASS |
| attack_test.py | 88 | PASS |
| fix_regression.py | 65 | PASS |
| reconcile.py | 48 | PASS |
| final_regression.py (new) | 97 | PASS |
| attack2.py | 29 | PASS |
| UI acceptance (Playwright, 3 months of books) | 117 | PASS |

**483 checks, 0 failures.** No legacy expectation was changed except two documented probe corrections inside `final_regression.py` itself (its own group-count check now counts reserved groups instead of absolute rows, and the "Bank OD A/c" parent probe — Bank OD legitimately allows children; the no-children rule covers only Primary and Profit & Loss A/c, already probed via "Under Primary").

New regression coverage added this pass: group nature inheritance (incl. empty-string client payloads), reserved-parent rules, TDS section validation/bounds, ₹1,215 IGST-vanishing case (A-07), bill-name collisions across types (A-02), negative payroll deductions (A-03), TDS deduction vs remittance split (A-04), on-account outstanding merge (A-05), sub-period P&L (A-06).
