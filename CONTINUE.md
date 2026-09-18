# CONTINUE.md — Session Handoff (read me first)

**Last updated:** 2026-09-18 — **v1.23.0 RELEASED** (R-24 e-invoice payload generation). Phase IDLE; next session asks for R-25 direction.

---

## Current state

- **Current release:** v1.23.0 (resolve with `git rev-parse v1.23.0^{}`; see RELEASES.md)
- **Current HEAD:** the v1.23.0 release commit (see RELEASES.md / `git rev-parse HEAD`)
- **Current phase:** `IDLE` — v1.23.0 released; the next R-item requires its own investigation → review → approval cycle — see `DEVELOPMENT_PROTOCOL.md`
- **Current task:** none. Last: R-24 (e-invoice payload generation — migration 0010 `ledgers.party_pincode`, `services/einvoice.ts` NIC v1.01 builder with strict all-at-once validation + UQC mapping, cid-gated `GET /reports/einvoice/:voucherId`, GSTR-1 e-inv download actions + validation banner; generate+download only, IRP connectivity deliberately deferred). Investigation: `R-24_INVESTIGATION.md`.
- **Verification (final tree):** Python **991/991** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **709** incl. 27 R-24, attack-the-fixes 29); browser **285/285** (run.js + r03/r04/r05/r07/r10/r14/r18/r20/r21/r23/r24); typecheck server + client clean; fresh volume applies 11/11 migrations.
- **Next permitted action:** on "continue zprime" → ask the human for R-25 direction (genuinely open: e-way bill, GSTR-9, TCS, or live IRP/GSP connectivity as a separate product decision; or hold steady).
- **What changed (implemented scope):** migration `0010_r24_party_pincode.sql` (additive `ledgers.party_pincode`, no backfill; snapshot idx 10) + `schema.ts partyPincode` + MasterPage Party PIN Code field; `services/einvoice.ts` — NIC v1.01 payload re-projecting `voucherGst()` classification + line snapshots, goods-from-inventory / services-only-when-no-inventory split, strict all-at-once validation naming every gap (never a half-formed payload), UQC mapping, line-taxable cross-check, Sales→INV / Credit Note→CRN positive magnitudes, RCM + cancelled rejected; `GET /reports/einvoice/:voucherId` (cid-gated, read-only) returning `{ ok, errors, payload }`; client — "e-inv" action on GSTR-1 B2B rows, JSON download, amber validation banner, green confirmation. No posting-engine change; accounting math untouched.
- **Verification (final tree):** Python **991/991** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **709** incl. 27 R-24, attack-the-fixes 29); browser **285/285** on a rebuilt image + fresh volume (11/11 migrations, `party_pincode` verified live; run.js 153/153 exit-0 + r03…r24 = 132 scenario checks, r24 16/16); typecheck server + client clean; `git diff --check` clean. En-route fixture findings (app correct): voucher API field is `inventoryEntries` with numeric gstRate; UI ledger defaults are registration/taxability "none" — validator correctly refused until fixtures set Regular/Taxable.
- **Next permitted action:** on instruction — finalize ledger docs (RELEASES/ROADMAP/STATE/CONTINUE), release gate on the final tree, commit `Release v1.23.0: e-invoice payload generation (IRP upload)`, annotated tag `v1.23.0`, integrity + immutability verification.
- **Verification (final tree):** Python **964/964** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **682** incl. 33 R-23, attack-the-fixes 29); browser **267/267** (run.js + r03/r04/r05/r07/r10/r14/r18/r20/r21/r23); typecheck server + client clean; fresh volume applies 10/10 migrations.
- **Next permitted action:** on "continue zprime" → present R-24 scope decision (already done this session); await human approval/adjustment/rejection of the Option A scope before any implementation.
- **What changed (implemented scope):** migration `0009_r23_rcm.sql` (additive: `vouchers.is_rcm` boolean DEFAULT false, no backfill; snapshot idx 9) + `schema.ts isRcm`; `companies.ts` seeds the "RCM Payable" duty ledger at company creation; `voucherSchema` + create/edit/uncancel persist `isRcm` (client-supplied actor/flag trust rules unchanged — isRcm is a legitimate user choice, actor identity stays JWT-only); `gst.ts` — `voucherGst()` computes `rcmTaxable/rcmIgst/rcmCgst/rcmSgst` and `gstr3b()` gains additive `inwardRcm` (4(A)(3)) + `rcmItc` sections with regular-ITC exclusion; client — Alt+R + panel toggle on Purchase/Debit Note with amber strip, Day Book RCM badge, 3B view rows, MasterPage dutyHead RCM option. No posting-engine change; accounting math untouched.
- **Verification (final tree):** Python **964/964** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **682** incl. 33 R-23, attack-the-fixes 29); browser **267/267** on a rebuilt image + fresh volume (run.js 153/153 exit-0 + r03…r23 = 114 scenario checks, r23 14/14); typecheck server + client clean; fresh volume applies 10/10 migrations (`is_rcm` verified live); `git diff --check` clean. Suite en route: r23_ui's Day Book matcher fixed (innerText concatenates the inline badge → "PurchaseRCM"); app was correct. Rig note: after a Docker-daemon restart `zprime-test-pg` must be recreated per README's `docker run` line — it was found removed this session and was recreated.
- **Diff shape:** 13 modified files + 4 new (migration, snapshot, r23_ui.js, investigation) — +281/−12 at last stat, all scoped to R-23; CHANGELOG heading drift fixed en route (R-17…R-22 sections were still labeled "Unreleased" — corrected to their release versions v1.17.0–v1.21.0).
- **Blocked decisions (waiting on human):** release instruction for v1.22.0. Next R-item: ask for direction (GST family remainder: e-invoice / e-way bill / GSTR-9 / TCS — each large, its own cycle).
- **What changed (implemented scope):** migration `0008_r22_master_actor.sql` (additive: `created_by`/`updated_by` FK→users ON DELETE SET NULL + `updated_at` on 9 master tables — groups, ledgers, units, stock_groups, stock_categories, godowns, stock_items, employees, pay_heads; NOT voucher_types/tds_sections: system-seeded; no backfill) + programmatic snapshot/journal (idx 8); `schema.ts` columns via a shared `masterActor()` helper; ONE `crud()` change covers all 11 registrations (POST stamps createdBy, PUT stamps updatedBy+updatedAt, created_by immutable, client-supplied actor fields stripped — JWT-only identity); import.ts 5 ensure* inserts stamp `importingActor`; company seeding stays NULL honestly. No client change.
- **Verification (final tree):** Python **931/931** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **649** incl. 20 R-22, attack-the-fixes 29); browser **255/255** on a rebuilt image + fresh volume (run.js 153/153 exit-0 + r03/r04/r05/r07/r10/r14/r18/r20/r21 = 102 scenario checks); typecheck server + client clean; fresh volume applies 9/9 migrations (27 new columns verified live). Harness hardening en route: final_regression now kills orphaned servers (new process group + pre-kill) after a stale 3106 squatter caused a false failure.
- **Blocked decisions (waiting on human):** none. Next session: ask for R-24 direction (genuinely open candidates: the postponed GST compliance family — e-invoice / e-way bill / GSTR-9 / TCS — each large and its own cycle; or hold steady).

---

## Current state

- **Current release:** v1.18.0 (resolve with `git rev-parse v1.18.0^{}`; see RELEASES.md)
- **Current HEAD:** the v1.18.0 release commit (see RELEASES.md / `git rev-parse HEAD`)
- **Current phase:** `HUMAN_REVIEW` — R-20 investigation complete; awaiting approval of the proposed audit-timeline scope — see `DEVELOPMENT_PROTOCOL.md`
- **Current task:** R-20 (company audit timeline). Investigation: `R-20_INVESTIGATION.md`.
- **Investigation findings:** R-18's `audit_events` table + `(company_id, created_at)` index were designed for exactly this — no migration, no new auth tier, no accounting surface. Endpoint `GET /audit` (cid-gated, id-DESC chronology — same-tx events can tie on created_at, id is strict; limit clamp + action filter + before-cursor; LEFT JOIN vouchers/types so deleted vouchers render unlinked with their snapshot). UI: new AuditTrail page at /company/:cid/audit + one Gateway utilities card. Tests: +8 Python → 901, new r20_ui.js ~6 → 234. Proposed release v1.19.0.
- **Blocked decisions (waiting on human):** R-20 scope approval (audit timeline).
- **R-19 (historical, closed):** B-12 backup/restore ALREADY CLOSED by R-12/v1.12.0 — re-verified live on v1.18.0; ROADMAP row retired; docs committed as `2be2097`.
- **What changed (R-17, historical):** migration `0006_r17_voucher_actor.sql` (additive: `vouchers.created_by`/`updated_by` FK→users ON DELETE SET NULL + `updated_at`; no fabricated backfill) + snapshot/journal; propagation at all three write sites (`insertVoucherTx` actor param for manual POST, import's own insert stamps the importing user, PUT stamps updated_by/updated_at with created_by immutable); `final_regression.py` +7 R-17 checks → 593. No client change; masters deferred (documented).
- **Verification:** Python **875/875** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **593** incl. 7 R-17, attack-the-fixes 29); browser **219/219** on a rebuilt image + fresh volume (7/7 migrations); typecheck clean.
- **What changed (approved test-only scope):** `final_regression.py` +8 R-15 checks → 586: paired openings → TB 0; interstate sale → GSTR-3B net.igst 900 and GSTR-1 netIgst 900 (openings excluded, period-only return semantics); IGST duty-ledger position −5,000 → −5,900 (book position carries opening); unpaired opening → TB −5,000 / BS +5,000 surfaced honestly. No source, migration, or client changes.
- **Investigation findings (live-probed on v1.14.0):** GST returns are period-only by design (derived purely from voucher entries; openings never enter the query) — GSTR-3B net 900 with a Cr-5000 IGST opening present; the duty ledger carries the true position (−5,000 → −5,900); unpaired openings surface honestly as TB/BS difference (R-14 card). No false invariant anywhere → F-15-1/F-15-2 NOT A BUG — VERIFIED. Proposed R-15: test-hardening only, ~6 checks locking this semantics (no source changes) → 866; alternatively a formal readiness review.
- **Investigation findings (summary):** F-14-1 TB had no out-of-balance surface anywhere — SELECTED, P3. F-14-2 negative-stock warning: NOT A BUG — VERIFIED (R-06 server guard). F-14-3 import error surfacing: NOT A BUG — VERIFIED (R-04 atomic import, live-probed). F-14-4 opening-stock helper: documented limitation (F-07-2 Model A).
- **What changed (approved full scope):** `accounting.ts` `trialBalance()` returns additive `difference` field (display-only); TB report gains the amber out-of-balance banner (copy of the existing BS pattern); Gateway gains a compact "Books Health" card (silent-degrade). `final_regression.py` +6 R-14 checks → 578; new `r14_ui.js` (11 checks: clean → balanced chip + no banner; Dr-777.77 asymmetry → banner + out-by chip + view link; counterpart opening restores balance). No migration, no accounting-math change.
- **What changed (approved full scope):** new `server/src/lib/loginGuard.ts` (in-memory sliding-window limiter: 10 failures/10 min per source-IP+username → 429 + Retry-After until oldest failure ages out; success resets); `auth.ts` lockout check before user lookup + dummy-scrypt timing equalization (unknown-user path now performs one scrypt — the 20.7× enumeration oracle is collapsed); `final_regression.py` +14 R-13 checks → 572; README login-throttling + timing-equalization notes. No migration, no client change, no new dependency.
- **Verification:** Python **875/875** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **593** incl. 7 R-17, attack-the-fixes 29); browser **219/219** on a rebuilt image + fresh volume (7/7 migrations); typecheck clean.
- **Next permitted action:** human approves/adjusts the R-18 scope (audit_events migration 0007, same-tx capture at 7 sites incl. payroll + delete, read-only VoucherScreen History viewer, ~8 regression + ~4 browser checks) → implementation; or adjusts scope. Side-finding F-R18-1: payroll voucher insert misses created_by (folded into R-18).
- **Investigation findings:** three voucher insert/update sites need actor stamping — `insertVoucherTx` (manual), the import path's OWN insert (import.ts:448, does not reuse insertVoucherTx), and `PUT /vouchers/:id`; cancel/uncancel already actor-stamped (R-02). Proposed scope (vouchers only, masters deferred — no per-row history to anchor them): additive migration 0006 (`created_by`/`updated_by` FK→users ON DELETE SET NULL, optional `updated_at`, no backfill of fabricated actors), ~6 lines centralized propagation, optional Day Book display, ~5 regression checks → 873. No audit-events table, no history UI.
- **Next permitted action (R-17, historical):** superseded — v1.17.0 released; see the current-state block above.
- **Environment note (permanent):** the verification stack requires `.env` at repo root (never committed; `.env.example` is the template) — create it before `docker compose up`.
- **Blocked decisions (waiting on human):** release go/no-go for v1.18.0.
- **What changed (R-10, historical):** additive migration `0005_r10_idempotency_keys.sql` (`idempotency_keys`, UNIQUE(company_id, key)); `vouchers.ts` POST accepts optional `idempotencyKey` (body or `X-Idempotency-Key` header) — replay returns the ORIGINAL voucher, key+voucher recorded in one transaction, concurrent same-key race resolves to one voucher; `VoucherScreen.tsx` generates a UUID per new-voucher form and sends it, plus a `savingRef` guard making Ctrl+A single-shot; `final_regression.py` +12 R-10 checks; `r10_ui.js` new 10-check browser suite.
- **Verification on the final tree:** Python **813/813** (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression **531** incl. 12 R-10, attack-the-fixes 29); browser **208/208** (153 + 12 + 9 + 12 + 12 + 10 R-10) on a rebuilt client with a fresh-volume stack; typecheck server+client clean; migration verified on both fresh install (6/6 applied) and the test rig (0005 forward-applied from 5).
- **Next permitted action (historical, R-10):** superseded — see the current-state block above.
- **Environment note (permanent):** the verification stack requires `.env` at repo root (never committed; `.env.example` is the template) — create it before `docker compose up`.
- **Blocked decisions (waiting on human):** release go/no-go for v1.17.0.

## Baseline verification (must re-confirm every session)

```bash
git rev-parse HEAD     # expect the v1.11.0 release commit (see RELEASES.md)
git describe --tags    # expect v1.11.0
git status --short     # expect clean tree except the intentional untracked ZLEDGER_PRODUCTION_ACTION_PLAN.md
```

- Test baseline at v1.15.0: **868/868 automated checks** (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 586 incl. R-06…R-15 checks, attack-the-fixes 29) + **219/219 browser** (baseline 153 + R-03 UI 12 + R-04 UI 9 + R-05 UI 12 + R-07 UI 12 + R-10 UI 10 + R-14 UI 11). Exact commands in `STATE.md` ("Verification record"). Note: totals through v1.11.0 were previously advertised as 813/831; the measured component sums are the authority (813 for v1.10.0 stands, v1.11.0 is 834).
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
