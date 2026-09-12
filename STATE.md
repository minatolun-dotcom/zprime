# zprime — Project State

**Last updated:** 2026-09-12 (v1.1.0 released: F-INV-01 fixed, O-1 closed as NOT REPRODUCIBLE, 622 checks green)

## What zprime is

Self-hostable, keyboard-first Indian accounting application (Tally-style Gateway → Voucher → Report → Drill-down workflow, original UI). Fastify 5 + React 18 + PostgreSQL 16 + Drizzle ORM, single app container + Postgres via Docker Compose.

## Release status

**v1.0.0 remains tagged and untouched (483 checks). v1.1.0 is the current release: F-INV-01 fixed; O-1 closed as NOT REPRODUCIBLE (app correct, coverage added). 622/622 checks — zero failures.**

### Verification record (exact commands)

Run against `zprime-test-pg` (PostgreSQL 16 in Docker, port 55432), fresh schema per suite:

```bash
export DATABASE_URL="postgres://zprime:zprime@localhost:55432/zprime"

npm run typecheck                                   # server + client, clean

python3 scripts/smoke_test.py        # 39/39 passed
python3 scripts/attack_test.py       # 88/88 passed  (adversarial)
python3 scripts/fix_regression.py    # 65/65 passed  (BUG-001..009 regression)
python3 scripts/reconcile.py         # 48/48 passed  (independent reconciliation)
python3 scripts/final_regression.py  # 224/224 passed (F-INV-01 + O-1 sub-period + fix attacks)
python3 scripts/attack2.py           # 29/29 passed  (attack-the-fixes)

node scripts/acceptance/run.js       # 129/129 passed (real-browser UI acceptance,
                                     #  run from repo root; needs Chromium at
                                     #  ~/.local/bin/chromium or CHROME_PATH;
                                     #  client/dist must be built: npm run build -w client)

docker compose down -v && docker compose build && docker compose up -d
# → healthy, migrations auto-apply on empty volume,
#   endpoints verified in-container, restart preserves data
```

Total: **622 checks + typecheck + Docker verification, 0 failures** (was 483 at v1.0.0; +35 F-INV-01, +104 O-1 API-level, +12 O-1 UI, +12 F-INV-01 rig; none removed or weakened).

### Independent reconciliation

`scripts/acceptance/engine.py` (pure Python, no shared code/queries with zprime) mirrors three months of a fictional trading business (Meridian Traders, Apr–Jun FY 2026-27) entered entirely through the real UI, and reconciles to the paisa: TB, BS, P&L (cumulative + monthly), FIFO stock, bills receivable/payable, GSTR-1, GSTR-3B, TDS, cash/bank, salary register.

## Known non-blocking issues (open, NOT fixed)

**None open.** v1.1.0 status — both prior items are closed:

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
