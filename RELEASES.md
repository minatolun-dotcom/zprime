# RELEASES.md — Immutable Release Ledger

The authoritative release history of zprime. **Every entry below is immutable.** Never rewrite history, never modify a released commit, never move or re-point a tag. The next release is appended below the last entry.

---

## v1.23.0

- **Commit:** `v1.23.0^{}` — resolve with `git rev-parse v1.23.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.23.0` (annotated; `v1.23.0^{}` = the release commit, verified at release)
- **Major purpose:** E-invoice payload generation (R-24, approved Option A — generate + download only; live IRP/GSP connectivity explicitly deferred pending a product decision on external services). Migration `0010_r24_party_pincode.sql` (additive `ledgers.party_pincode`, no backfill) + Party PIN Code field on the ledger form. New `services/einvoice.ts`: NIC v1.01 B2B payload re-projecting `voucherGst()` classification + `inventory_entries`/`voucher_entries` line snapshots (goods from inventory; service lines only when the voucher has no inventory), strict **all-at-once** validation naming every gap with the exact field to fix — never a half-formed payload — UQC symbol mapping with loud failure, line-taxable cross-check against `voucherGst`; Sales→INV, Credit Note→CRN (positive magnitudes); Receipt/RCM/cancelled rejected. Read-only cid-gated `GET /reports/einvoice/:voucherId` returning `{ ok, errors, payload }`. Client: "e-inv" action on GSTR-1 B2B rows + JSON download + amber validation banner + green confirmation. No posting-engine change; accounting math untouched.
- **Verification status:** VERIFIED AT RELEASE —
  - 991/991 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 709 (+27 dedicated R-24 checks: payload determinism, seller/buyer blocks incl. pincode, values matching voucherGst, HSN/UQC line data, all-at-once pincode errors with no payload, unregistered rejection, Receipt rejection, CRN positive magnitudes, non-member 404), attack-the-fixes 29)
  - 285/285 browser checks on a rebuilt image with fresh volume (11/11 migrations, `party_pincode` verified live; run.js 153/153 exit-0 + r03…r24 = 132 scenario checks, new `r24_ui.js` 16/16: PIN field on the ledger form, full sale through the voucher form, e-inv download through the REAL UI, payload contents, amber validation banner, no download on failure)
  - typecheck clean (server + client)
- **Important fixes:** the one schema gap for e-invoicing closed (buyer PIN); en-route fixture findings all app-correct/test-fixed (`inventoryEntries` + numeric gstRate; UI ledger defaults registration/taxability "none" and blank company address/pincode — validator correctly refused until completed, which is the designed strictness).
- **Immutable status:** 🔒 IMMUTABLE — `v1.23.0` is the current production baseline.

---

## v1.22.0

- **Commit:** `v1.22.0^{}` — resolve with `git rev-parse v1.22.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.22.0` (annotated; `v1.22.0^{}` = the release commit, verified at release)
- **Major purpose:** Reverse charge mechanism (R-23, approved full scope — retired the ROADMAP "explicitly out of scope" row). RCM becomes expressible and correctly classified: additive migration `0009_r23_rcm.sql` — `vouchers.is_rcm` boolean `NOT NULL DEFAULT false` (RCM marked **per-transaction**, not per-supplier; no backfill — every existing voucher honestly regular-charge) + idempotent seed of the "RCM Payable" duty ledger (`dutyHead='RCM'`) for **existing** companies; new companies seed it at creation. `voucherSchema` gains `isRcm`; create/edit/list persist/return it. `voucherGst()` classifies RCM inward duty rows into synthetic IGST / CGST+SGST (POS vs company state; unresolvable POS → conservative IGST + existing mismatch flag); `gstr3b()` gains additive **`inwardRcm` (Table 4(A)(3))** + **`rcmItc`** sections with RCM vouchers excluded from regular ITC (previously a self-assessed line would have silently reduced net payable); RCM nets to nil on the books (asserted). Client: Alt+R + panel toggle on Purchase/Debit Note with amber guidance strip, Day Book RCM badge, GSTR-3B view rows (hidden when all-zero), Ledger form Duty Head RCM option. No posting-engine change — the gateway Dr=Cr rule and duty-ledger posting are untouched; books' truth remains the posted RCM ledger.
- **Verification status:** VERIFIED AT RELEASE —
  - 964/964 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 682 (+33 dedicated R-23 checks: flag persistence, 4(A)(3)+RCM-ITC values, regular-ITC exclusion, net-cash-nil reconciliation, RCM ledger position, isRcm strips on edit/uncancel, forgery stripping), attack-the-fixes 29)
  - 267/267 browser checks on a rebuilt image with fresh volume (10/10 migrations, `is_rcm` + seed verified live; run.js 153/153 exit-0 + r03…r23 = 114 scenario checks, new `r23_ui.js` 14/14: toggle, strip, badge, 3B rows, net 0, no Sales control)
  - typecheck clean (server + client)
- **Important fixes:** GSTR-3B Table 4(A)(3) now exists and regular ITC no longer absorbs self-assessed RCM duty; en-route suite fix (Day Book matcher — innerText concatenates the inline badge), rig recreation after daemon restart, CHANGELOG heading drift corrected (R-17…R-22 sections were still labeled "Unreleased").
- **Immutable status:** 🔒 IMMUTABLE — `v1.22.0` is the current production baseline.

---

## v1.21.0

- **Commit:** `v1.21.0^{}` — resolve with `git rev-parse v1.21.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.21.0` (annotated; `v1.21.0^{}` = the release commit, verified at release)
- **Major purpose:** Master-table actor provance (R-22, approved product decision after two documented deferrals — the R-18/R-20 audit surfaces removed the "no per-row history anchor" objection). R-17's voucher provance pattern applied to masters: additive migration `0008_r22_master_actor.sql` — `created_by`/`updated_by` (FK → users, ON DELETE SET NULL, nullable) + `updated_at` on **9 master tables** (groups, ledgers, units, stock_groups, stock_categories, godowns, stock_items, employees, pay_heads); programmatic snapshot + journal (idx 8). **No backfill** — pre-R-22 rows honestly NULL; company seeding (reserved groups, starter ledgers, voucher types, TDS sections) also stays NULL (no authenticated actor exists at seeding; fabricating one would be dishonest). Excluded: `voucher_types` + `tds_sections` (system-seeded, no user creation surface). Stamping: ONE `crud()` change covers all 11 registered kinds (POST stamps `createdBy`; PUT stamps `updatedBy`+`updatedAt` with `created_by` immutable; client-supplied actor fields stripped — identity from the verified JWT only); import's 5 master-ensure inserts stamp the importing actor. No client change, no accounting-math surface.
- **Verification status:** VERIFIED AT RELEASE —
  - 931/931 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 649 (+20 dedicated R-22 checks: POST/PUT stamping, created_by immutability, actor-forgery stripping on POST + PUT, import-created ledger/item carry the importing actor, seeded rows NULL, second-member edit stamps the actual editor, fresh updated_at NULL), attack-the-fixes 29)
  - 255/255 browser checks on a rebuilt image with fresh volume (9/9 migrations, 27 new columns verified live; run.js 153/153 exit-0 + r03/r04/r05/r07/r10/r14/r18/r20/r21 = 102 scenario checks)
  - typecheck clean (server + client)
- **Important fixes:** masters now carry honest creator/editor provance in a multi-member company ("who created this ledger / stock item / employee"); the deferral rationale from R-17/R-20 is retired. Test-harness hardening en route: final_regression now kills orphaned servers (new process group + pre-kill) after a stale port squatter caused a false failure.
- **Immutable status:** 🔒 IMMUTABLE — `v1.21.0` is the current production baseline.

---

## v1.20.0

- **Commit:** `v1.20.0^{}` — resolve with `git rev-parse v1.20.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.20.0` (annotated; `v1.20.0^{}` = the release commit, verified at release)
- **Major purpose:** Pre-validation UX (R-21, approved scope) — the two UX companions to B-01/B-03 diagnosed in R-04 §15. (A) VoucherScreen negative-stock advisory: amber strip live while typing, computed from the same chronological source the R-06 guard uses (`/reports/stock-summary?to=<date>` closingQty + client deltas with the type's flow sign, STOCK_FLOW and SJ source/target kinds mirrored); names item/available qty/date/settings escape hatch; suppressed on `allowNegativeStock` opt-in, silent-degrade on fetch failure; the R-06 server guard remains the sole authority. Required additive fix: companies list/detail now return `allowNegativeStock` (previously missing — suppression was impossible; caught live by the browser suite). (B) Import dry-run: `POST /xml?dryRun=1` runs the IDENTICAL single-transaction import path (every parser, validateEntries, assertStockAvailabilityTx, reference/bill/duplicate checks) then throws a sentinel → full rollback → same stats table + `dryRun: true`; client gains Validate (dry run) button + "nothing was imported" banner. No migration, no accounting-math change, no new auth surface (same cid() gate; non-member → 404).
- **Verification status:** VERIFIED AT RELEASE —
  - 911/911 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 629 (+10 dedicated R-21 checks: dry-run stats with nothing persisted (vouchers/ledgers/items/counters unchanged, Day Book empty), unbalanced/oversell XML rejected with real errors while persisting nothing, real import after dry runs unaffected, non-member dry-run 404), attack-the-fixes 29)
  - 253/253 browser checks on a rebuilt image with fresh volume (8/8 migrations; new `r21_ui.js` 13 checks: warning appears on UI oversell, names item/qty/setting, clears on correction, suppressed on opted-in company; Validate → nothing-imported banner + Day Book unchanged; Start Import → voucher appears)
  - typecheck clean (server + client)
- **Important fixes:** operators now see the oversell while typing (not at a failed save) and can validate an XML import before committing it; `allowNegativeStock` exposed in company responses (R-06 follow-up).
- **Immutable status:** 🔒 IMMUTABLE — `v1.20.0` is the current production baseline.

---

## v1.19.0

- **Commit:** `v1.19.0^{}` — resolve with `git rev-parse v1.19.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.19.0` (annotated; `v1.19.0^{}` = the release commit, verified at release)
- **Major purpose:** Company audit timeline (R-20, approved product decision — completes the R-18 audit feature; no migration, no accounting-math change). Server: cid()-gated read-only `GET /audit` in `vouchers.ts` — `id DESC` chronology (same-transaction events tie on `created_at`; `id` is strictly monotonic), `limit` clamped 1–1000 (default 200), optional `action` enum filter, `before` id-cursor, LEFT JOIN users/vouchers/voucherTypes for actor + voucher number/type. Client: `AuditTrail.tsx` at `/company/:cid/audit` (action badges, empty state, action filter; live vouchers link to the alter surface; deleted vouchers render unlinked with their R-18 snapshot) + App.tsx route + Gateway utilities card. No new authorization concept (cid() membership inherited), no schema change.
- **Verification status:** VERIFIED AT RELEASE —
  - 901/901 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 619 (+8 dedicated R-20 checks: newest-first ordering, company isolation, joined fields, action filter, before-cursor, limit clamp, cid boundary 404-unknown/400-malformed, detached delete row), attack-the-fixes 29)
  - 240/240 browser checks on a rebuilt image with fresh volume (8/8 migrations; new `r20_ui.js` 12 checks: Gateway card → page, empty state, created/edited/deleted lifecycle rows, alter link, actor column, newest-first ordering, action filter)
  - typecheck clean (server + client)
- **Important fixes:** the audit feature is now user-visible company-wide — WHO did WHAT WHEN for every voucher, discoverable from the Gateway without knowing voucher ids.
- **Immutable status:** 🔒 IMMUTABLE — `v1.19.0` is the current production baseline.

---

## v1.18.0

- **Commit:** `v1.18.0^{}` — resolve with `git rev-parse v1.18.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.18.0` (annotated; `v1.18.0^{}` = the release commit, verified at release)
- **Major purpose:** Full audit feature — voucher lifecycle history (R-18, approved product decision; no defect behind it). Additive migration `0007_r18_audit_events.sql`: `audit_events` append-only log (`company_id` FK CASCADE; **`voucher_id` nullable FK SET NULL — a hard delete must not erase its own trail; the terminal `delete` event survives with a one-line snapshot in `detail`**; `actor_id` FK SET NULL; `action` create|edit|cancel|uncancel|delete; `created_at`; two indexes). **No backfill** — pre-R-18 transitions are unknowable; seeding would fabricate history. Same-transaction capture at all 7 voucher write sites (an event exists iff the change committed — never accounting-changed/audit-lost): manual create, XML import (importing actor), payroll create, edit, cancel (+reason), uncancel, delete (event recorded before the row goes; Day-Book-convention debit-side snapshot). R-10 idempotent replay records no event. **F-R18-1 folded in:** payroll voucher insert now stamps `created_by` (R-17 gap). Viewer: `GET /vouchers/:id/audit` (cid-gated, actor usernames joined) + compact VoucherScreen history strip (edit mode, silent-degrade). No company-wide timeline, no masters events, no retention/export (documented out-of-scope).
- **Verification status:** VERIFIED AT RELEASE —
  - 893/893 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 611 (+18 dedicated R-18 checks incl. cross-company audit 404 and a forced-failure **atomicity proof** — audit failure aborts the posting), attack-the-fixes 29)
  - 228/228 browser checks on a rebuilt image with fresh volume (8/8 migrations — fresh install with 0007 verified; new `r18_ui.js` 11 checks: fresh voucher shows no strip; "Created by admin" on alter; edit appends "Edited by admin" in lifecycle order; Day Book + TB balanced)
  - typecheck clean (server + client)
  - upgrade-safe: additive new table only; fresh-install and upgrade paths both verified
- **Important fixes:** every voucher transition now carries WHO did WHAT WHEN, provable after the fact (including after deletion); F-R18-1 payroll provance gap closed.
- **Immutable status:** 🔒 IMMUTABLE — `v1.18.0` is the current production baseline.

---

## v1.17.0

- **Commit:** `v1.17.0^{}` — resolve with `git rev-parse v1.17.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.17.0` (annotated; `v1.17.0^{}` = the release commit, verified at release)
- **Major purpose:** Voucher actor provance — audit-trail groundwork (R-17, P3 feature item). Additive migration `0006_r17_voucher_actor.sql`: `vouchers.created_by` + `updated_by` (FK → users, `ON DELETE SET NULL`, nullable) + `updated_at`; existing rows keep NULL — no fabricated backfill (pre-R-17 actor values are unknowable; honesty over cosmetics). Propagation at all three voucher write sites from the verified JWT identity (`req.userId`, never client-supplied): `insertVoucherTx` stamps `created_by` (manual POST via new actor parameter); the XML import's own insert stamps the importing user; `PUT /vouchers/:id` stamps `updated_by` + `updated_at` with `created_by` immutable. Cancel/uncancel R-02 semantics untouched; R-10 idempotent replay records no actor event. Master tables deliberately deferred (no per-row history surface to anchor them; generic-CRUD site makes them a ~15-line later addition). No audit-events table, no history UI — groundwork only. No client change, no accounting-math change.
- **Verification status:** VERIFIED AT RELEASE —
  - 875/875 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 593 (+7 dedicated R-17 checks: manual stamping, no updated_* on creation, edit stamps updated_* preserving created_by, updated_at stamped, cancel/uncancel actor cycle unchanged, admin id resolution), attack-the-fixes 29)
  - 219/219 browser checks on a rebuilt image with fresh volume (7/7 migrations — fresh install with 0006 verified)
  - typecheck clean (client untouched)
  - upgrade-safe: additive nullable columns; fresh-install and upgrade paths both verified
- **Important fixes:** the future audit feature (WHO entered/edited each voucher) now has its identity plumbing in place without another schema campaign; Day Book-level provance is queryable today.
- **Immutable status:** 🔒 IMMUTABLE — `v1.17.0` is the current production baseline.

---

## v1.16.0

- **Commit:** `v1.16.0^{}` — resolve with `git rev-parse v1.16.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.16.0` (annotated; `v1.16.0^{}` = the release commit, verified at release)
- **Major purpose:** Deployment self-healing (R-16, F-R1 P3 from READINESS_REVIEW.md) — **compose/docs-only release: no application code, no migration, no client changes.** F-R1 (reproduced live during the readiness review): on a fresh volume the db healthcheck (`pg_isready`) can pass transiently during `initdb`; the app's first migration connection then hits ECONNREFUSED and, with no restart policy, the container exited and stayed dead until manual restart (recoverable; migrations apply cleanly on the recovering boot — no data risk). Fix: `restart: unless-stopped` on both `app` and `db`; README note documents the policy, the self-healing behavior, and that `docker stop/kill` remain honored as operator intent. This release also **adopts RELEASE CANDIDATE** as the product status in STATE.md (per READINESS_REVIEW.md — supersedes the production action plan's ALPHA verdict, which predated R-04…R-15).
- **Verification status:** VERIFIED AT RELEASE —
  - fresh-volume compose boot healthy (6/6 migrations); self-healing proven live: app-initiated crash → automatic restart → health 200 with zero operator action; `docker kill` correctly stayed down (documented Docker semantics)
  - 868/868 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 586, attack-the-fixes 29)
  - 219/219 browser checks (baseline run + R-14 suite re-run green on the rebuilt stack; compose-only change)
  - no application code touched; no test weakened
- **Important fixes:** P3 closed — a genuinely fresh deployment now self-recovers from the first-boot race instead of requiring an operator `docker compose up`.
- **Immutable status:** 🔒 IMMUTABLE — `v1.16.0` is the current production baseline.

---

## v1.15.0

- **Commit:** `v1.15.0^{}` — resolve with `git rev-parse v1.15.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.15.0` (annotated; `v1.15.0^{}` = the release commit, verified at release)
- **Major purpose:** Opening-GST semantics regression lock (R-15, test-only — no source, migration, or client changes). The R-15 investigation live-verified the opening-GST-balances candidate (plan §13 P2) as NOT A BUG: GST returns are period-only by design (derived purely from voucher entries; ledger openings never enter the query — `gst.ts` has no opening term), the duty ledger carries the true book position, and unpaired openings surface honestly as TB/BS differences via the R-14 health surface. No false invariant anywhere. The verified semantics had zero coverage — this release locks it in: `final_regression.py` +8 R-15 checks (586) — migrated-books company with paired openings (Cr 5,000 IGST liability vs Dr 5,000 counterpart) → TB difference 0; interstate sale (taxable 10,000 + IGST 900); GSTR-3B `net.igst == 900` and GSTR-1 `netIgst == 900` (openings excluded — period-only return semantics); IGST duty-ledger position −5,000 → −5,900 (book position carries the opening); unpaired-opening company → TB −5,000 / BS +5,000 surfaced honestly.
- **Verification status:** VERIFIED AT RELEASE —
  - 868/868 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 586 (+8 dedicated R-15 checks), attack-the-fixes 29)
  - 219/219 browser checks unchanged (zero client changes)
  - no assertion weakened anywhere — coverage only grew; no source changes at all
- **Important fixes:** P2-class coverage gap closed — the returned-vs-ledger GST semantics for migrated books (openings excluded from returns, carried in ledgers) is now protected against regression, matching the B-11 discipline of locking verified-correct behavior.
- **Immutable status:** 🔒 IMMUTABLE — `v1.15.0` is the current production baseline.

---

## v1.14.0

- **Commit:** `v1.14.0^{}` — resolve with `git rev-parse v1.14.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.14.0` (annotated; `v1.14.0^{}` = the release commit, verified at release)
- **Major purpose:** TB health surface (R-14, F-14-1 P3) — out-of-balance visibility. The R-14 investigation re-verified the action plan's three remaining UX candidates: negative-stock warning and import error surfacing were superseded by R-06/R-04 server-side guards (NOT A BUG — VERIFIED; import atomicity live-probed: unbalanced voucher → 400 per-voucher error, zero persisted, TB diff 0). The confirmed gap: books imbalance had **no surface anywhere** — the TB report showed Dr/Cr totals side-by-side with no warning, the Gateway had no health indicator. Since posting-time validation exists, only operator data (an asymmetric opening entry — the historical B-02 class) can unbalance books; validation of the feature surfaced that the test suite's own O-1 fixture had silently carried a 10,000 imbalance, caught by nothing until now. Changes: `trialBalance()` returns additive `difference: r2(totalDebit - totalCredit)` (display-only, same class as the BS `difference`); TB report gains the amber "Difference in books" banner (copy of the existing BS pattern); Gateway gains a compact "Books Health" card (✓ balanced / ✗ out by X + view link; silent-degrade on fetch failure). No migration, no accounting-math change.
- **Verification status:** VERIFIED AT RELEASE —
  - 860/860 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 578 (+6 dedicated R-14 checks: additive field present, 0 on clean books, injected Dr-777.77 asymmetry surfaces exactly, identity difference == totalDebit − totalCredit), attack-the-fixes 29)
  - 219/219 browser checks (baseline 153 + R-03 12 + R-04 9 + R-05 12 + R-07 12 + R-10 10 + **R-14 11**: clean → balanced chip + no banner; asymmetry → banner + out-by chip + view link; counterpart opening restores balance) on a rebuilt image with fresh volume
  - typecheck (server + client) clean
  - accounting calculations untouched (one display field added); no test weakened — coverage only grew
- **Important fixes:** books imbalance is now visible at a glance on the Gateway and in the TB report — the B-02/B-03 imbalance *class* gets an immediate detection surface instead of relying on someone manually comparing two TB columns.
- **Immutable status:** 🔒 IMMUTABLE — `v1.14.0` is the current production baseline.

---

## v1.13.0

- **Commit:** `v1.13.0^{}` — resolve with `git rev-parse v1.13.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.13.0` (annotated; `v1.13.0^{}` = the release commit, verified at release)
- **Major purpose:** Login hardening (R-13, F-13-1 P3 + F-13-2 P3, both live-reproduced on v1.12.0) — **server-only release: no migration, no client change, no new dependency.** F-13-1: no rate limiting/lockout on `POST /api/auth/login` (25 failed logins → 25 instant 401s; P3, P2 for internet-exposed deployments — R-09 made exposed deployment a supported configuration). F-13-2: timing side-channel enabled username enumeration (valid-user-wrong-password 43.0 ms vs unknown-user 2.1 ms, a 20.7× oracle, because `scryptSync` was skipped when the user did not exist). Fixes: new `server/src/lib/loginGuard.ts` — in-memory sliding-window limiter keyed by source IP + exact username, 10 failures/10 min locks the pair until the oldest failure ages out (`429` + `Retry-After`), successful login resets; `auth.ts` performs the lockout check **before** any user lookup (a locked pair learns nothing about account existence) and burns one dummy scrypt on the unknown-user path so both failure paths do identical work (oracle collapsed); uniform 401 body preserved. State is in-memory, single-process by design (documented in README + code).
- **Verification status:** VERIFIED AT RELEASE —
  - 854/854 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 572 (+14 dedicated R-13 checks: threshold semantics, correct-password-during-lockout refused — no bypass, per-(ip, username) isolation, full reset cycle via successful login, unknown-user latency ≥10 ms with ratio <3× — oracle collapsed, uniform 401 body), attack-the-fixes 29)
  - 208/208 browser checks on a rebuilt image with fresh volume (6/6 migrations, fresh install verified) — the baseline suite's many successful logins coexist with the limiter
  - typecheck (server + client) clean
  - no accounting code touched (login path only); no test weakened — coverage only grew
- **Important fixes:** the last open Phase-5 hardening item that does not expand product scope — online password guessing now rate-limited, and usernames can no longer be enumerated by response timing.
- **Immutable status:** 🔒 IMMUTABLE — `v1.13.0` is the current production baseline.

---

## v1.12.0

- **Commit:** `v1.12.0^{}` — resolve with `git rev-parse v1.12.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.12.0` (annotated; `v1.12.0^{}` = the release commit, verified at release)
- **Major purpose:** Backup/restore runbook and round-trip guard (R-12, B-12 P4 reclassified from P2) — **docs/test-only release: no source, migration, or client changes.** B-12 claimed "no backup/restore in product"; the investigation live-verified the documented `pg_dump` → drop → restore → verify path end-to-end (39 vouchers / 9 companies identical after restore, app healthy) in both the live stack and the disposable test rig, and found the only real gap: the README restore procedure omitted the stop-app → drop/recreate prerequisite (restoring over a live schema fails on `CREATE TABLE` collisions). README "Data & backups" rewritten as a verified runbook (backup command, restore sequence, row-count verification step, volume-snapshot alternative with tradeoff). `final_regression.py` +6 R-12 checks (558): the exact runbook shape guarded in the test rig — dump succeeds, scratch DB created, plain-SQL restore applies with `ON_ERROR_STOP` (drift catcher: future schema/migration changes that break plain-SQL restore now fail the battery, not an operator's restore), restored company + voucher counts match source, scratch DB dropped.
- **Verification status:** VERIFIED AT RELEASE —
  - 840/840 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 558 (+6 dedicated R-12 checks), attack-the-fixes 29) — totals corrected at this release: the v1.11.0 entry below recorded 831, but the component sum is 834 (39+88+65+61+552+29); the error originated in the v1.10.0-era bookkeeping and propagated. Suite counts were always measured correctly; only the advertised totals were wrong
  - 208/208 browser checks unchanged (zero client changes)
  - no assertion weakened anywhere — coverage only grew
  - F-12-3 (in-product backup endpoint) explicitly out of scope with its global-admin prerequisite documented in the investigation; no backup UI/endpoint built
- **Important fixes:** P4 closed — the only data-safety path an operator has is now documented correctly and regression-guarded against schema drift.
- **Immutable status:** 🔒 IMMUTABLE — `v1.12.0` is the current production baseline.

---

## v1.11.0

- **Commit:** `v1.11.0^{}` — resolve with `git rev-parse v1.11.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.11.0` (annotated; `v1.11.0^{}` = the release commit, verified at release)
- **Major purpose:** Purchase-side settlement regression coverage (R-11, B-11 P3 reclassified from P2) — **test-only release: no source, migration, or client changes.** B-11 confirmed the creditor-side mirror of the bill-wise machinery had zero coverage. `final_regression.py` +21 R-11 checks (creditor-side adversarial mirror of BUG-002, Debit Note settling a purchase bill via mixed-sign `against_ref`, DN over-settlement rejection, payment settling the DN-reduced remainder, advance-to-creditor consumed by a later purchase's credit entry (direction-strict pattern), one voucher settling two open bills via opposing entries, AP assertions at every stage, GSTR-3B ITC reversal, TB identity) → 552; `reconcile.py` +3 checks (61): bill-wise DN-2 woven into the hand-computed scenario with all downstream independent expectations recomputed (TB 7,64,400 / purchases 42,000 / profit 1,26,000 / Sigma 19,560 / ITC 3,780 / net GST 24,840).
- **Verification status:** VERIFIED AT RELEASE —
  - 834/834 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 552 (+21 dedicated R-11 checks), attack-the-fixes 29) [total corrected from 831 in v1.12.0 — component sum is authoritative]
  - 208/208 browser checks unchanged (zero client changes; live stack healthy on the released bundle)
  - no assertion weakened anywhere — coverage only grew
  - investigation live-probed the full supplier-side lifecycle first: all flows correct, all probe "failures" proven to be probe bugs (F-11-1/2/3 recorded as NOT A BUG — VERIFIED)
- **Important fixes:** P3 closed — the app's most intricate arithmetic (signed bill netting on Sundry Creditors) now has regression-level protection on the supplier side, matching the debtor-side rigor.
- **Immutable status:** 🔒 IMMUTABLE — `v1.11.0` is the current production baseline.

---

## v1.10.0

- **Commit:** `v1.10.0^{}` — resolve with `git rev-parse v1.10.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.10.0` (annotated; `v1.10.0^{}` = the release commit, verified at release)
- **Major purpose:** Voucher submission idempotency (R-10, B-10 P2) — duplicate submissions no longer double-post. Additive migration `0005` creates `idempotency_keys` (`UNIQUE(company_id, key)` → `voucher_id`, FKs cascade with company/voucher). `POST /vouchers` accepts an optional client key (body `idempotencyKey` or `X-Idempotency-Key` header, header wins, ≤200 chars): a replay returns the ORIGINAL voucher; the key row is written in the SAME transaction as the voucher insert; the unique index is the concurrency authority (the 23505 loser returns the winner's voucher, not 409, and falls through to the existing numbering-collision handling when the collision is the voucher-number index). Key is company-scoped via `cid()`; identity only from the verified JWT. Client (`VoucherScreen`): one UUID per new voucher form (stable across save attempts/retries; edit saves are PUT and carry no key) + `savingRef` single-shot guard covering the Ctrl+A hotkey path (the old `saving`-state disable only covered the button). No key = current behavior (fully backward compatible; manual-number race semantics unchanged).
- **Verification status:** VERIFIED AT RELEASE —
  - 813/813 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 531 (+12 dedicated R-10 checks: legacy no-key double POST unchanged, keyed replay → same voucher/number, header ≡ body key, different key → new voucher, 3 concurrent same-key → exactly one voucher, key company-scoped, replay-after-cancel returns the cancelled voucher faithfully, TB balanced / no silent dup), attack-the-fixes 29)
  - 208/208 browser checks (baseline 153 + R-03 UI 12 + R-04 UI 9 + R-05 UI 12 + R-07 UI 12 + R-10 UI 10 — double-Ctrl+A through the real UI posts exactly one voucher) on a fresh volume with migrations 0000→0005 (fresh-install verified)
  - typecheck (server + client) clean
  - accounting mathematics untouched: idempotency decides WHETHER a duplicate is written, never HOW anything calculates
- **Important fixes:** P2 closed — one double-accept no longer inflates AR/AP/stock/GSTR-1 figures (TB stays balanced, so nothing else would catch it).
- **Immutable status:** 🔒 IMMUTABLE — `v1.10.0` is the current production baseline.

---

## v1.9.0 ⚠ BREAKING

- **Commit:** `v1.9.0^{}` — resolve with `git rev-parse v1.9.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.9.0` (annotated; `v1.9.0^{}` = the release commit, verified at release)
- **Major purpose:** Fail-fast deployment secrets (R-09, B-08 P1 deploy-dependent) — **⚠ BREAKING: deployments relying on default secrets refuse to boot until env is set.** Three independent fallback layers eliminated: compose required interpolation (`JWT_SECRET`/`ADMIN_PASSWORD` `:?`), the auth plugin's in-process `?? "dev-secret"` (the server never refused to boot), and the first-boot seeding fallback `admin123`. The stateless `{uid,username}` JWT plus a public default meant token forgery = full authentication bypass; the app can no longer boot with a missing/empty/known-insecure `JWT_SECRET`, and first-boot admin seeding requires `ADMIN_PASSWORD` (existing-user deployments unaffected). `POSTGRES_PASSWORD` keeps its default (db publishes no ports — documented residual risk).
- **Verification status:** VERIFIED AT RELEASE —
  - 801/801 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 519 (+5 dedicated R-09 checks: missing secret refuses with guidance, `dev-secret` refuses, compose default refuses, strong secret boots, seeding precondition), attack-the-fixes 29)
  - 198/198 browser checks (baseline 153 + R-03 UI 12 + R-04 UI 9 + R-05 UI 12 + R-07 UI 12) on the rebuilt fail-fast stack (fresh volume, `.env` present)
  - compose negative test verified: without `.env`, compose refuses with the actionable guidance message
  - typecheck (server + client) clean; fresh Docker verified
  - no accounting surface touched, no client change, no migration; all seven suite spawn sites migrated to explicit secret fixtures
- **Important fixes:** P1 closed — the last known configuration path to full authentication bypass (public JWT default + stateless identity) is impossible: the server refuses to boot insecurely.
- **Upgrade instruction (≤ v1.8.0 → v1.9.0):** `cp .env.example .env`, set a strong `JWT_SECRET` and `ADMIN_PASSWORD`, then `docker compose up`.
- **Immutable status:** 🔒 IMMUTABLE — `v1.9.0` is the current production baseline.

## v1.8.0

- **Commit:** `v1.8.0^{}` — resolve with `git rev-parse v1.8.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.8.0` (annotated; `v1.8.0^{}` = the release commit, verified at release)
- **Major purpose:** Cross-company master-reference validation (R-08, B-07 P1, route-level fix — no migration). Central `assertCompanyRefs` hook in crud.ts: a declarative `opts.refs` spec verifies every provided FK id belongs to the caller's company on POST and PUT (wired: ledgers.`groupId`, stock-items.`unitId`/`groupId`/`categoryId`, pay-heads.`ledgerId`); salary-structure PUT validates every `headId` in-company; payroll processing belt-and-braces asserts every used pay-head's `ledgerId` belongs to the company — a legacy foreign-ledger row (accepted before R-08) now fails loudly at posting with a named-head 400 instead of silently unbalancing the books.
- **Verification status:** VERIFIED AT RELEASE —
  - 796/796 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 514 (+17 dedicated R-08 checks: foreign group/unit/stock-group refs → 400 on POST and PUT, in-company refs still 200, pay-head foreign ledger → 400, salary-structure semantics, psql-inserted legacy foreign-ledger row → payroll 400 "references a ledger outside this company", TB asserted balanced after the rejection), attack-the-fixes 29)
  - 198/198 browser checks (baseline 153 + R-03 UI 12 + R-04 UI 9 + R-05 UI 12 + R-07 UI 12) on the rebuilt bundle and a fresh volume; zero client changes (no new UI suite needed)
  - typecheck (server + client) clean
  - fresh Docker verified (fresh volume, healthchecks)
  - independent accounting reconciliation green — no accounting-mathematics change: validation decides *whether a reference may be written*, never *how anything calculates*; voucher-path validation trio untouched; R-03/R-06/R-07 behavior unchanged
  - no migration, no schema change; read paths unchanged so existing books keep working; DB-level composite-FK enforcement explicitly deferred (route-level validation closes every reachable path)
- **Important fixes:** P1 closed — the last known path to silently unbalanced books (pay-head → foreign ledger → payroll → entry invisible to both companies' reports, TB Dr=0/Cr=10,000, live-reproduced on v1.7.0) is impossible: the reference is rejected at creation, and any legacy row fails loudly at posting.
- **Immutable status:** 🔒 IMMUTABLE — `v1.8.0` is the current production baseline.

## v1.7.0

- **Commit:** `v1.7.0^{}` — resolve with `git rev-parse v1.7.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.7.0` (annotated; `v1.7.0^{}` = the release commit, verified at release)
- **Major purpose:** Opening balances in reports (R-07, B-02 re-verified: F-07-1 P1 + F-07-3 P2 fixed; F-07-2 documented per approved Model A). Party master openings now surface in Bills Receivable/Payable as a display-only synthetic "Opening Balance" bill dated books-begin (allocation sign convention: Debtors Dr +, Creditors Cr −; Against Ref settlement is a clean 400; on-account receipts net into the party total). Balance Sheet zeroing of Stock-in-Hand is structural — the group **and all descendants** (`descendantGroupIds()`), so SIH sub-group ledgers (Finished Goods, Raw Materials, …) can no longer double-count stock in assets. Independent engine `bills()` mirror aligned; PROJECT.md documents the opening-balance architecture and the manual opening-journal workflow for unfunded item openings (the honest "Difference in books" banner is designed behaviour).
- **Verification status:** VERIFIED AT RELEASE —
  - 779/779 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 497 (+16 dedicated R-07 checks: AR/AP openings incl. Cr-signed creditor, synthetic-bill shape, AR total, no-settlement 400, on-account netting 50k→40k, sub-group no-double-count, books-balance difference-0), attack-the-fixes 29)
  - 198/198 browser checks (baseline 153 + R-03 UI 12 + R-04 UI 9 + R-05 UI 12 + R-07 UI 12) on the rebuilt bundle and a fresh volume; new `r07_ui.js` covers the AR opening row visible/expandable in the real UI, AP −20,000 signed, BS banner absent before/after an unfunded sub-group ledger, zero page errors
  - typecheck (server + client) clean
  - fresh Docker verified (fresh volume, healthchecks)
  - independent accounting reconciliation green — no accounting-mathematics change: openings were already in TB/BS/closings; the reports now *show* the money they already carried. R-06 availability guard untouched (report-side only).
  - no migration, no schema change, no API surface change; client needed zero changes (OutstandingView renders bills generically)
- **Important fixes:** P1 closed — a migrated book's party balances were silently missing from the Outstanding reports whose purpose is collecting/paying that money (debtor opening 50,000 visible in TB, AR total 0). P2 closed — silent BS stock double-count through Stock-in-Hand sub-groups.
- **Immutable status:** 🔒 IMMUTABLE — `v1.7.0` is the current production baseline.

## v1.6.0

- **Commit:** `v1.6.0^{}` — resolve with `git rev-parse v1.6.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.6.0` (annotated; `v1.6.0^{}` = the release commit, verified at release)
- **Major purpose:** Negative-stock availability guard (R-06, B-01 P1) — **Model 1 approved: reject oversell, company-level opt-out.** Chain-comparison availability gate in `vouchers.ts`: movements replay chronologically (date, then voucher id; grandfathered negative states from the permissive era are tolerated as found), and a mutation is rejected **400** only when it turns a previously-valid step invalid — covering create, edit, cancel, uncancel, delete, and both XML import paths (no side doors). Physical Stock rows are absolute counts (opening folded once; PS replaces the running quantity; diff posted at running average). Additive migration `0004` adds `companies.allowNegativeStock` (default **false**); opted-in companies keep the permissive model but get **honest valuation** (`stock.ts` no longer clamps negative value to zero and caps WAVG unit cost at the item's latest purchase rate instead of charging 0 for phantom units). CompanySettings gains the Allow-Negative-Stock toggle.
- **Verification status:** VERIFIED AT RELEASE —
  - 763/763 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 481 (+21 dedicated R-06 checks: oversell 400, backdated legitimization, edit/cancel/uncancel/delete strand-rejection, import gate, opt-in honest valuation, chronological semantics), attack-the-fixes 29)
  - 186/186 browser checks (baseline 153 + R-03 UI 12 + R-04 UI 9 + R-05 UI 12) on the rebuilt bundle; pre-R-06 fixture companies opt in explicitly via `D.allowNegativeStock` (seeding helper, never a bypass of asserted guard behaviour)
  - typecheck (server + client) clean
  - fresh Docker verified (fresh volume, healthchecks, 0 error patterns in logs)
  - independent accounting reconciliation green — zero accounting-engine changes; the guard decides *whether a voucher may post*, never *how it posts*
  - migration is additive-only (one column, safe default, no destructive SQL); existing books without negative stock are unaffected, existing books with negative stock keep working via the opt-in flag
- **Important fixes:** P1 closed — overselling was accepted silently (phantom-unit WAVG cost), further sales posted zero COGS once stock went negative, and the next purchase averaged positive value onto a negative quantity, overstating P&L gross profit by the phantom margin (live-reproduced on v1.5.0). The posting path now refuses the first oversell instead of hiding it in the valuation.
- **Immutable status:** 🔒 IMMUTABLE — `v1.6.0` is the current production baseline.

---

## v1.5.0

- **Commit:** `v1.5.0^{}` — resolve with `git rev-parse v1.5.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.5.0` (annotated; `v1.5.0^{}` = the release commit, verified at release)
- **Major purpose:** Credit/debit-note GST reporting (R-05, B-06 P1) — `voucherGst()` aggregates with the books' natural signs instead of `Math.abs()` folding, so credit notes *subtract* from GSTR-1/3B output and debit notes *subtract* from ITC (previously both were counted as additional supplies, overstating tax); `gstr1()` returns real Table 9B **CDNR** (registered) and **CDNUR** (unregistered) sections with positive magnitudes plus `net*` totals (Table 9 net of 9B) that reconcile exactly with the ledgers; GSTR-1 UI gains the Net-supplies card and CDNR/CDNUR tables. Approved scope extension: **Apply-GST party balance** — the voucher-entry helper was doubly broken (sign-inverted duty-base selection meant duty rows were never inserted for Sales/Purchase and landed on the wrong side for CN/DN; the party row was never re-balanced, so Ctrl+A after Apply GST was always rejected); duty is now computed on the correct rows and pushed on the correct side for all four types, and the party row re-balances so the voucher saves immediately.
- **Verification status:** VERIFIED AT RELEASE —
  - 742/742 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 61 (+13 independent CN/DN scenario incl. cross-period negative-month net), final regression 460 (+43 R-05), attack-the-fixes 29)
  - 186/186 browser checks (baseline 153 + R-03 UI 12 + R-04 UI 9 + R-05 UI 12 incl. real Apply-GST save through the UI)
  - typecheck (server + client) clean
  - fresh Docker verified (fresh volume, healthchecks, 0 error patterns in logs)
  - independent accounting reconciliation green — zero accounting-engine changes; reports only; ledger identities asserted (GSTR-1 net − ITC == duty-ledger net credit)
  - no migration; no schema change; JWT untouched
- **Important fixes:** P1 closed — statutory reports no longer contradict the ledger by construction (live-reproduced on v1.4.0: 3B net 1,440 vs book truth 1,080). A real-user Sales → Apply GST → Ctrl+A flow saves for the first time.
- **Immutable status:** 🔒 IMMUTABLE — `v1.5.0` is the current production baseline.

---

## v1.4.0

- **Commit:** `v1.4.0^{}` — resolve with `git rev-parse v1.4.0^{}` (a release commit cannot contain its own SHA; the annotated tag is the permanent pointer)
- **Tag:** `v1.4.0` (annotated; `v1.4.0^{}` = the release commit, verified at release)
- **Major purpose:** XML import integrity (R-04: B-03 + B-05 + B-13 + B-14) — the entire import now runs in one transaction (any rejection rolls back masters + vouchers + allocations atomically); every imported voucher passes the same double-entry gate as the API (`validateEntries`, F-INV-01 for inventory types); bill allocations validated with the API's rules (name, non-zero, direction, must total the entry); failures answer 400 naming the offending voucher; imported-ledger GST `taxability` classified from ledger identity (duty heads stay non-taxable), making GSTR-1 internally consistent; client `api()` no longer forces `Content-Type: application/json` onto FormData — the import page's file-upload mode works for the first time (B-14).
- **Verification status:** VERIFIED AT RELEASE —
  - 686/686 automated checks (Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 48, final regression 417, attack-the-fixes 29)
  - 174/174 browser checks (baseline 153 + R-03 UI 12 + R-04 UI 9, incl. real file-upload import of balanced and unbalanced XML)
  - typecheck (server + client) clean
  - fresh Docker verified (fresh volume, healthchecks, 0 error patterns in logs)
  - independent accounting reconciliation green (no accounting formula changed — validation only rejects input that would corrupt books; previously-valid imports behave identically)
  - no migration; no schema change; JWT untouched
- **Important fixes:** P0 closed — the only path that could silently corrupt the ledger itself (unbalanced imported vouchers → permanently unbalanced Trial Balance, live-reproduced on v1.3.0 as TB 400/600) now cannot persist. Partial imports (previously committed piecemeal on mid-file failure) are now impossible.
- **Immutable status:** 🔒 IMMUTABLE — `v1.4.0` is the current production baseline.

---

## v1.3.0

- **Commit:** `38637c14f4e2eea4054385f9f006545b69c7a519`
- **Tag:** `v1.3.0` (annotated; tag object `b897dffdf44de47ac7e5d7419915c9f707c02755`; `v1.3.0^{}` = commit above)
- **Major purpose:** Company authorization and memberships (R-03) — Model C `user_companies` membership junction; authorization centralized in `cid()` (server-resolved per request, immediate revocation, 404 no-leak semantics); membership-filtered company list; atomic company + owner-membership creation; minimal owner-only member management (last-owner removal → 409); `vouchers.cancelled_by → users.id` FK (the FK R-02 deferred); stale-cid "Company not found" UI handling; additive migration `0003` with status-quo-preserving backfill.
- **Verification status:** VERIFIED AT RELEASE —
  - 821/821 automated checks (668 Python: smoke 39, adversarial 88, bug-fix 65, reconciliation 48, final regression 399, attack-the-fixes 29; + 165 browser)
  - 165/165 browser checks (baseline acceptance 153/153 + dedicated R-03 multi-user UI scenario 12/12)
  - fresh Docker verified (fresh volume, migrations auto-apply, healthchecks, clean logs)
  - upgrade verification (simulated v1.2.0 database → migration 0003 applies alone, data intact)
  - independent accounting reconciliation green (accounting mathematics untouched — authorization decides *who*, never *how*)
  - live multi-user security probe (cross-company 404s, immediate grant/revoke on the same JWT, last-owner 409)
- **Important fixes:** P1 authorization landmine closed — a second authenticated user could previously read/modify/delete/cancel any company's data. Authorization now requires server-verified membership on every request; unauthorized companies are indistinguishable from unknown.
- **Immutable status:** 🔒 IMMUTABLE — `v1.3.0` is the current production baseline.

---

## v1.2.0

- **Commit:** `5e5c09b702023827d2218ca25485cc565fb5dded`
- **Tag:** `v1.2.0` (annotated)
- **Major purpose:** Voucher cancellation (R-02) — Model A mark + exclude: cancel preserves the voucher row, number, entries, inventory and bills; no reversal entries; active reports exclude; uncancel restores exactly. Cancel/uncancel APIs (transactional, FOR UPDATE, company-scoped, clean 404/400/409); cancelled vouchers reject edit/delete (409); settled-bill guard; payroll hard-delete guard; Salary/Cheque Register cancellation fixes; Day Book cancelled badge + Uncancel; read-only VoucherScreen; additive migration `0002` (`cancelled_at/cancel_reason/cancelled_by`).
- **Verification status:** VERIFIED AT RELEASE — 790/790 automated checks (711 baseline + regression 283→368 + UI 140→153); fresh Docker; restart persistence; in-place upgrade from a simulated v1.1.1 database.
- **Important fixes:** cancellation was previously unreachable (no writers of `isCancelled`) — users had only hard-delete; the payroll hard-delete latent defect was closed in the same release.
- **Immutable status:** 🔒 IMMUTABLE.

---

## v1.1.1

- **Commit:** `2fcf50635b48180ca1108ef07954930e29238904`
- **Tag:** `v1.1.1` (annotated)
- **Major purpose:** GSTR-1 HSN reporting integrity (R-01) — population rule = `voucherTypes.name = "Sales"` (outward supply semantics, not inventory-quantity direction); purchases/receipt notes/delivery notes/stock journals no longer pollute HSN Table 12; HSN code/rate resolution snapshot → item-master → "-"; positive outward quantity enforced; ₹91,111 canary regression added.
- **Verification status:** VERIFIED AT RELEASE — 711/711 automated checks (final regression 224→283, UI 129→140 incl. cell-by-cell HSN reconciliation against the independent engine).
- **Important fixes:** HSN Table 12 reported wrong populations and NULL HSN/rate for UI-created vouchers.
- **Immutable status:** 🔒 IMMUTABLE.

---

## v1.1.0

- **Commit:** `fb73244d9b23223c94fc74612eb94ab5ed956b79`
- **Tag:** `v1.1.0` (annotated)
- **Major purpose:** feature/fix release (details recorded in `CHANGELOG.md`).
- **Verification status:** VERIFIED AT RELEASE — 622 checks green at release time.
- **Important fixes:** see `CHANGELOG.md` (historical record).
- **Immutable status:** 🔒 IMMUTABLE.

---

## v1.0.0

- **Commit:** `71e14fd3c8955975b580ee470b2fcb575ade5518`
- **Tag:** `v1.0.0` (annotated)
- **Major purpose:** initial production release — full accounting core (double-entry vouchers, numbering, masters, reports), inventory with WAVG/FIFO, GST reports, payroll/TDS, XML import, keyboard-first UI, Docker deployment.
- **Verification status:** VERIFIED AT RELEASE — 483 checks green at release time.
- **Important fixes:** n/a (initial).
- **Immutable status:** 🔒 IMMUTABLE.

---

## Ledger rules

1. A new release is **appended** at the top; nothing above it is ever edited.
2. A release requires the full `RELEASE_REVIEW` gate (`DEVELOPMENT_PROTOCOL.md`) — passing tests alone is not sufficient.
3. Every release = one release commit + one annotated tag, verified `tag^{}` == HEAD, clean tree, all prior tags unchanged.
4. Commit-message convention: `Release vX.Y.Z: <purpose>`; tag message: `zprime vX.Y.Z — <purpose>`.
