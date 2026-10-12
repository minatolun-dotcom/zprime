# R-89 INVESTIGATION — transaction/voucher workflow correctness audit

**Date:** 2026-10-10 · **Operator request:** "hardened the transaction/voucher workflow and correctness" → audit the existing workflow.
**Mode: INVESTIGATION — ZERO production code changed.** Baseline: v1.75.0 (`edda6c2`) + two OPERATOR_NOTES docs commits (`68a4c52`, `ed14bf2`).
**Evidence basis:** full source walk of `server/src/routes/vouchers.ts` (1,278 lines), `db/schema.ts` constraints, `services/accounting.ts` reporting, `routes/import.ts` re-use, **plus live probes against the running compose rig** (disposable scratch company id 4, since deleted-by-hand left in place — see Limitations).

---

## Verdict

**The voucher write path is already materially hardened — the R-series hardening stack is real and demonstrably live.** The write path is a single-transaction, DB-constraint-final-authority design with idempotent creation, race-safe serial numbering, FOR-UPDATE party serialisation, chain-comparison stock gating, and mark+exclude cancellation. **No P0/P1 defect found.** Two LOW observations and documentation gaps noted below — none break accounting correctness.

## Architecture as verified (source walk)

- **One transaction per mutation:** create (`insertVoucherTx`), edit, accept, cancel, uncancel, delete all run inside `db.transaction`; the audit event (`recordAuditEvent`) rides the same transaction ("an event exists iff the change committed" — R-18), a failed posting aborts body+event+counter draw atomically.
- **DB is the final authority:** `vouchers_company_type_fy_number_uq` (posted rows, `(company, type, fy, number)`, partial index `is_optional = false`) + the optional-class twin + `counter_company_type_fy_uq` + `idempotency_keys_company_key_uq`. Application guards are defence-in-depth, never the sole barrier.
- **Numbering race-safe:** counter row advanced under `UPDATE … RETURNING` row lock (no read-modify-write window); collisions on 23505 burn a number OUTSIDE the retry transaction (max 5 attempts) so a rolled-back draw can't repeat; FY-bucket scoped (R-57).
- **Idempotency (R-10):** one key = one business event; concurrent replays of the same key return the winner's voucher (both DB race paths covered: pre-check read + 23505 fallthrough), key written in the same tx.
- **Bill-wise (R-69/R-70/A-02):** party ledgers FOR UPDATE sorted by id (deadlock-free serialisation); allocation direction must match entry sign; allocations must total the entry; `against_ref` must reference an OPEN bill of the same ledger, opposite sign, never exceeding open amount (+ in-voucher consumption tracking); `new_ref` name uniqueness across the company is race-safe because of the earlier lock. Cancel/delete share ONE settled-bill rule (`assertNoOutgoingSettlementsTx`) — model A (mark+exclude) never resurrects settlements.
- **Stock (R-06):** chronological replay with chain comparison — a mutation is rejected only when the AFTER-chain has MORE invalid steps than the BEFORE-chain; grandfathering for pre-R-06 negatives; same exported guard reused by the XML import path (one guard, two callers).
- **Value semantics:** all arithmetic via `r2()` (2-dp rounding); zero-amount entries and zero totals rejected for accounting vouchers; inventory-category vouchers follow F-INV-01 (inventory-only allowed iff real stock movements exist); ORDER types have no ledger postings (commitment only).
- **Provance & auth:** every route behind `cid()` membership; every voucher stamped `created_by`/`updated_by`; R-13 timing-equalised login; R-18 append-only audit (voucher_id ON DELETE SET NULL so delete's trail survives).
- **Import parity (R-04):** import.ts imports `validateEntries` + `assertStockAvailabilityTx` — the identical double-entry and stock rules, no divergent copy.

## Live probe results (running rig, disposable data)

| Probe | Result |
|---|---|
| Global Dr=Cr: `sum(amount)` per voucher ≠ 0 for all non-cancelled posted vouchers | **0 rows — PASS** |
| 24 concurrent POSTs (balanced Journal, auto-numbering) | **24/24 OK, numbers 1…24 distinct AND contiguous, zero collisions, zero retries surfaced** |
| Per-voucher balance after the 24-way race | **all sum exactly 0.00** |
| Unbalanced voucher (−50/+40) | **400 "Debits and credits do not balance (difference −10.00)"**; Day Book still exactly 24 rows — **no partial state** |
| 8 concurrent POSTs sharing one `x-idempotency-key` | **8×200, 1 distinct voucher — replays return the winner** |
| Precision: 1100.10 posted → returned | **−1100.1 / +1100.1 float-exact through API + DB numeric** |
| Balance dust ±0.004 | **tolerated (200)** per documented rule |
| Balance dust ±0.01 | **rejected (400)** |
| Cross-company read: fetching a company-1 voucher id under company-4 path | **404 neutral — no existence leak, no isolation breach** |

## Findings (no code changed)

| # | Severity | Finding |
|---|---|---|
| F-89-1 | **LOW (observation)** | Auto-number 23505 burn-on-collision retry loop is `for attempt < 5` — at pathological contention >5 concurrent same-type writers could exhaust attempts (returns 409 "Could not allocate a unique voucher number", no corruption, atomic rollback protects books). 24-way probe showed zero retries; verified-safe posture, worth a comment only. |
| F-89-2 | **LOW (observation)** | `GET /vouchers/:id` runs `nextNumber` peek per OPTIONAL-voucher read (inline, outside tx) — read-only, no counter mutation; only cost is one extra query per draft detail view. Correct as designed (R-73 F-73-1); noted so a future "how many drafts can I open fast" question has this answer. |
| F-89-3 | **DOC GAP** | The hardening guarantees above are enforced in code + suites but nowhere summarised as a single prose contract for operators. Fold the table above into OPERATOR_NOTES/README "Transaction guarantees" section next docs pass (no code). |
| F-89-4 | **INFO** | `DELETE /companies/:id` route does not exist (only /logo, /members/:userId, /irp-credentials) — scratch audit company id 4 can't be deleted via API. Not a defect (no requirement); noted as the cleanup limitation of this investigation. |

## NOT A BUG — VERIFIED (checked and healthy)

- Atomicity: no partial vouchers left behind on validation failure (probe row counts).
- Numbering under concurrency: contiguous 1–24, no duplicates, no gaps (probe).
- Idempotency replay semantics (probe).
- Monetary precision at paisa level through API + numeric storage (probe).
- Cross-company isolation on voucher fetch (probe).
- Import path parity with API guards (source: `import.ts` imports the exported guards).

## Scope of this investigation

- Vouchers.ts write/read surface + schema constraints + accounting.ts TB/P&L correctness (trialBalance difference field is display-only per R-14; ledgerBalances openings were fixed R-56 to fold pre-books-begin vouchers).
- NOT covered (out of scope, untouched): GST report engine internals (gstr9.ts), e-invoice/IRP handshake, payroll posting flow, import XML parsing beyond guard parity.

## Next step

Per protocol: operator picks A) record F-89 findings and close with docs-only follow-up (recommended — no defect found), B) request deeper targeted audit (e.g. GST engine), or C) decline. No implementation cycle warranted on current evidence.
