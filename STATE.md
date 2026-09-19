# zprime — Project State

**Last updated:** 2026-09-19 (R-29 EWB lifecycle ops IMPLEMENTED and fully verified — holding at RELEASE_REVIEW per protocol. Working tree contains the R-29 changes: migration 0013 additive `irp_ewb_ops` + `status='cancelled'`, `services/irp.ts` VEHEWB/EXTENDVALIDITY/CANEWB with eager pre-network guards, 3 cid-gated routes, GSTR-1 lifecycle actions + ewb-gen birth button, mock IRP lifecycle + self-keyed sidecar, +32 Python / +14 browser checks; 1118/1118 automated + 354/354 browser. v1.27.0 remains the last tagged release. See CHANGELOG.md, CONTINUE.md.)

## Product status

**RELEASE CANDIDATE** (adopted 2026-09-17 per READINESS_REVIEW.md — supersedes the production action plan's ALPHA verdict, which predated R-04…R-15). Production-ready for the designed model: self-hosted, single operator/small trusted team; internet-exposed acceptable with documented hardening. Not a multi-tenant SaaS.

## What zprime is

Self-hostable, keyboard-first Indian accounting application (Tally-style Gateway → Voucher → Report → Drill-down workflow, original UI). Fastify 5 + React 18 + PostgreSQL 16 + Drizzle ORM, single app container + Postgres via Docker Compose.

## Release status

**All six releases are tagged and immutable: v1.0.0 (483), v1.1.0 (622), v1.1.1 (711), v1.2.0 (790), v1.3.0 (821), and v1.4.0 (860 = 686 Python + 174 browser) — R-03 was released as v1.3.0, commit `38637c14f4e2eea4054385f9f006545b69c7a519`; R-04 (import integrity: B-03+B-05+B-13+B-14) was released as v1.4.0 — see RELEASES.md for the full ledger and commit SHAs. The working tree is clean at the v1.5.0 release commit; `R-05_INVESTIGATION.md` and the workflow docs are part of the release record. R-05 is committed and tagged. `ZLEDGER_PRODUCTION_ACTION_PLAN.md` remains intentionally untracked (historical audit input).**

### R-09 (P1 deploy-dependent confirmed → released as v1.9.0, 2026-09-16): fail-fast deployment secrets ⚠ BREAKING

Investigation (`R-09_INVESTIGATION.md`) source-traced B-08 on v1.8.0: three fallback layers booted the app with public secrets (compose `change-me-in-production`/`admin123`; auth.ts in-process `?? "dev-secret"` — the server never refused to boot; seeding `?? "admin123"`). Stateless `{uid,username}` JWT + a public default = **full authentication bypass by token forgery** on exposed deployments. scrypt verify verified correct (NOT A BUG).

Implemented per approved **full fail-fast (always enforced, no dev escape hatch)**: `auth.ts` refuses to boot on missing/empty/known-insecure `JWT_SECRET` with guidance; `index.ts` requires `ADMIN_PASSWORD` for first-boot seeding only; compose `:?` required interpolation (verified: without `.env`, compose fails with the actionable message); all seven suite spawn sites migrated to explicit fixtures; README rewritten (`.env` required + breaking-change callout). Regression: final_regression 514 → **519** (+5: missing/insecure secrets refuse with guidance, strong secret boots, seeding precondition); Python **801/801**; browser **198/198**; typecheck clean; fresh Docker with `.env` healthy; compose-without-`.env` correctly refused. No accounting surface, no client change, no migration.

### R-08 (P1 confirmed → released as v1.8.0, 2026-09-16): cross-company master-reference validation

Investigation (`R-08_INVESTIGATION.md`) live-reproduced B-07 on v1.7.0 with a proven corruption chain: crud.ts validated row ownership but never body FK refs (schema FKs global) — a pay-head in A referencing B's ledger was accepted, payroll posted a Dr against B's ledger invisible to BOTH companies' reports (ledgerBalances company-join-scoped) → A's TB **Dr=0/Cr=10,000 unbalanced silently**, BS difference 10,000. Also accepted: ledgers with B's group, items with B's unit/stock-group. Voucher-path validation trio verified correct (NOT A BUG — VERIFIED).

Implemented per approved **route-level scope (no migration)**: central `assertCompanyRefs` hook in crud.ts (`opts.refs` spec — wired ledgers.groupId, stock-items.unitId/groupId/categoryId, pay-heads.ledgerId); salary-structure headId in-company check; payroll belt-and-braces asserts every used head's ledgerId at posting (legacy foreign row fails loudly with named-head 400, TB asserted balanced). Regression: final_regression 497 → **514** (+17 R-08 checks incl. psql-inserted legacy row → payroll 400); Python **796/796**; browser **198/198**; typecheck clean; fresh Docker healthy. No accounting-mathematics change, no client change, no migration.

### R-07 (P1 + P2 confirmed → released as v1.7.0, 2026-09-16): opening balances in reports

Investigation (`R-07_INVESTIGATION.md`) live-reproduced B-02 on v1.6.0 and re-graded it: **F-07-1 (P1)** — party master openings never reached Bills Receivable/Payable (`billWiseOutstanding()` reads only bill allocations; debtor opening 50,000 in TB, AR total 0); **F-07-3 (P2)** — BS zeroed Stock-in-Hand ledgers by exact group *name*, so SIH sub-group ledgers (Finished Goods…) double-counted stock in assets; **F-07-2 (P2, re-graded from the plan's P0)** — unfunded item openings surface as the honest BS "Difference in books" banner (design limitation, not silent corruption); **F-07-4** — openings never contaminate P&L movement (NOT A BUG — VERIFIED).

Implemented per approved scope (**F-07-1 + F-07-3; F-07-2 = Model A document-only**): party openings merge into Outstanding reports as a display-only synthetic "Opening Balance" bill dated books-begin (A-05 on-account precedent; Against Ref settlement is a clean 400; on-account receipts net into the party total); `balanceSheet()` zeroes the Stock-in-Hand group **and all descendants** structurally (`descendantGroupIds()`); independent engine `bills()` mirror aligned; PROJECT.md documents the opening-balance architecture and the manual opening-journal workflow. Regression: final_regression 481 → **497** (+16 R-07 checks incl. sign-mirrored AP case and no-settlement guard); Python **779/779**; browser **198/198** (153+12+9+12+12, new `r07_ui.js`); typecheck clean; fresh Docker healthy. No accounting-mathematics change: openings were already in TB/BS/closings; reports now *show* the money they already carried.

### R-06 (P1 confirmed → released as v1.6.0, 2026-09-16): negative-stock availability guard

Phase-1 investigation live-reproduced B-01 on v1.5.0: overselling was accepted silently (sale 15 against stock 10 → HTTP 200, WAVG charged for 5 phantom units); with stock already negative, further sales posted **zero COGS**; the next purchase averaged positive value onto negative quantity (qty −2, value +1,000) and overstated P&L gross profit by the phantom margin. `stock.ts` compounded it (WAVG cost → 0 at qty ≤ 0; hardcoded clamp zeroing negative runningValue). No persisted corruption (valuation recomputes per call; double-entry stayed balanced) — P1, not P0.

Implemented per **approved Model 1 (reject oversell + company opt-out)**: chain-comparison availability guard in `vouchers.ts` — chronological replay (date, then voucher id; grandfathered negatives tolerated as found), mutation rejected **400** only when it turns a previously-valid step invalid; covers create/edit/cancel/uncancel/delete and both XML import paths (no side doors). Physical Stock rows are absolute counts (opening folded once; PS replaces running qty; diff at running avg). Additive migration `0004` adds `companies.allowNegativeStock` (default false) per the hand-crafted snapshot/journal convention; opted-in companies get **honest valuation** (no clamp; WAVG capped at latest purchase rate). UI: CompanySettings toggle. Fixtures that legitimately oversell opt in explicitly via `D.allowNegativeStock` (seeding only — guard coverage lives in the +21 dedicated R-06 checks). Regression: final_regression 460 → **481**; Python **763/763**; browser **186/186** (153+12+9+12) incl. the availability-banner path; typecheck clean; fresh Docker healthy. Accounting mathematics untouched — the guard decides *whether a voucher may post*, never *how it posts*.

### R-05 (P1 confirmed → released as v1.5.0, 2026-09-15): CN/DN GST reporting + Apply-GST party balance

Investigation live-reproduced B-06 on v1.4.0: `voucherGst()` folded rows with `Math.abs()`, erasing the reversal sign notes carry in the books — a CN *added* to GSTR-1 output tax and a DN *added* to ITC (3B net 1,440 vs book truth 1,080), and `gstr1()` hardcoded `cdnr: []`. Books were always right; statutory reports contradicted them. Fixed in `gst.ts` with direction-aware signed aggregation (per-voucher; sales positive, notes negative), real CDNR/CDNUR sections with positive magnitudes, and `net*` totals reconciling exactly to the ledgers; Reports.tsx shows the net card + note tables. Approved scope extension: VoucherScreen Apply-GST was doubly broken (sign-inverted taxable-base filter — duty never inserted for Sales/Purchase — and no party-row rebalance, so save was always rejected); fixed with a per-type base-sign map and party rebalance. Engine mirrors re-aligned from the old no-netting semantics (disclosed; assertion strength kept exact). Python 742/742 (final_regression 460, reconcile 61), browser 186/186 (153+12+9+12), fresh Docker clean.

### R-03 (P1 confirmed vulnerability → implemented 2026-09-13): user→company authorization

Phase-1 investigation proved authentication existed (JWT `{uid, username}`, httpOnly cookie) but **no user→company authorization boundary anywhere**: `cid()` checked only company *existence*, `GET /companies` returned the whole table, and a second authenticated user could read/modify/delete/cancel any company's data (live-proven, T1–T6). Safe only while deployments were single-user by convention.

Implemented as **Model C — membership junction** (approved architecture): additive migration `0003` creates `user_companies` (`user_id` FK users, `company_id` FK companies, `role` metadata `owner|accountant`, unique pair, both-direction indexes) and adds `vouchers.cancelled_by → users.id ON DELETE SET NULL` (the FK deferred by R-02). **Backfill:** every existing user × every existing company gets an owner membership — exactly the pre-R-03 effective access model, so no existing deployment loses access; deterministic, status-quo-preserving, no destructive SQL.

**Authorization is centralized inside `cid()`** (server/src/lib/routes.ts): every `/api/c/:cid/*` route now requires the authenticated user to hold a membership row, resolved **server-side on every request** — revocation is immediate, no re-login, and the JWT structure is unchanged (no companyId in the token). Unauthorized companies answer **404**, indistinguishable from unknown — no existence leak. Existing same-company resource→company validation is unchanged and remains defense-in-depth. Company routes are membership-scoped: `GET /companies` returns only member companies, `GET/PUT /companies/:id` gated 404, `POST /companies` atomically creates company + seed + owner membership. Minimal **owner-only** member management (`GET/POST/DELETE /companies/:id/members`, last-owner removal → 409); no invitations/email/SSO/full RBAC — explicitly out of scope.

Frontend: company list automatically filtered server-side; a stale/revoked `/company/:cid` URL renders a neutral "Company not found" notice with a recovery link (no authorization-state disclosure).

Regression: final_regression 368 → **399** (+31 R-03 checks: directory scoping, cross-company 404s across vouchers/masters/reports/GST/import, member-vs-owner rights, immediate revocation, last-owner guards, `cancelled_by` = cancelling user). Real-browser: existing **153/153** + dedicated **12/12** R-03 UI scenario (login-as-B isolation, direct Alpha navigation → neutral 404, grant → immediate access, revoke → immediate loss without re-login). **821/821 total.** Accounting mathematics untouched — authorization decides *who*, never *how*. Docker verified on a fresh volume and as an upgrade from a simulated v1.2.0 database (0003 applies alone, journal 3 → 4, data intact).

### R-02 (P1 missing feature → released as v1.2.0, 2026-09-13): voucher cancellation

Investigation (Phase 1) proved `vouchers.isCancelled` existed with full read-side exclusion in every accounting/inventory/GST/bill query, but **zero writers** — cancellation was unreachable and users had only hard-delete. Implemented as **Model A (mark + exclude)**: cancel preserves the voucher row, number, entries, inventory and bills; no reversal entries are ever created; active reports exclude the voucher while cancelled. New additive migration `0002` (`cancelled_at`/`cancel_reason`/`cancelled_by`, nullable), `POST /vouchers/:id/cancel` + `/uncancel` (transactional, FOR UPDATE, company-scoped, clean 404/400/409), PUT/DELETE reject cancelled vouchers (409), shared settled-bill guard, payroll hard-delete guard (protects processed months), Salary Register + Cheque Register cancellation fixes (the two read-side gaps), Day Book badge/Uncancel/read-only VoucherScreen banner. Numbering never rewinds. Regression: final_regression 283 → 368; independent engine treats cancelled = inactive; UI acceptance 140 → 153 (real-browser cancel/uncancel with engine-expected report deltas and exact post-uncancel restoration). **790/790 total.** Docker verified: fresh volume, restart persistence, and in-place upgrade from a simulated v1.1.1 database (0002 applies alone, data intact).

### R-01 (P1, fixed 2026-09-12): GSTR-1 HSN outward-supply reporting

The HSN summary used inventory quantity direction instead of outward voucher semantics — purchases/receipt notes polluted Table 12, sales were excluded, and HSN/rate read NULL snapshot columns for UI-created vouchers (`hsn="-"`, `rate=0`). Fixed in `server/src/services/gst.ts` `gstr1()` only: population = `voucherTypes.name = "Sales"` (same rule as `voucherGst(..., "outward")`), snapshot → stock-item-master fallback for HSN/rate, positive outward qty. Credit Notes stay out of Table 12 (CDNR remains a known gap). Regression: final_regression 224 → 283 (incl. the ₹91,111 canary); independent engine `hsnMonth` now reconciled cell-by-cell in the browser acceptance (129 → 140). **711/711 total.**

### Verification record (exact commands)

Run against `zprime-test-pg` (PostgreSQL 16 in Docker, port 55432), fresh schema per suite:

```bash
export DATABASE_URL="postgres://zprime:zprime@localhost:55432/zprime"

npm run typecheck                                   # server + client, clean

python3 scripts/smoke_test.py        # 39/39 passed
python3 scripts/attack_test.py       # 88/88 passed  (adversarial)
python3 scripts/fix_regression.py    # 65/65 passed  (BUG-001..009 regression)
python3 scripts/reconcile.py         # 48/48 passed  (independent reconciliation)
python3 scripts/final_regression.py  # 399/399 passed (F-INV-01 + O-1 + R-02 + R-03)
python3 scripts/attack2.py           # 29/29 passed  (attack-the-fixes)

node scripts/acceptance/run.js       # 153/153 passed (real-browser UI acceptance,
                                     #  run from repo root; needs Chromium at
                                     #  ~/.local/bin/chromium or CHROME_PATH;
                                     #  client/dist must be built: npm run build -w client)
node scripts/acceptance/r03_ui.js    # 12/12 passed  (R-03 multi-user browser scenario,
                                     #  same prerequisites; test users created via API)

docker compose down -v && docker compose build && docker compose up -d
# → healthy, migrations auto-apply on empty volume,
#   endpoints verified in-container, restart preserves data
```

Total: **821 checks + typecheck + Docker verification, 0 failures** (was 790 at v1.2.0; +31 R-03 API regression, +12 R-03 UI scenario; none removed or weakened).

### Independent reconciliation

`scripts/acceptance/engine.py` (pure Python, no shared code/queries with zprime) mirrors three months of a fictional trading business (Meridian Traders, Apr–Jun FY 2026-27) entered entirely through the real UI, and reconciles to the paisa: TB, BS, P&L (cumulative + monthly), FIFO stock, bills receivable/payable, GSTR-1, GSTR-3B, TDS, cash/bank, salary register.

## Known non-blocking issues (open, NOT fixed)

**None open.** Post-v1.1.1 status — R-02 is implemented and verified (see above); R-01 and both prior items are closed:

- **R-02 (P1) — IMPLEMENTED (2026-09-13), verification complete:** voucher cancellation via Model A (mark + exclude). See release-status section above for the full record. Known limitations (by design, deferred): `cancelled_by` stores a plain user id without FK (R-03 ownership work will formalize it); no full audit-trail table; no period lock; CDNR/CDNUR/GSTR-9/RCM GST gaps remain GST-work, untouched by R-02.

- **F-INV-01 (P3) — CLOSED (2026-09-12), FIXED:** inventory-only Stock Journal and Physical Stock are enterable through the real UI. `entries: []` is valid only for inventory-category vouchers carrying ≥1 real stock movement (item + non-zero qty); accounting-only vouchers still require balanced non-zero ledger entries; negative Physical-Stock counted quantities are rejected; no artificial accounting entries are created. Verified by new regression/attack checks, real-browser UI scenarios, and an in-container Docker probe.
- **O-1 (P4) — CLOSED (2026-09-12), NOT REPRODUCIBLE:** Phase 1 investigation proved Cash/Bank period semantics correct (Opening ≤ from−1, Movement [from,to], Closing = Opening + Dr − Cr, future vouchers excluded); code is character-identical to v1.0.0; controlled reproduction failed. Root cause of the observation: a test-coverage gap (all prior windows were FY→month-end). Remediation was test-only — 92 API-level sub-period/boundary/edit/backdate/delete checks, an independent engine `cashBankSub` snapshot, and the `jun/cb-subperiod` real-browser scenario with a future-contamination canary. **No production Cash/Bank logic was modified.**

## Architecture map

- `server/src/index.ts` — bootstrap: migrations on boot, admin seed, error sanitizer, static client.
- `server/src/routes/` — auth, companies, masters (crud factory + beforeSave hooks), vouchers (numbering, bill allocation, GST posting), reports, payroll, import (XML), banking.
- `server/src/services/` — `accounting.ts` (TB/BS/P&L/parties/stock), `gst.ts` (GSTR-1/3B, voucherGst — duty heads authoritative, `supplyMismatch` flag).
- `server/src/db/` — drizzle schema + migrations in `server/drizzle/` (auto-applied on boot).
- `client/src/pages/` — DayBook, VoucherScreen (keyboard-first, F4–F9/Alt+F-keys), Reports, MasterPage, Payroll, Import.
- `scripts/` — QA suites (python, self-hosting servers on ports 3100–3106) + `acceptance/` (Playwright rig + expectation engine).
- `docker-compose.yml` — app + postgres:16-alpine, named volume, healthcheck.

## Invariants that must never regress

1. Dr = Cr everywhere; BS balanced with no difference banner.
2. GST booked in the ledger must always appear in GSTR-1/3B (duty heads authoritative — see A-07 fix; the ₹1,215 case is a permanent regression test in `scripts/final_regression.py`).
3. Voucher numbering atomic (DB counter + unique index); deletion never enables reuse.
4. Bill allocation: same company, correct party, amount ≤ open bill; `(party ledger, bill name)` unique per company (A-02).
5. Payroll: deductions non-negative; payslip net = gross − deductions.
6. Company isolation on every route via `cid(req)`; no client-supplied companyId trusted.
7. Sub-period P&L = period movements; FY view = cumulative (A-06).

## Test-rig notes

- Suites start their own server (ports 3100–3106) against `zprime-test-pg`; do not run two suites concurrently.
- Acceptance rig: run `node scripts/acceptance/run.js` from the **repo root**; artifacts (`state.json`, `expected.json`, `run.log`, `shots/`) are git-ignored and regenerable.
- Playwright core uses the locally installed Chromium (`~/.local/bin/chromium`), override with `CHROME_PATH`.
