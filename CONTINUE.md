# CONTINUE.md — Session Handoff (read me first)

**Last updated:** 2026-09-15 — R-04 released as v1.4.0 (import integrity). Process state: IDLE.

---

## Current state

- **Current release:** v1.4.0
- **Current HEAD:** resolve with `git rev-parse v1.4.0^{}` (= tag `v1.4.0`; see RELEASES.md)
- **Current phase:** `IDLE` — no active task — see `DEVELOPMENT_PROTOCOL.md`
- **Current task:** none. R-04 (XML import integrity: B-03 + B-05 + B-13 + B-14) is released.
- **Next permitted action:** on "Continue zprime": verify baseline, then propose the next R-item investigation (candidates: B-06 CN/DN GST sign, B-01 negative stock, B-02 opening balances — each needs its own investigation → review → approval cycle).
- **Blocked decisions (waiting on human):** none.

## Baseline verification (must re-confirm every session)

```bash
git rev-parse HEAD     # expect the v1.4.0 release commit (see RELEASES.md)
git describe --tags    # expect v1.4.0
git status --short     # expect clean
```

- Test baseline at v1.4.0: **686/686 automated checks** (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 48, final regression 417, attack-the-fixes 29) + **174/174 browser** (baseline 153 + R-03 UI 12 + R-04 UI 9). Exact commands in `STATE.md` ("Verification record").
- Test rig: disposable Postgres `zprime-test-pg` on port 55432; suites self-host servers on ports 3100–3106; do not run two suites concurrently; kill stray `tsx server/src/index.ts` processes before running suites (zombies squat ports and cause 500s).

## Known intentional untracked files (do not delete; do not stage casually)

- `ZLEDGER_PRODUCTION_ACTION_PLAN.md` — historical/current roadmap input from the production-readiness audit. Filename preserved intentionally (historical continuity). Do not rename, modify, stage, or commit without explicit instruction.

(R-04 shipped: the investigation report and workflow docs are tracked as of v1.4.0. `docker-compose.override.r04.yaml` was a disposable verification artifact and was removed at release.)

## How to continue (any future session)

1. Read `AGENTS.md` — binding rules.
2. Read `PROJECT.md` — what zprime is.
3. Read `STATE.md` — exact current state and verification commands.
4. Read `ROADMAP.md` — where zprime is going.
5. Read `DEVELOPMENT_PROTOCOL.md` — which state is active and what it permits.
6. Read `CONTINUE.md` (this file) — current phase, task, permitted actions.
7. Read the current investigation/report referenced under "Current task".
8. Check git (`rev-parse` / `describe` / `status`) against this file.
9. Determine current state (`DEVELOPMENT_PROTOCOL.md`).
10. Continue only according to the protocol. Do not ask the human to repeat information already recorded here.

---

## Session log (append at the end of every substantial session)

### 2026-09-15 — R-04 RELEASED as v1.4.0

- **What was completed:** release review passed on the final build (syncCounters transaction-read fix included); workflow docs finalized (RELEASES.md v1.4.0 entry, ROADMAP phase → IDLE, this file's state block + log); release commit created staging the R-04 code/tests, workflow docs, and `R-04_INVESTIGATION.md`; annotated tag `v1.4.0` created; tag^{ } == HEAD verified, tree clean, all prior tags immutable. `docker-compose.override.r04.yaml` deleted (disposable verification artifact).
- **Final results:** 686/686 Python + 174/174 browser + typecheck clean + fresh Docker healthy (0 log errors).
- **Current state:** RELEASED → IDLE. No active R-item.
- **Next permitted action:** next investigation only (B-06 / B-01 / B-02 candidates) — never implementation without its own approval cycle.

### 2026-09-15 — R-04 implemented and verified (awaiting release review)

- **What was completed:** re-verified all 12 action-plan findings against v1.3.0 source and live build; two live reproductions (B-03 import unbalanced → TB 400/600; B-06 CN increases GSTR-1 output tax → 99/99 vs 81/81); new adjacent finding B-13 (imported ledgers `taxability: "none"`); R-03 security re-scan GREEN; payroll/migrations/concurrency verified correct. Report: `R-04_INVESTIGATION.md` (verdict: **R-04 CONFIRMED — INVESTIGATION REQUIRED**, P0).
- **Files changed:** only `R-04_INVESTIGATION.md` created. No source/test/migration/doc changes.
- **Tests run:** none modified; baseline 821/821 confirmed intact at v1.3.0 release.
- **Current state:** INVESTIGATION complete → HUMAN_REVIEW pending.
- **Next permitted action:** human review/approval of R-04 scope.
- **Blocked decisions:** none besides R-04 approval.

### 2026-09-15 — R-04 implemented and verified (awaiting release review)

- **What was completed:** R-04 approved as investigated (B-03+B-05+B-13); implemented in `server/src/routes/import.ts` (single-transaction import, shared `validateEntries` double-entry gate exported from `vouchers.ts`, bill-allocation validation, per-voucher error attribution, B-13 taxability classification). Browser verification exposed **B-14** (import "Upload file" mode never worked — api.ts forced JSON Content-Type onto FormData); human approved adding it to R-04; fixed in `client/src/lib/api.ts` (one guard). Tests: +16 R-04 API checks + 2 B-14 multipart checks in `final_regression.py` (399→417); new `scripts/acceptance/r04_ui.js` (9 checks).
- **Files changed:** `server/src/routes/import.ts`, `server/src/routes/vouchers.ts`, `client/src/lib/api.ts`, `scripts/final_regression.py`, `scripts/acceptance/r04_ui.js` (new), `CHANGELOG.md`, `STATE.md`, `CONTINUE.md`. Also untracked disposable `docker-compose.override.r04.yaml` (host-port override; host 3000 was occupied by an unrelated ghost process — login path is `/api/auth/login`, the "ghost" turned out to be zprime itself through docker-proxy).
- **Tests run:** Python 686/686 (39+88+65+48+**417**+29); browser 174/174 (153+12+**9**); typecheck server+client clean; Docker fresh volume healthy (port 3100), 0 log errors.
- **Current state:** VERIFICATION + BROWSER_VERIFICATION complete → RELEASE_REVIEW pending (no commit, no tag).
- **Next permitted action:** release review of the full diff; on pass, commit + tag v1.4.0 only on explicit human instruction.
- **Blocked decisions:** none.

### 2026-09-15 — Engineering operating system bootstrapped (this session)

- **What was completed:** created `AGENTS.md`, `PROJECT.md`, `ROADMAP.md`, `DEVELOPMENT_PROTOCOL.md`, `RELEASES.md`, `CONTINUE.md` (this file); minimally updated `STATE.md` release-status header to reflect the v1.3.0 release (historical content preserved). No application source, tests, migrations, schema, or frontend files touched.
- **Files changed:** 6 new workflow files + 1 minimal `STATE.md` accuracy update.
- **Current state:** IDLE as a process; R-04 sits at HUMAN_REVIEW (investigation complete, approval pending).
- **Next permitted action:** "Continue zprime" → verify baseline → present R-04 for review; implement only on explicit approval.
- **Important results:** baseline re-verified — HEAD `38637c14…`, tag `v1.3.0`, all five release tags immutable.
