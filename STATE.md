# zprime — Project State

**Last updated:** 2026-09-13 (post-v1.2.0: R-03 user→company authorization implemented and verified, 821 checks green, unreleased)

## What zprime is

Self-hostable, keyboard-first Indian accounting application (Tally-style Gateway → Voucher → Report → Drill-down workflow, original UI). Fastify 5 + React 18 + PostgreSQL 16 + Drizzle ORM, single app container + Postgres via Docker Compose.

## Release status

**v1.0.0 (483), v1.1.0 (622), v1.1.1 (711) and v1.2.0 (790) remain tagged and untouched. Post-v1.2.0 R-03 user→company authorization is implemented and fully verified (821/821) but NOT yet committed or tagged; the working tree carries the R-03 changes on top of v1.2.0.**

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
