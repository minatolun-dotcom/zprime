# CONTINUE.md — Session Handoff (read me first)

**Last updated:** 2026-09-17 — R-12 RELEASED as v1.12.0 (backup/restore runbook + round-trip guard, docs/test-only). Process state: IDLE.

---

## Current state

- **Current release:** v1.11.0
- **Current HEAD:** the v1.11.0 release commit (see RELEASES.md / `git rev-parse HEAD`)
- **Current phase:** `IDLE` — v1.12.0 released; next R-item requires its own investigation → review → approval cycle — see `DEVELOPMENT_PROTOCOL.md`
- **Current task:** none. Last: R-12 (B-12 backup/restore). Investigation: `R-12_INVESTIGATION.md`.
- **What changed (approved docs/test-only scope):** README "Data & backups" rewritten as a verified runbook (backup command; restore with the previously undocumented stop-app → drop/recreate-DB prerequisite; verify-after-restore row counts; whole-volume snapshot alternative); `final_regression.py` +6 R-12 checks (pg_dump → scratch-DB restore with ON_ERROR_STOP → row counts match source → scratch dropped) guarding the runbook against schema drift → final_regression 558.
- **Verification:** Python **840/840** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **558** incl. 6 R-12, attack-the-fixes 29); zero client changes → browser 208/208 unchanged; no source, migration, or client file modified.
- **Next permitted action:** on "continue zprime" → begin the R-13 investigation (highest remaining candidate: VoucherScreen negative-stock warning / import pre-validation feedback — the non-bug hardening items from the action plan).
- **Environment note (permanent):** the verification stack requires `.env` at repo root (never committed; `.env.example` is the template) — create it before `docker compose up`.
- **Blocked decisions (waiting on human):** none.
- **What changed (approved full scope):** additive migration `0005_r10_idempotency_keys.sql` (`idempotency_keys`, UNIQUE(company_id, key)); `vouchers.ts` POST accepts optional `idempotencyKey` (body or `X-Idempotency-Key` header) — replay returns the ORIGINAL voucher, key+voucher recorded in one transaction, concurrent same-key race resolves to one voucher; `VoucherScreen.tsx` generates a UUID per new-voucher form and sends it, plus a `savingRef` guard making Ctrl+A single-shot; `final_regression.py` +12 R-10 checks; `r10_ui.js` new 10-check browser suite.
- **Verification on the final tree:** Python **813/813** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **531** incl. 12 R-10, attack-the-fixes 29); browser **208/208** (153 + 12 + 9 + 12 + 12 + 10 R-10) on a rebuilt client with a fresh-volume stack; typecheck server+client clean; migration verified on both fresh install (6/6 applied) and the test rig (0005 forward-applied from 5).
- **Next permitted action:** on instruction, begin the R-11 investigation (leading candidates: B-12 backup/restore UX, B-11 purchase-return/DN test coverage, VoucherScreen negative-stock warning). No implementation without investigation → review → approval.
- **Environment note (permanent):** the verification stack requires `.env` at repo root (never committed; `.env.example` is the template) — create it before `docker compose up`.
- **Blocked decisions (waiting on human):** none.

## Baseline verification (must re-confirm every session)

```bash
git rev-parse HEAD     # expect the v1.11.0 release commit (see RELEASES.md)
git describe --tags    # expect v1.11.0
git status --short     # expect clean tree except the intentional untracked ZLEDGER_PRODUCTION_ACTION_PLAN.md
```

- Test baseline at v1.12.0: **840/840 automated checks** (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 558 incl. R-06/R-07/R-08/R-09/R-10/R-11/R-12 checks, attack-the-fixes 29) + **208/208 browser** (baseline 153 + R-03 UI 12 + R-04 UI 9 + R-05 UI 12 + R-07 UI 12 + R-10 UI 10). Exact commands in `STATE.md` ("Verification record"). Note: totals through v1.11.0 were previously advertised as 813/831; the measured component sums are the authority (813 for v1.10.0 stands, v1.11.0 is 834).
- Test rig: disposable Postgres `zprime-test-pg` on port 55432; suites self-host servers on ports 3100–3106; do not run two suites concurrently; kill stray `tsx server/src/index.ts` processes before running suites (zombies squat ports and cause 500s). If docker-compose suites fail with "cannot connect", check the container exited (host reboot/Docker daemon restart leaves it Exited) and `docker start zprime-test-pg` first.
- Harness lessons (R-10): never `pkill -f <pattern>` where the pattern matches your own shell's command line — use a `[x]`-bracketed pattern or `start_new_session=True` + `os.killpg`; suite output can be block-buffered — rerun with `python3 -u` before diagnosing a "hang".

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

### 2026-09-16 — R-10 implemented and verified (RELEASE_REVIEW pending)

- **What was completed:** full approved scope — additive migration `server/drizzle/0005_r10_idempotency_keys.sql` + snapshot + journal (hand-authored per repo convention; forward-applied on the test rig from 5→6, fresh install 6/6); `vouchers.ts` POST idempotency (optional body/header key, pre-insert lookup, same-transaction record, 23505-race loser returns winner's voucher); `VoucherScreen.tsx` per-form UUID + `savingRef` Ctrl+A guard; `final_regression.py` +12 R-10 checks; new `scripts/acceptance/r10_ui.js` (10 checks). Probe data from the investigation was fully cleaned (verified 0 leftover companies).
- **Tests run:** Python **813/813** (smoke 39, adversarial 88, bug-fix 65, reconcile 61, final regression **531** incl. 12 R-10, attack-the-fixes 29); browser **208/208** on rebuilt client + fresh-volume stack (153 + 12 + 9 + 12 + 12 + 10); typecheck server+client clean; `git diff --check` clean.
- **Harness lessons:** suites fail confusingly when `zprime-test-pg` is Exited after a host/Docker-daemon restart — start it first; `pkill -f` patterns must be self-immune (`[x]` brackets); prefer `python3 -u` when diagnosing apparent suite hangs.
- **Current state:** VERIFICATION + BROWSER_VERIFICATION complete → RELEASE_REVIEW (no commit, no tag).
- **Next permitted action:** release review of the full diff; on your instruction, ledger docs (RELEASES/ROADMAP/STATE/CONTINUE) → release gate → commit `Release v1.10.0: duplicate-submission idempotency` + annotated tag `v1.10.0` → verify tag/HEAD/clean tree.
- **Blocked decisions:** release go/no-go.

### 2026-09-16 — R-10 investigation COMPLETE (HUMAN_REVIEW pending)

- **Candidate:** B-10 (duplicate submissions double-post, P2). Verified baseline first: HEAD `f2403b1` = v1.9.0, clean tree.
- **Code findings:** `POST /vouchers` has no idempotency mechanism (0 matches for idempoten/requestId/dedupe in server/src); client `saving` guard covers only the Accept button — `Ctrl+A` hotkey calls `save()` unguarded (and deps exclude `saving`, so a closure guard would be stale).
- **Live reproductions (disposable companies, fully cleaned, verified 0 leftovers):** sequential exact duplicate → 2 vouchers (INV2 confirmed); 3 concurrent identical POSTs → 3 vouchers; client-accurate bill-wise duplicate (re-accept recomputes bill name) → 2nd sale posted, **Receivables 3,000 → 6,000** (two open bills). Exact resend of bill-wise sale → 409 via A-02 bill-name uniqueness (accidental, partial shield only).
- **NOT A BUG (verified):** manual-number concurrent race (1×200 + 2×409 via unique index); transaction atomicity (no partial state); payroll duplicate-month guard; XML re-import (deliberate user action).
- **Proposed scope (R-10_INVESTIGATION.md §9, awaiting approval):** additive `idempotency_keys` migration + optional client-generated key on POST /vouchers (replay returns original voucher) + `savingRef` hotkey guard + regression/browser tests.
- **Working tree:** + `R-10_INVESTIGATION.md` (new), CONTINUE.md (this file). No source/test/migration changes. Probe scripts in /tmp only.

### 2026-09-16 — R-09 RELEASED as v1.9.0 (BREAKING)

- **Release review:** passed (diff audited hunk-by-hunk; scope contains exactly the approved fail-fast scope; no accounting surface, no client change, no migration; no tests weakened — suites migrated to explicit fixtures, assertions unchanged).
- **Release commit:** "Release v1.9.0: fail-fast deployment secrets". **Tag:** annotated `v1.9.0` — "zprime v1.9.0 — deployment secrets enforced". `v1.9.0^{}` == HEAD verified; tree clean; all prior tags immutable.
- **Release-gate results (final build):** Python 801/801 · browser 198/198 · typecheck clean · fresh Docker with `.env` healthy · compose-without-`.env` refused · `git diff --check` clean.
- **Current state:** RELEASED → IDLE. No active R-item.
- **Next permitted action:** next investigation only (B-10/B-12 candidates) — never implementation without its own approval cycle.

### 2026-09-16 — R-09 implemented and verified (RELEASE_REVIEW pending)

- **Approved scope:** full fail-fast, always enforced (human approved via structured question).
- **Implementation:** `auth.ts` — boot refused on missing/empty/known-insecure `JWT_SECRET` (`dev-secret`, `change-me-in-production`) with `.env.example` guidance; `index.ts` — first-boot seeding requires `ADMIN_PASSWORD` (existing users unaffected); `docker-compose.yml` — `:?` required interpolation for JWT_SECRET/ADMIN_PASSWORD; README — `.env` required + breaking-change callout + POSTGRES_PASSWORD residual-risk note; all seven suite spawn sites (smoke/attack_test/fix_regression/attack2/reconcile/repro_findings/final_regression) now set explicit `JWT_SECRET`/`ADMIN_PASSWORD` fixtures.
- **Test-harness lesson:** the R-09 spawn probes initially hung the suite — `npx tsx` cold compile can exceed a 25s window and `p.kill()` leaves the node child alive. Fixed: 60s window + `start_new_session=True` + `os.killpg` cleanup; probes run last (final_regression 514 → **519**).
- **Tests:** Python **801/801** (39+88+65+61+519+29); browser **198/198** (153+12+9+12+12) on the rebuilt fail-fast stack (fresh volume, `.env` present); compose-without-`.env` verified refused (exit 1 with guidance); typecheck server+client clean.
- **Guardrails honored:** no accounting surface, no client change, no migration; verification stack `.env` created locally (never committed; `.gitignore` covers it).
- **Files changed:** `server/src/plugins/auth.ts`, `server/src/index.ts`, `docker-compose.yml`, `README.md`, `scripts/{smoke_test,attack_test,fix_regression,attack2,reconcile,repro_findings,final_regression}.py`, `CHANGELOG.md`, `STATE.md`, `CONTINUE.md` (this entry). `R-09_INVESTIGATION.md` untracked → stage at release.
- **Next permitted action:** release review of the full diff → on pass + explicit instruction, commit + tag v1.9.0.

### 2026-09-16 — R-09 investigated (B-08 deployment secrets) — HUMAN_REVIEW pending

- **Investigation:** `R-09_INVESTIGATION.md` — source-traced (no exploit needed): three fallback layers (docker-compose.yml:20-22 `change-me-in-production`/`admin123`; auth.ts:27 `?? "dev-secret"` — server never refuses boot; index.ts:103 seeding fallback). JWT forge = full auth bypass on exposed deployments (payload {uid,username}, stateless). Blast radius mapped: all six Python suites + browser stack depend on fallbacks (suites set only DATABASE_URL/PORT); README marks .env optional. scrypt verify correct (NOT A BUG — VERIFIED). POSTGRES_PASSWORD default documented as P4 residual (db not network-exposed).
- **Files changed:** only `R-09_INVESTIGATION.md` created; `CONTINUE.md` (this entry). No source/test/migration/doc changes.
- **Current state:** INVESTIGATION complete → HUMAN_REVIEW pending.
- **Next permitted action:** human approval of R-09 scope (report §5).

### 2026-09-16 — R-08 RELEASED as v1.8.0

- **Release review:** passed (diff audited hunk-by-hunk; scope contains exactly the approved route-level fix; zero client/migration/schema changes; no accounting-mathematics change; no tests weakened).
- **Release commit:** "Release v1.8.0: cross-company master-reference validation". **Tag:** annotated `v1.8.0` — "zprime v1.8.0 — master-reference company scoping". `v1.8.0^{}` == HEAD verified; tree clean; all prior tags immutable.
- **Release-gate results (final build):** Python 796/796 · browser 198/198 · typecheck clean · fresh Docker healthy · `git diff --check` clean.
- **Current state:** RELEASED → IDLE. No active R-item.
- **Next permitted action:** next investigation only (B-08/B-10 candidates) — never implementation without its own approval cycle.

### 2026-09-16 — R-08 implemented and verified (RELEASE_REVIEW pending)

- **Approved scope:** route-level fix, no migration (human approved via structured question; composite-FK migration deferred).
- **Implementation:** `crud.ts` — new `assertCompanyRefs(c, opts.refs, data)` called on POST and PUT after beforeSave; `RefSpec = Record<field, {table, label}>`; null/unset refs skipped, non-numeric junk left to the schema; error "<Label> does not exist in this company" (400). Wired in `masters.ts` (ledgers.groupId; stock-items unitId/groupId/categoryId) and `payroll.ts` (pay-heads.ledgerId). `salary-structure` PUT: headId in-company loop. `payroll/process`: belt-and-braces `inArray` assert over all pay-head ledgerIds before entries are built — legacy foreign row → named-head 400. Client: zero changes.
- **Tests:** final_regression +17 R-08 checks → **514** (foreign refs → 400 incl. PUT path and stock-group; in-company still 200; salary-structure unknown/legacy head semantics — legacy head accepted (head is in-company) but posting fails; psql-inserted legacy foreign-ledger row → payroll 400 "outside this company"; TB balanced after rejection). Python **796/796**; browser **198/198** on rebuilt bundle + fresh volume (no new UI suite — no client change). Typecheck server+client clean.
- **Guardrails honored:** no migration, no schema change, no client change, no accounting-mathematics change; voucher-path trio untouched; R-03/R-06/R-07 behavior unchanged (all suites green).
- **Files changed:** `server/src/routes/crud.ts`, `server/src/routes/masters.ts`, `server/src/routes/payroll.ts`, `scripts/final_regression.py`, `CHANGELOG.md`, `STATE.md`, `CONTINUE.md` (this entry). `R-08_INVESTIGATION.md` untracked → stage at release.
- **Next permitted action:** release review of the full diff → on pass + explicit instruction, commit + tag v1.8.0.

### 2026-09-16 — R-08 investigated (B-07 cross-company master references) — HUMAN_REVIEW pending

- **Investigation:** `R-08_INVESTIGATION.md` — live probe on v1.7.0 (:3000 disposable stack, companies "R08 Co A/B"). B-07 confirmed **P1 with a proven corruption chain**: cross-company refs accepted on ledgers.groupId, stock-items.unitId, pay-heads.ledgerId, salary-structure.headId (all 200); payroll then posted a Payroll voucher in A with a Dr against B's ledger → the debit is invisible to BOTH companies' reports (ledgerBalances is company-join-scoped) → **A's TB Dr=0/Cr=10,000 unbalanced, silently**; BS difference 10,000. F-08-2 (P2): foreign-group ledger renders in TB with the foreign group's name but is dropped from BS/Group-Summary tree folds — report paths disagree. F-08-3 (P3): NO ACTION FK couples B's group deletion to A's ledger. F-08-4: voucher-path validation trio + groups beforeSave + crud row-scoping verified correct (NOT A BUG — VERIFIED). Root cause: crud.ts validates row ownership but never body FK refs; schema FKs global. Zero test coverage (XGRP probe never graduated).
- **Files changed:** only `R-08_INVESTIGATION.md` created; `CONTINUE.md` (this entry). No source/test/migration/doc changes. Probe scripts in /tmp only.
- **Current state:** INVESTIGATION complete → HUMAN_REVIEW pending.
- **Next permitted action:** human approval of R-08 scope (report §7) + decision on the optional composite-FK migration.

### 2026-09-16 — R-07 RELEASED as v1.7.0

- **Release review:** passed (diff audited hunk-by-hunk; scope contains exactly the approved F-07-1 + F-07-3 + Model-A docs; zero accounting-engine mathematics changes; no tests weakened; no fixture regressions — verified no existing party carries a master opening before running).
- **Release commit:** "Release v1.7.0: opening balances in Outstanding reports and Balance Sheet stock scope". **Tag:** annotated `v1.7.0` — "zprime v1.7.0 — opening balances in reports". `v1.7.0^{}` == HEAD verified; tree clean; all prior tags immutable.
- **Release-gate results (final build):** Python 779/779 · browser 198/198 · typecheck clean · fresh Docker healthy · `git diff --check` clean.
- **Current state:** RELEASED → IDLE. No active R-item.
- **Next permitted action:** next investigation only (B-07 candidate) — never implementation without its own approval cycle.

### 2026-09-16 — R-07 implemented and verified (RELEASE_REVIEW pending)

- **Approved scope:** F-07-1 (P1) + F-07-3 (P2); F-07-2 = Model A (document-only). Human approved via structured questions.
- **Implementation (`server/src/services/accounting.ts` only — no API surface, schema, migration, or client changes):** (1) `billWiseOutstanding()` merges party master openings as a synthetic "Opening Balance" bill (billType `opening`, dated books-begin, allocation sign convention Dr +/Cr −), inserted after `result` construction and before the A-05 on-account merge; display-only by construction (`validateBillsTx` only sees real allocations → Against Ref = 400; verified in tests). (2) `balanceSheet()` zeroing switched from name-equality to structural: new `descendantGroupIds()` helper resolves SIH + descendants. Client needed **zero** changes (OutstandingView renders bills generically). Independent engine `bills()` mirror aligned (opening-bill rule). PROJECT.md: Model-A documentation (opening-balance architecture + manual opening-journal workflow).
- **Tests:** final_regression +16 R-07 checks (AR/AP openings incl. Cr-signed creditor, synthetic-bill shape, AR total, no-settlement 400, on-account netting 50k→40k, sub-group no-double-count, books-balance difference-0) → **497**; Python **779/779**; browser **198/198** (153+12+9+12+**12** new `r07_ui.js`: AR opening row visible/expandable in the real UI, AP −20,000, BS banner absent before/after unfunded sub-group ledger, zero page errors). Typecheck server+client clean. Fresh Docker volume healthy. fix_regression startup race → clean rerun green (known transient).
- **Guardrails honored:** no existing fixture carries party master openings (verified — zero baseline regressions); no migration; R-06 guard untouched (availability replay starts from item openings; report-side only).
- **Files changed:** `server/src/services/accounting.ts`, `scripts/final_regression.py`, `scripts/acceptance/engine.py`, `scripts/acceptance/r07_ui.js` (new), `PROJECT.md`, `CHANGELOG.md`, `STATE.md`, `CONTINUE.md` (this entry). `R-07_INVESTIGATION.md` untracked → stage at release.
- **Next permitted action:** release review of the full diff → on pass + explicit instruction, commit + tag v1.7.0.

### 2026-09-16 — R-07 investigated (B-02 opening balances) — HUMAN_REVIEW pending

- **Investigation:** `R-07_INVESTIGATION.md` — live probe on v1.6.0 (:3000 disposable stack, company "R07 Probe"). B-02 re-graded: not one P0 but three findings + one verified non-bug. F-07-1 **P1**: `billWiseOutstanding()` never reads `ledgers.opening_balance` → migrated party balances invisible in Receivables/Payables (probe: debtor opening 50,000 Dr visible in TB, AR total 0). F-07-3 **P2**: BS zeroes Stock-in-Hand ledgers by exact group *name*, so SIH sub-group ledgers (Finished Goods etc.) double-count stock in assets (probe: +1000 assets on 1000 stock, silent). F-07-2 **P2** (re-graded from P0): unfunded item openings → BS `difference = −openingStock` with honest banner (importer creates this state for every migrated book). F-07-4: openings do NOT contaminate P&L movement — NOT A BUG — VERIFIED.
- **Files changed:** only `R-07_INVESTIGATION.md` created; `CONTINUE.md` (this entry). No source/test/migration/doc changes. Probe scripts in /tmp only.
- **Current state:** INVESTIGATION complete → HUMAN_REVIEW pending.
- **Next permitted action:** human approval of R-07 scope (F-07-1 + F-07-3 bundle per report §8 Option B) and F-07-2 model choice.

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
