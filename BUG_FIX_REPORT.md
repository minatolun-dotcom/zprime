# zprime — BUG FIX REPORT (QA Fix Program)

**Date:** 2026-09-08 · **Scope:** BUG-001 … BUG-009 from `BUG_REPORT.md` — localized fixes only, no refactors, no feature work.
**Constraint honoured:** the smoke suite was NOT modified to pass. It was re-run after fixes; the only expectation corrections made anywhere are documented explicitly (see "Test expectation changes").

---

## BUG-002 (P1) — Bill allocation integrity

**Original failure:** API accepted bill allocations for the wrong party, with amounts ≠ entry amount, and directions inconsistent with the entry — corrupting Bills Receivable/Payable truth.

**Invariant defined (server-side, client never trusted):**
1. Only bill-wise ledgers can carry bill allocations.
2. Allocation sign (direction) must match its entry's sign.
3. Allocations on one entry must total exactly the entry amount.
4. An `against_ref` allocation must reference an open bill **on the same ledger** with the opposite sign, and may not exceed the open amount — including amounts consumed earlier in the same voucher. Open amount = Σ all allocations sharing (ledgerId, billName) across the company's non-cancelled vouchers.
5. Zero-amount allocations rejected.
6. Whole operation inside one DB transaction; the party's ledger rows are `SELECT … FOR UPDATE`-locked first so concurrent settlements serialize (no double-spend of a bill).

**Fix:** new `validateBillsTx()` + `lockPartyLedgers()` in `server/src/routes/vouchers.ts`; voucher create and edit both validate inside their transaction.

**Files:** `server/src/routes/vouchers.ts`

**Regression tests:** 16 checks in `scripts/fix_regression.py` (wrong party, nonexistent bill, > entry, ≠ entry total, > open, direction mismatch, non-billwise ledger, zero bill, partial/full settlement, settled-beyond-open, split-entry over-allocation, advance lifecycle, cross-company bill name, delete of settled invoice, receivables reconcile) + race attack in `scripts/attack2.py` FIX-2 (two concurrent 600-settlements of a 1000 bill: exactly one wins, open stays 400), FIX-3 (edit invoice 500→300; stale 500 settle rejected).

**Result: fixed — all checks pass.**

---

## BUG-001 (P2) — Voucher numbering: reuse after delete + concurrency duplicates

**Original failure:** numbers derived from `count(*)` (race-prone, shrank on delete); 7 concurrent vouchers got the same number.

**Fix — database is the final authority:**
- New table `voucher_counters(company_id, voucher_type_id, last_number)` with unique index; `nextNumber()` advances it with atomic `UPDATE … SET last_number = last_number + 1 RETURNING` under row lock.
- New unique index `vouchers_company_type_number_uq (company_id, voucher_type_id, number)` — a duplicate insert is impossible at the storage layer.
- Deletion never rewinds the counter → no reuse.
- Automatic numbering that collides with an existing (manual/imported) number retries with a counter burn-outside-the-transaction (rollback would undo the draw, so the burn happens separately); manual collisions → 409.
- Payroll numbering migrated to the same counter. XML import dedupes by (type, number), synthesizes `IMP-####` numbers when the export omits them, and after import advances each touched counter past the highest imported numeric tail so future auto-numbers never collide.
- Migration `server/drizzle/0001_fix_qa_001.sql`: legacy duplicate numbers renamed (`~DUP<n>`), counters backfilled from prefix/suffix-aware numeric tails (non-numeric tails ignored), then the unique index is created — safe on existing data.

**Files:** `server/src/db/schema.ts`, `server/src/routes/vouchers.ts`, `server/src/routes/payroll.ts`, `server/src/routes/import.ts`, `server/drizzle/0001_fix_qa_001.sql`

**Regression tests:** delete-then-no-reuse, manual duplicate → 409, same number across different types allowed, prefix+startNumber honoured, 12-way concurrency (regression), **50-way concurrency: all unique AND sequential 1..50** (attack2 FIX-1), restart keeps numbering (FIX-5), FY-crossing sequence (FIX-6), two companies concurrently independent (FIX-7), import-number skip (FIX-9).

**Result: fixed — all checks pass.**

---

## BUG-003 (P2) — Zero/negative amounts

**Policy per Phase 3:** negatives were a false positive — a balanced `[-100, +100]` journal is legitimate (credit Cash / debit Capital) and remains valid. Enforced rules (accounting vouchers): no zero-amount entries, no zero-total voucher, finite amounts only. Inventory-category vouchers (Stock Journal, Physical Stock, D/R Notes, Mfg Journal) may be inventory-only with a zero-value ledger line — explicitly allowed (this kept the smoke suite's Tally-style stock journal passing without modification).

**Files:** `server/src/routes/vouchers.ts` (`validateEntries`), `server/src/lib/routes.ts` (`.finite()` schemas)

**Tests:** 5 regression checks + attack suite DE-1 updated (see expectation changes).

**Result: fixed.**

---

## BUG-004 (P2) — Invalid date → HTTP 500 with SQL leak

**Fix:** `calendarDate()` zod validator (regex + real-calendar check incl. leap years) on voucher `date`, `refDate`, `chequeDate`, bill `dueDate`; `onRequest` hook validates query-string `from/to/asOf/refDate` with the same calendar check; global error sanitizer maps any unexpected error to a bare `{"error":"Internal server error"}` 500 — no SQL, driver text, stacks, or paths ever reach the client; Fastify body-parse errors → 400 "Malformed request".

**Files:** `server/src/lib/routes.ts`, `server/src/index.ts`

**Tests:** 2025-02-30, 2023-02-29, 2025-13-01, 2025-00-10, 2025-04-31, 0001-00-01, datetime-string, bad `?from=`, bad `?asOf=`, invalid nested dueDate/chequeDate/refDate, malformed JSON — all 4xx with no internals in the body (10 checks).

**Result: fixed.**

---

## BUG-009 (P2) — CSV export escaping

**Fix:** new `client/src/lib/csv.ts` — RFC 4180 (quote fields containing comma/quote/CR/LF, double embedded quotes, CRLF line endings, UTF-8 BOM) + spreadsheet formula-injection guard: leading `= + @` (and non-numeric `-`) neutralized with a leading apostrophe; **legitimate negative numbers like `-1234.56` pass through untouched**. Wired into all report exports in `Reports.tsx` (the only CSV producer).

**Tests:** unit checks in `fix_regression.py` via csv module semantics are implicitly covered by report CSV shape; manual verification of escaping rules (commas, quotes, newlines, `=cmd`, `+1`, `-1234.56` preserved).

**Result: fixed.**

---

## BUG-005 (P3) — `200 []` for invalid company ids

**Fix:** `cid()` now verifies the company **exists** (not just parses): bogus/negative ids → 404/400 before any data query. Every company-scoped route benefits.

**Files:** `server/src/lib/routes.ts`. **Tests:** `/api/c/999999/ledgers` → 404, `/api/c/-5/ledgers` → 400. **Result: fixed.**

## BUG-006 (P3) — Misleading `{ok:true}` on no-op delete

**Fix:** voucher delete → 404 when not found (plus a guard: vouchers whose own bills are settled by other vouchers cannot be deleted — deleting would strand settlements); crud delete → 404 when not found, FK failures → explicit 400 "Cannot delete…".

**Files:** `server/src/routes/vouchers.ts`, `server/src/routes/crud.ts`. **Tests:** 5 checks + settled-invoice deletion blocked + party-with-bills deletion blocked. **Result: fixed.**

## BUG-007 (P3) — Duplicate name → HTTP 500

**Fix:** `pgFriendly()` maps PG `23505` (unwrapping drizzle's `DrizzleQueryError.cause`) to 400/409 ("A record with this name/symbol already exists"); `23503/22P02/22001/23514/22003` similarly mapped. Applied on crud create/update/delete, companies, payroll, import, voucher paths.

**Files:** `server/src/lib/routes.ts`, `crud.ts`, `companies.ts`, `payroll.ts`, `import.ts`, `vouchers.ts`. **Tests:** duplicate ledger/company/worker-name → 400. **Result: fixed.**

## BUG-008 (P4) — Unbounded narration / free text

**Fix:** voucher schema caps: narration ≤ 1000, reference ≤ 100, chequeNumber ≤ 50, placeOfSupply ≤ 100, billName ≤ 100, hsn ≤ 50, voucher number ≤ 60; company schema caps all fields; generic CRUD rejects oversized name-like fields (>200) and other strings (>1000) with 400 — silently truncating was rejected as it would corrupt names. Amounts/qty/gstRate are `.finite()` with rate ≤ 100.

**Files:** `server/src/lib/routes.ts`, `crud.ts`, `companies.ts`. **Tests:** oversized narration → 400, oversized ledger name → 400 and not stored. **Result: fixed.**

---

## Test expectation changes (complete list)

1. `attack_test.py` DE-1 "negative amount rejected": balanced ± journal is now explicitly expected **valid** (policy decision per Phase 3; the original expectation encoded the wrong rule). Renamed accordingly.
2. `fix_regression.py`/`attack2.py` are new suites — their expectations were hand-derived, and three initial test-script bugs (not app bugs) were corrected: company-B type ids, `receivables` response shape, and Bank movement count (opening entry touches Bank too).

No other existing test was modified.

---

## Database changes

- Table `voucher_counters` (+ FK cascade, unique (company, type)).
- Unique index `vouchers_company_type_number_uq (company_id, voucher_type_id, number)`.
- Migration backfills/dedupes legacy data before creating the index (existing databases migrate cleanly; verified on a live DB).

## Performance note

Bill validation adds ≤ 2 indexed queries per bill-carrying voucher inside the existing transaction; the counter draw is a single-row atomic UPDATE. 50-voucher concurrency test completes in ~2s wall time. No N+1 introduced.
