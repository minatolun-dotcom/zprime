# DEVELOPMENT_PROTOCOL.md — The zprime Engineering State Machine

The operational core of the zprime development system. Every session operates in exactly one state. The current state is recorded in `CONTINUE.md`; transitions follow the rules below. No state may be skipped silently.

```
IDLE → INVESTIGATION → HUMAN_REVIEW → IMPLEMENTATION → VERIFICATION
     → BROWSER_VERIFICATION → RELEASE_REVIEW → RELEASED → IDLE
```

Any state may transition back to `INVESTIGATION` or `HUMAN_REVIEW` when new evidence requires it. Every transition updates `CONTINUE.md`.

---

## IDLE

**Meaning:** no active task; the baseline is clean.

- **Agent may:** read all documentation and code; answer questions; run read-only checks (`git status`, suites against the disposable test rig to re-confirm baseline).
- **Agent may not:** change anything.
- **Exit:** a task is proposed (by human, or by the agent surfacing a candidate from `ROADMAP.md`) → **INVESTIGATION**.

## INVESTIGATION

**Meaning:** establishing the truth of a candidate finding or requirement.

- **Agent may:** read source, inspect the database, run the application, call APIs, drive the browser, create disposable test data, reproduce issues, analyze logs, and write the investigation report (`R-XX_INVESTIGATION.md`) plus `CONTINUE.md` updates. Creating the investigation report file is explicitly permitted in this state.
- **Agent may NOT:** modify production code, tests, migrations, schema, or frontend; weaken tests; commit; tag.
- **Must record:** evidence, reproduction, severity, and — for each suspected issue — either the confirmed defect or **`NOT A BUG — VERIFIED`** with proof.
- **Exit:** **INVESTIGATION COMPLETE** → `HUMAN_REVIEW`; or **NOT A BUG — VERIFIED** → record and return to `IDLE`.

## HUMAN_REVIEW

**Meaning:** the human decides.

- **Agent presents:** findings, evidence, root cause, severity, proposed solution, risks, acceptance criteria, blast radius, and the proposed verification plan.
- **Agent may not:** implement anything, however obvious the fix appears.
- **Exit:** human approves (with scope) → **IMPLEMENTATION**; human rejects → `IDLE`; questions raised → back to `INVESTIGATION`.

## IMPLEMENTATION

**Meaning:** building only the approved scope.

- **Agent may:** modify only the approved files; write/extend tests for the new behavior; update `STATE.md`/`CHANGELOG.md`/relevant docs for the change.
- **Agent must preserve:** all existing tests and their expected values; all accounting semantics; all security boundaries.
- **Agent must not:** refactor unrelated code, "improve" adjacent behavior, or release.
- **Exit:** implementation complete with typecheck clean → **VERIFICATION**.

## VERIFICATION

**Meaning:** proving the change correct at the API/engine level.

- **Agent runs:** application/regression suites (exact commands in `STATE.md`), adversarial/security tests when input handling or security is touched, the independent accounting engine where accounting is touched, migration verification (fresh + upgrade) when migrations were added, concurrency probes where races are plausible.
- **Required:** every existing suite at its baseline count, 0 failures. A failing existing test means investigate the implementation first — never edit the expectation.
- **Agent may not:** weaken/skip/delete tests; change expected accounting values to force green; release.
- **Exit:** all suites green → **BROWSER_VERIFICATION**.

## BROWSER_VERIFICATION

**Meaning:** proving real user workflows against the running application (Docker stack or dev rig, real browser).

- **Agent verifies:** authentication; company isolation; voucher workflows (create/edit/cancel/uncancel as relevant); reports against independent expectations; the specific feature workflow; error handling (invalid input, stale URLs, unauthorized access rendering neutrally).
- **Agent may not:** accept API-only evidence for user-facing behavior.
- **Exit:** browser checks green → **RELEASE_REVIEW**.

## RELEASE_REVIEW

**Meaning:** the release gate — a full audit before anything is committed.

- **Agent must verify, in order:**
  1. all tests pass at baseline counts + new coverage
  2. no tests weakened, skipped, or deleted
  3. no unexpected files (`git status --short` reviewed against the approved file list)
  4. full `git diff` reviewed hunk by hunk
  5. typecheck clean (server + client)
  6. Docker fresh install verified
  7. Docker upgrade verified (if migrations changed)
  8. browser acceptance green
  9. independent accounting reconciliation green
  10. documentation consistent (no over-claiming)
  11. security review (self-review roles 2 & 3 in `AGENTS.md`)
  12. migration safety reviewed
- **Agent may not:** commit or tag until every gate passes; if any gate fails → back to `IMPLEMENTATION` or `INVESTIGATION`.
- **Exit:** every gate green → human confirms release → **RELEASED**. (The human may have pre-authorized release in the task instruction; the audit must still run.)

## RELEASED

**Meaning:** creating the release and closing the cycle.

- **Agent executes:** create ONE release commit (only the approved files); create the annotated tag (`vX.Y.Z`); verify `vX.Y.Z^{}` == HEAD; verify `git status` clean; verify all previous tags unchanged; **push the release to the remote: `git push origin main` then `git push origin --tags`** (standing release step, adopted R-26 era per human instruction); update `STATE.md` and `RELEASES.md`; update `CONTINUE.md` → phase IDLE/next investigation.
- **Push rule:** a release is not fully published until the remote carries the release commit AND its tag. If credentials are unavailable in the session, report the push as **BLOCKED — push pending** (never skip it silently); the push is retried at the next opportunity, including by the human from their own terminal (`git push origin main --tags`).
- **Agent may not:** modify previous releases; force-push; begin the next item.
- **Exit:** state recorded → **IDLE** (or RELEASED with push pending when blocked).

---

## Standing rules across all states

- Baseline integrity first: every session starts by verifying `git rev-parse HEAD` / `git describe --tags` against `CONTINUE.md` and stops on mismatch.
- One state per session; never blur INVESTIGATION with IMPLEMENTATION.
- Tests are immutable safety barriers (`AGENTS.md`).
- Releases are immutable once tagged.
- `CONTINUE.md` is updated at the end of every substantial session.
