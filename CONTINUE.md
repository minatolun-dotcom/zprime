# CONTINUE.md — Session Handoff (read me first)

**Last updated:** 2026-09-16 — R-06 released as v1.6.0 (negative-stock availability guard + honest negative-stock valuation). Process state: IDLE.

---

## Current state

- **Current release:** v1.6.0
- **Current HEAD:** resolve with `git rev-parse v1.6.0^{}` (= tag `v1.6.0`; see RELEASES.md)
- **Current phase:** `IDLE` — no active R-item — see `DEVELOPMENT_PROTOCOL.md`
- **Current task:** none. R-06 (B-01, Model 1 reject-oversell) is complete and released.
- **Next permitted action:** next investigation only (B-02 opening balances / B-07 master-reference validation are the leading candidates from the action plan) — never implementation without its own investigation → review → approval cycle.
- **Blocked decisions (waiting on human):** none.

## Baseline verification (must re-confirm every session)

```bash
git rev-parse HEAD     # expect the v1.5.0 release commit (see RELEASES.md)
git describe --tags    # expect v1.5.0
git status --short     # expect clean
```

- Test baseline at v1.6.0: **763/763 automated checks** (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 481 incl. 21 R-06 checks, attack-the-fixes 29) + **186/186 browser** (baseline 153 + R-03 UI 12 + R-04 UI 9 + R-05 UI 12). Exact commands in `STATE.md` ("Verification record").
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

### 2026-09-16 — R-06 RELEASED as v1.6.0

- **Release review:** passed (diff audited hunk-by-hunk; scope contains exactly the approved Model-1 guard + honest valuation + migration 0004 + settings toggle; zero accounting-engine changes; no tests weakened).
- **Release commit:** "Release v1.6.0: negative-stock availability guard and honest negative-stock valuation" (15 files: R-06 code/tests, migration 0004 + snapshot + journal, docs, `R-06_INVESTIGATION.md`). **Tag:** annotated `v1.6.0` — "zprime v1.6.0 — negative-stock availability guard and honest negative-stock valuation". `v1.6.0^{}` == HEAD verified; tree clean; all prior tags immutable.
- **Release-gate results (final build):** Python 763/763 · browser 186/186 · typecheck clean · fresh Docker healthy · `git diff --check` clean.
- **Current state:** RELEASED → IDLE. No active R-item.
- **Next permitted action:** next investigation only (B-02 / B-07 candidates) — never implementation without its own approval cycle.

### 2026-09-16 — R-06 investigated, approved (Model 1), implemented, verified (RELEASE_REVIEW pending)

- **Investigation:** `R-06_INVESTIGATION.md` — B-01 live-reproduced on v1.5.0 (oversell accepted → phantom-unit WAVG; zero-COGS once negative; purchase averaged over qty −2 → value +1,000; P&L overstated by phantom margin; `stock.ts` clamp + WAVG→0 compounding). Human chose **Model 1 (reject oversell + `allowNegativeStock` opt-out)**.
- **Implementation:** chain-comparison availability guard in `vouchers.ts` (chronological replay by date then voucher id; grandfathered negatives tolerated as found; reject 400 only when a previously-valid step turns invalid; create/edit/cancel/uncancel/delete + both import paths covered — no side doors). Physical Stock rows treated as absolute counts (opening folded once; PS replaces running qty; diff at running avg). Migration `0004_r06_negative_stock_guard.sql` + hand-crafted snapshot/journal (project convention): `companies.allowNegativeStock` default false. `stock.ts`: clamp removed; WAVG capped at latest purchase rate under opt-in (honest valuation). `CompanySettings.tsx`: Allow-Negative-Stock toggle. Guard evolution (important): per-voucher check → silent-replay rule (grandfathered books false-blocked innocent purchases) → chain-comparison (edit/cancel of *inward* vouchers can strand downstream sales) → id-interleaved same-date merge (edited purchase chronologically precedes later sale; `excludeVoucherId` positional bug fixed by `opts`).
- **Fixture policy:** pre-R-06 fixture companies that legitimately oversell (browser baseline "Meridian Traders"/"Vasan & Co", Python main seeds) opt in explicitly via `D.allowNegativeStock(...)` — seeding helper, never a bypass; all guard assertions live in the dedicated R-06 checks (+21). Browser stack reset to a fresh volume mid-verification after duplicate companies from a failed run leaked through (old DB had no opt-in → "Switch 6A" oversell correctly rejected).
- **Tests:** Python 763/763 (smoke 39, adversarial 88, bug-fix 65, reconcile 61, final_regression **481** incl. 21 R-06 checks, attack-the-fixes 29). Browser 186/186 (153 + 12 + 9 + 12) on the rebuilt bundle — suites' own summary lines are authoritative (grep "  ok  " double-counts padded lines in r03/r04 logs). Typecheck clean. Fresh Docker volume healthy, 0 error patterns.
- **Files changed (implementation):** `server/src/db/schema.ts`, `server/drizzle/0004_r06_negative_stock_guard.sql` + meta snapshot + journal, `server/src/routes/vouchers.ts`, `server/src/routes/import.ts`, `server/src/routes/companies.ts`, `server/src/services/stock.ts`, `client/src/pages/CompanySettings.tsx`, `scripts/final_regression.py`, `scripts/acceptance/driver.js`, `scripts/acceptance/run.js` (+ docs: CHANGELOG, STATE, CONTINUE; `R-06_INVESTIGATION.md` new). Disposable override yaml to delete at release: `docker-compose.override.r06.yaml`.
- **Next permitted action:** release review of the full diff → on pass + explicit instruction, commit + tag v1.6.0 (proposed message above).

### 2026-09-15 — R-05 investigated, approved, implemented, verified (RELEASE_REVIEW pending)

- **Investigation:** `R-05_INVESTIGATION.md` — B-06 live-reproduced (CN adds to GSTR-1 output, DN adds to ITC; 3B net 1440 vs book truth 1080; `cdnr: []` hardcoded). Human approved as investigated.
- **Implementation:** `gst.ts` direction-aware aggregation (notes negative), real CDNR/CDNUR + `net*` totals in `gstr1()`, `isNote` marker, signed rate buckets, sign-agnostic `deriveRate`; `Reports.tsx` Net-supplies card + CDNR/CDNUR tables. Dead `sign` variable now does its intended job. A-07 and R-01 rules untouched.
- **Scope extension (human-approved mid-review):** Apply-GST party balance. Live probe found the helper was doubly broken: base-selection sign-inverted (duty never inserted for Sales/Purchase; wrong side for CN/DN) and party row never re-balanced (Ctrl+A after Apply GST always rejected). Fixed in `VoucherScreen.tsx` (per-type base sign map + party rebalance). Covered by a real-save check in `r05_ui.js` (12 checks now).
- **Test-engine alignment (important):** acceptance `engine.py`'s `gstr3b_app`/`gstr1_app` mirrors encoded the OLD no-netting semantics; re-aligned to correct model; `run.js` r02/gstr1-excluded direction corrected (magnitude unchanged). reconcile.py gained an independent CN/DN scenario incl. cross-period (negative month net) and the cumulative ledger identity.
- **Tests:** Python 742/742 (final_regression 460 incl. 43 new R-05 checks; reconcile 61 incl. 13 new); browser 186/186 (baseline 153 + R-03 12 + R-04 9 + `r05_ui.js` 12 — sale + CN through the real UI, CDNR + net 8,000 + Apply-GST real save asserted). Typecheck clean; fresh Docker healthy, 0 log errors.
- **Files changed:** `server/src/services/gst.ts`, `client/src/pages/Reports.tsx`, `client/src/pages/VoucherScreen.tsx`, `scripts/final_regression.py`, `scripts/reconcile.py`, `scripts/acceptance/engine.py`, `scripts/acceptance/run.js`, `scripts/acceptance/r05_ui.js` (new), `CHANGELOG.md`, `STATE.md`, `CONTINUE.md`; `R-05_INVESTIGATION.md` (untracked, to be staged at release). Disposable `docker-compose.override.r05.yaml` (untracked, delete at release).
- **Next permitted action:** on human instruction: commit + tag v1.5.0 (proposed message: "Release v1.5.0: credit/debit-note GST reporting and Apply-GST party balance").

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
