# zprime — BUG REPORT (Adversarial QA Pass)

**Date:** 2026-09-08 · **Tester:** Adversarial QA suite (`scripts/attack_test.py` + manual probes)
**Environment:** Linux, Node 22 (tsx), PostgreSQL 16 in Docker (`zprime-test-pg`), fresh schema per run
**Scope:** API-level black-box + code-level root-cause analysis. UI/keyboard flows not executed (headless environment) — see "Not tested".

**Result of attack suite: 79 checks passed, 9 findings confirmed.**

Severity mix: 1 × P1 (data integrity), 4 × P2, 3 × P3, 1 × P4. **No P0 found** — auth, company isolation, double-entry enforcement, atomicity, and referential integrity all held under attack.

---

## BUG-001 — Voucher number reused after delete; duplicates under concurrency

- **ID:** BUG-001
- **Severity:** P2 (P1 under concurrent multi-user use) · **Priority:** High
- **Module:** Voucher numbering (`server/src/routes/vouchers.ts`)
- **Title:** Auto-numbering is `count(*)+startNumber`, so numbers are reused after deletion and duplicated under concurrent saves
- **Environment:** API, any company
- **Preconditions:** Any voucher type with auto numbering
- **Steps:**
  1. Create Payment #1, Payment #2.
  2. Delete Payment #2.
  3. Create another Payment → gets number **2** again.
  4. Alternatively, fire 8 concurrent creations → 7 of them got number `3` (verified in DB: 7 vouchers sharing number `3` for the same type).
- **Expected:** Deleted numbers are never reused; concurrent saves get unique numbers.
- **Actual:** Number = row count, so any delete shrinks the count and the next voucher collides with an existing legal document number. Concurrent inserts race between `count(*)` and insert.
- **Reproducibility:** Always.
- **Accounting impact:** Duplicate voucher numbers on legally significant documents (invoices) — audit/GST-filing hazard; does not break Dr=Cr.
- **Security impact:** None.
- **Data integrity impact:** High — invoice numbering is a statutory requirement (GST invoices must be sequential and unique).
- **Root cause:** `nextNumber()` (vouchers.ts:27-34) computes `count(*) + startNumber`. No uniqueness constraint on `(company_id, voucher_type_id, number)`; no sequence; no transaction/lock.
- **Affected code:** `server/src/routes/vouchers.ts` — `nextNumber()`, `insertVoucher()`; `server/src/db/schema.ts` — `vouchers` table (no unique index).
- **Suggested fix:** Add `uniqueIndex("vouchers_company_type_number_uq").on(companyId, voucherTypeId, number)`; derive next number from `max(cast(number as integer))` inside the insert transaction (or a per-company-type counter table with row lock). On unique-violation retry.
- **Regression test required:** Yes — add to `scripts/attack_test.py` (already present: "concurrent numbering unique", "number reuse after delete").

## BUG-002 — Bill allocation accepts wrong party and mismatched amounts

- **ID:** BUG-002
- **Severity:** P1 · **Priority:** High
- **Module:** Voucher engine — bill-wise (`server/src/routes/vouchers.ts:74-82`)
- **Title:** `against_ref` bills are stored without validating the bill belongs to the same party ledger, or that allocated amount ≤ entry amount / outstanding
- **Environment:** API
- **Preconditions:** Two bill-wise debtor ledgers; an open bill `OV-1` on Debtor A
- **Steps:**
  1. Create receipt on **Other Party** with `bills: [{billType:"against_ref", billName:"OV-1", amount:-10}]` → **accepted (200)**.
  2. Create receipt on Debtor A allocating `amount: 99999` against a 10-rupee entry → **accepted (200)**.
- **Expected:** Reject cross-party bill references and allocations that don't reconcile with the entry amount (Tally rejects both).
- **Actual:** Silently accepted → Bills Receivable shows bills settled by the wrong party, and allocations that don't tie to any real invoice.
- **Reproducibility:** Always.
- **Accounting impact:** High — outstanding/aging reports become unreliable; ledger totals still balance (Dr=Cr holds) but bill-level truth is corrupted.
- **Security impact:** None.
- **Data integrity impact:** High for the receivables/payables subsystem.
- **Root cause:** `insertVoucher()` inserts `billAllocations` rows verbatim from the request; no validation against the party's existing open bills, no check `|sum(bills)| == |entry amount|`, no sign check.
- **Affected code:** `server/src/routes/vouchers.ts` — bill insertion loop; `server/src/lib/routes.ts` — `billSchema` (no cross-field validation).
- **Suggested fix:** In the voucher transaction: for `against_ref`/`advance`, look up the party's open bills (same ledger, same billName) and validate party match, sign, and that cumulative allocation ≤ outstanding; require `on_account`/`new_ref` amounts to sum to the entry amount.
- **Regression test required:** Yes (BILL-3/BILL-4 checks already in `attack_test.py`).

## BUG-003 — Zero-total and negative-amount vouchers accepted

- **ID:** BUG-003
- **Severity:** P2 · **Priority:** Medium
- **Module:** Voucher engine — double-entry validation (`server/src/routes/vouchers.ts:21-25`)
- **Title:** Vouchers whose entries are all zero, or individual negative amounts, pass validation
- **Steps / evidence:**
  - `entries: [{amount: 0}]` → accepted (voucher id 2 created).
  - `entries: [{amount: -100}, {amount: 100}]` (both negative-signed intent, one flipped) → accepted (voucher id 3).
- **Expected:** Reject all-zero vouchers; reject/normalize negative amounts (signed convention is dr+/cr−, so a negative debit is meaningless).
- **Actual:** Stored; pollutes books with meaningless vouchers.
- **Reproducibility:** Always.
- **Accounting impact:** Moderate — TB still balances (they're symmetric), but reports show ₹0 / reversed entries that shouldn't exist.
- **Root cause:** `validateDoubleEntry()` only checks the sum ≈ 0. `voucherEntrySchema.amount` is `z.number()` with no `.positive()`-style sign policy or zero check.
- **Affected code:** `server/src/routes/vouchers.ts:21-25`; `server/src/lib/routes.ts:16`.
- **Suggested fix:** Reject `amount === 0` entries; enforce sign convention (amounts must be non-zero; either forbid negatives or treat them as side-flips explicitly). Optionally reject vouchers where every entry is on the same ledger.
- **Regression test required:** Yes (DE-1 checks in `attack_test.py`).

## BUG-004 — Invalid calendar date `2025-02-30` → HTTP 500 (unhandled DB error)

- **ID:** BUG-004
- **Severity:** P2 · **Priority:** Medium
- **Module:** Voucher create — date validation
- **Title:** Impossible dates crash with 500 instead of a 400 validation error
- **Steps:** `POST /vouchers` with `"date": "2025-02-30"` → `500 Internal Server Error` with raw drizzle SQL failure in the response body.
- **Expected:** 400 with a human-readable message.
- **Actual:** 500 + internal SQL text leaked to the client (minor information disclosure).
- **Reproducibility:** Always.
- **Root cause:** `voucherSchema.date` is `z.string()` (no `z.string().date()` / regex), and Postgres `date` column rejects `2025-02-30` at insert time; error is not mapped to 400.
- **Affected code:** `server/src/lib/routes.ts` — `voucherSchema`; error handler in `server/src/index.ts`.
- **Suggested fix:** `date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !isNaN(Date.parse(v)))` plus calendar validation; add a global error mapper that turns DB errors on user input into 400 and never returns raw SQL in the body.
- **Regression test required:** Yes (FY-2/FY-3 checks in `attack_test.py`).

## BUG-005 — Negative/nonexistent company id returns 200 with empty array

- **ID:** BUG-005
- **Severity:** P3 · **Priority:** Low
- **Module:** Company scoping (`server/src/lib/routes.ts:4-9`)
- **Title:** `/api/c/-1/ledgers` and `/api/c/999999/ledgers` return `200 []` instead of 404
- **Expected:** 404 (or 403) for a company that doesn't exist / isn't yours.
- **Actual:** 200 with `[]` — indistinguishable from a real empty company.
- **Accounting impact:** None direct. **Security impact:** Minor (existence oracle is not leaked since all return empty; but sloppy contract).
- **Root cause:** `cid()` validates numeric-ness only; route handlers never verify the company exists / belongs to the session (single-user app currently masks this).
- **Suggested fix:** After parsing `cid`, `SELECT 1 FROM companies WHERE id = cid` and 404 if absent (cache per-request). Also reject `cid <= 0`.
- **Regression test required:** Yes (ISO-7/ISO-8 checks in `attack_test.py`).

## BUG-006 — Misleading `{ok:true}` on cross-company delete (IDOR ambiguity)

- **ID:** BUG-006
- **Severity:** P4 (verified NOT a data leak) · **Priority:** Low
- **Module:** Voucher delete (`server/src/routes/vouchers.ts:254-259`)
- **Title:** `DELETE /api/c/{B}/vouchers/{A's voucher}` returns `{ok:true}` but deletes nothing
- **Verification:** DB check confirmed voucher id 1 (company A) still exists after the call — the `where(companyId = B)` clause correctly scopes the delete. So this is a **correctness-of-response** bug, not an IDOR.
- **Expected:** 404 when the scoped delete matches 0 rows.
- **Actual:** Blind `{ok:true}`.
- **Suggested fix:** `.returning({id})` and 404 when empty. Same pattern in other delete endpoints.
- **Regression test required:** Yes (ISO-5 check in `attack_test.py`, tighten assertion to expect 404).

## BUG-007 — Duplicate ledger names rejected with HTTP 500

- **ID:** BUG-007
- **Severity:** P3 · **Priority:** Medium (UX-facing)
- **Module:** Masters CRUD (`server/src/routes/crud.ts:63-66`)
- **Title:** Creating a ledger with an existing name (unique index `ledgers_company_name_uq`) surfaces as 500, not 400
- **Steps:** Create "Cap FY"; create "Cap FY" again → 500.
- **Expected:** 400 "Ledger name already exists".
- **Root cause:** `catch {}` in crud.ts swallows the DB error and rethrows generically; unique-violation (23505) is not mapped.
- **Suggested fix:** Catch Postgres code `23505` → `bad("Name already exists")`.
- **Regression test required:** Yes — add check to attack suite.

## BUG-008 — 10,000-character narration accepted unbounded

- **ID:** BUG-008
- **Severity:** P3 · **Priority:** Low
- **Module:** Voucher schema
- **Title:** No length caps on narration/reference/strings; DB `text` columns accept unbounded input
- **Steps:** Voucher with `"narration": "X"×10000` → 200.
- **Impact:** Bloat, report rendering degradation, CSV size. No crash observed.
- **Suggested fix:** `z.string().max(2000)` on narration; sensible caps on names (200), references (100).
- **Regression test required:** Yes — add to attack suite.

## BUG-009 — CSV export: minimal escaping (quotes/newlines/formula injection unhandled)

- **ID:** BUG-009
- **Severity:** P3 (P2 if ledger names with `=cmd` are exported and opened in Excel) · **Priority:** Medium
- **Module:** Client CSV download (`client/src/pages/Reports.tsx:14-21`)
- **Title:** `csvDownload` escapes only commas — not quotes, not newlines, not formula-injection prefixes
- **Evidence:** `const esc = (v) => (typeof v === "string" && v.includes(",") ? \`"${v}"\` : String(v));`
- **Impact:** A ledger named `=HYPERLINK(...)` or containing `"` / newline corrupts the CSV and enables CSV formula injection when opened in Excel.
- **Suggested fix:** Escape `"` by doubling, wrap any field containing `, " \n`; prefix dangerous leading chars (`= + - @`) with `'`.
- **Regression test required:** Yes — add CSV unit check.

---

## Verified NON-bugs (attack outcomes that looked alarming but are correct)

| Check | Outcome |
|---|---|
| Cross-company voucher delete (ISO-5) | Scoped correctly; nothing deleted (only response is misleading → BUG-006) |
| Ledger with postings delete (DEL-1) | FK `voucher_entries_ledger_id_ledgers_id_fk` is `a` (NO ACTION) → blocked; 0 orphan entries in DB |
| Sale with nonexistent item (INV-5) | 400, **no orphan voucher** in day book (atomicity holds) |
| NaN / Infinity amounts | Rejected by Zod (400) |
| SQLi via login, search `q`, XML ledger names | Parameterized queries throughout; no effect |
| Huge XML (600 KB noise) | Parsed without crash |
| `booksBegin` earlier date | Rejected (400) |
| Same-ledger-both-sides | Accepted but TB stays balanced (Tally also allows this) |
| Trial balance / balance sheet after all attack data | Still balanced to the paisa |

## Not tested (requires a browser / long-running environment)

- Keyboard-first UX (F-keys, Ctrl+A, Esc, focus order) — Parts 24; UI is untested headless.
- React state issues: stale caches across company switch, double-submit, multi-tab — Part 25.
- Browser CSV/UX flows, cheque print layout, drill-down clicks.
- Long-horizon performance (10k–50k vouchers) — only smoke-level timings (all <0.05 s at small data volumes; N+1 risk in day-book `amount` subquery noted for scaling).
- Docker restart/chaos drills — covered previously in build verification, not re-run in this pass.
- Payroll/TDS/stock-journal deep attacks — covered by smoke suite happy paths; adversarial payroll variants (salary change after processing, employee delete) not yet executed.
