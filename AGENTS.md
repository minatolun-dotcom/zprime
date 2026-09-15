# AGENTS.md — Rules for Engineering Agents Working on zprime

This file is binding for any AI coding agent (human-directed or autonomous) working in this repository. Read it fully before acting. Then read `CONTINUE.md` to determine the current phase before doing anything.

## Identity

The project is **zprime** — a self-hostable, keyboard-first Indian accounting application.

- Use the name **zprime** in all NEW documentation, code, comments, and reports.
- Historical files may carry `ZLedger` / `BharatBooks` naming (e.g. `ZLEDGER_PRODUCTION_ACTION_PLAN.md`). Preserve such filenames and content where they exist for historical continuity; do not rename them; do not let the old names spread.

## Core principles (in priority order)

1. **Accounting correctness before convenience.** No simplification may break Dr = Cr, valuation, or report reconciliation.
2. **Security before features.** No feature may weaken authentication, company authorization, or isolation.
3. **Data integrity before UX.** No UI convenience may permit corrupt state.
4. **Evidence before assumptions.** Every claim is verified against running code/data, not reports or memory.
5. **Tests are safety barriers.** They are never weakened to make work pass.
6. **Immutable releases.** A tagged release is permanent history.
7. **Minimal scoped changes.** Only what the approved task requires; no unrelated refactoring.
8. **The repository is the source of truth.** Documentation may be stale; code and behavior are not.

## Source-of-truth hierarchy

When sources conflict, trust in this order:

1. **Actual database / running application behavior** (observed via disposable environments)
2. **Source code** (current working tree)
3. **Tests and independent verification** (suites + the independent expectation engine)
4. **Release records** (`RELEASES.md`, git tags)
5. **STATE.md**
6. **ROADMAP.md**
7. **Other documentation** (README, CHANGELOG, ACCEPTANCE_REPORT, audit/plan files)

Conflict handling: do not "fix" documentation by editing unrelated files mid-task. Record the actual current state in the task's output (report, STATE.md update at release time) and, if the discrepancy is material, note it for the human. Never assume documentation is authoritative over code.

## Mandatory lifecycle

Every substantive task follows:

```
INVESTIGATE → REVIEW → APPROVE → IMPLEMENT → VERIFY → BROWSER VERIFY → REGRESSION → RELEASE → UPDATE STATE
```

No phase may be silently skipped. The phase gate is recorded in `CONTINUE.md` (and `DEVELOPMENT_PROTOCOL.md` defines what each phase permits). Investigation-only tasks legitimately stop before APPROVE; feature/bug tasks may not.

## Investigation mode

Investigation means **NO production-code changes**.

Allowed:
- source inspection, database inspection (disposable DB/container), logs
- running the application, API calls, browser testing
- temporary disposable test data, reproduction, analysis
- creating/updating the investigation report file

Not allowed:
- implementation, migration or schema changes, test weakening
- commits, tags
- editing unrelated documentation

If a suspected issue proves correct on inspection, record **`NOT A BUG — VERIFIED`** with evidence. The correct outcome of an investigation may be "no code change required". Do not invent defects to justify work.

## Implementation mode

Implementation is allowed only after a confirmed finding (investigation report) or an approved feature scope, reviewed by the human.

Required before starting:
- exact problem statement
- verified root cause
- expected behavior (objective, testable)
- affected code identified
- acceptance criteria
- regression plan

Rules:
- implement only the approved scope — no unrelated cleanup, no drive-by refactors
- extend tests for the new behavior; never weaken or delete existing tests
- do not release from this mode

## Verification mode

Required, proportionate to the change:
- application/regression suites (`scripts/` — see STATE.md for exact commands and baseline counts)
- adversarial/security tests where security or input handling is touched
- independent accounting verification (`scripts/acceptance/engine.py` — see Independence Rule below)
- browser acceptance for user-facing changes
- fresh Docker verification for deployment-affecting changes
- upgrade verification whenever a migration was added

All existing suites must remain green at their baseline counts. A failing existing test means **investigate the implementation first**, never edit the expectation.

## Accounting rules

Invariants that must hold at all times:

- Monetary calculations must not use floating-point arithmetic; monetary precision (paisa-level) must be preserved.
- Double-entry must remain balanced: every posting Dr = Cr; Trial Balance balances; Balance Sheet satisfies Assets = Liabilities + Capital.
- Inventory-only vouchers follow their defined rules (F-INV-01: inventory-category vouchers need ≥1 real stock movement; accounting-only vouchers need balanced ledger entries).
- GST calculations preserve expected tax semantics; GST booked in ledgers must always appear in GSTR-1/3B (duty heads authoritative).
- Historical reports must not be contaminated by future transactions (O-1 period semantics).
- Cancelled transactions are excluded consistently from active reports and restored exactly on uncancel (R-02 Model A: mark + exclude, no reversal entries).
- Bill-wise allocations preserve integrity (same company, correct party, amount ≤ open bill).
- Transactions are atomic — failures leave no partial state.

**Never change accounting semantics merely to make tests pass.** If a test and the correct accounting outcome disagree, the test is wrong — surface it to the human.

## Security rules

- Every data route requires authentication and company authorization (`cid()` membership — R-03).
- Resource-to-company validation is mandatory defense-in-depth on top of route-level authorization.
- No IDOR: resource IDs alone never grant access across companies.
- Never trust client-supplied ownership (body/query companyId or userId).
- No cross-company data access or existence leaks (unauthorized ⇒ 404, indistinguishable from unknown).
- Safe error handling: no SQL, stack traces, filesystem paths, or internal details in responses.
- No secrets or debug credentials in source; no default credentials survive to exposed deployments.

## Database rules

- Migrations are additive by default; destructive migration requires an explicit human stop-and-approve.
- Transaction safety for every multi-row mutation.
- Appropriate FK behavior (ON DELETE chosen deliberately), uniqueness where integrity requires it, indexes on authorization-critical paths (`user_companies` both directions).
- Test fresh install AND upgrade-from-last-release whenever migrations change.

## Git rules

- Previous releases are immutable. Never rewrite history; never modify a released commit or move a tag.
- Every release = one release commit + one annotated tag (see `DEVELOPMENT_PROTOCOL.md` RELEASED state).
- Never commit unrelated files; verify `git status --short` before staging.

## Stop conditions — the agent MUST stop and ask the human when:

- accounting semantics are ambiguous (the correct treatment is genuinely unclear)
- multiple architectural choices have materially different consequences
- a destructive migration is required
- production data ownership cannot be determined safely (e.g. migration backfill assumptions broken)
- a P0/P1 security issue is discovered outside the current task's scope
- requirements conflict
- a release gate fails
- expected accounting behavior cannot be established

Stopping is a valid, correct outcome. Do not guess through a stop condition.

## Self-review model

For important changes, run separate reasoning passes as distinct roles — do not let the implementer certify the work:

| Role | Responsibility |
|---|---|
| 1 — ENGINEER | implements the approved solution |
| 2 — SECURITY REVIEWER | attempts to break the implementation (IDOR, injection, escalation, isolation) |
| 3 — ACCOUNTING REVIEWER | derives expected accounting outcomes independently and compares |
| 4 — QA ENGINEER | runs regression + adversarial suites |
| 5 — BROWSER QA | tests real user workflows |
| 6 — RELEASE AUDITOR | reviews the complete change against release criteria |

## Independence rule

Where accounting correctness is verified, the independent expectation engine (`scripts/acceptance/engine.py`) must **never import or reuse** zprime accounting logic or queries. Expected values are derived independently, precisely so a shared mistake cannot hide.
