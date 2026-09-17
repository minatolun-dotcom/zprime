# zprime

A self-hostable, keyboard-first accounting app for local usage — modern web UI with a classic accounting workflow: Gateway home screen, function-key driven voucher entry, and drill-down reports.

**Stack:** Node 22 · Fastify · React (Vite + Tailwind) · PostgreSQL · Docker

## Quick start

```bash
cp .env.example .env      # REQUIRED since v1.9.0 — set JWT_SECRET and ADMIN_PASSWORD
docker compose up -d
# open http://localhost:3000 — login with the ADMIN_USER/ADMIN_PASSWORD you set
```

> **Breaking change (v1.9.0):** the server refuses to boot with a missing or
> known-insecure `JWT_SECRET` (the old defaults allowed token forgery = full
> authentication bypass), and first-boot admin seeding requires `ADMIN_PASSWORD`.
> Compose also fails fast via required interpolation. Existing deployments
> upgrading from ≤ v1.8.0: create `.env` before `docker compose up`.
> If the admin user already exists, `ADMIN_PASSWORD` only matters for fresh volumes.

Both containers use `restart: unless-stopped`, so the stack survives host
reboots and self-heals a first-boot race (on a brand-new volume the database
healthcheck can pass transiently during `initdb`; the app then restarts and
migrates cleanly instead of staying dead).

## Features

**Accounting**
- Multi-company, Indian financial year (1 Apr – 31 Mar), ₹ Indian number format
- 28 pre-defined account groups + unlimited custom groups & ledgers (GSTIN, taxability, bill-wise, bank, TDS)
- All accounting vouchers: Contra (F4), Payment (F5), Receipt (F6), Journal (F7), Sales (F8), Purchase (F9), Credit Note (Alt+F6), Debit Note (Alt+F5)
- Double-entry validation, automatic voucher numbering with prefix/suffix
- Narration, cheque numbers, bill references (New Ref / Against Ref / Advance / On Account)

**Inventory**
- Stock items, units, stock groups/categories, godowns
- Sales/Purchase, Delivery/Receipt Notes, Stock Journal, Physical Stock, Manufacturing Journal
- Weighted-average or FIFO costing, opening stock, reorder flag

**Reports** (all with period picker, Alt+F1 detailed/condensed, CSV export, drill-down)
- Balance Sheet, Profit & Loss, Trial Balance, Day Book
- Ledger Vouchers (running balance), Group Summary, Cash/Bank Book
- Sales/Purchase Registers, Stock Summary, Bills Receivable/Payable
- GSTR-1 (B2B, B2C, HSN summary), GSTR-3B (outward, ITC, net payable)
- TDS report (by section), Salary Register, Cheque Register

**Payroll & TDS**
- Employees, pay heads (earning/deduction → any ledger), salary structures
- One-click monthly payroll processing → Payroll voucher + payslips
- TDS sections (194C etc.); "Deduct TDS" helper on vouchers; TDS payable report

**Utilities**
- **XML import** — masters (groups/ledgers/stock items/units/godowns) + vouchers (all types, bill refs, GSTIN) from standard accounting XML exports; duplicates skipped
- Cheque printing (printable cheque face with amount in words)
- Company settings, simple JWT login

**Keyboard workflow**
`F2` date · `F5/F8/F9` quick vouchers · `Ctrl+A` accept/save · `Alt+F1` detailed/condensed · `Esc` back · Enter adds a new entry row · type-ahead ledger & item search

## Development

```bash
npm install
# terminal 1 (needs a Postgres; use docker compose up db, or any):
DATABASE_URL=postgres://zprime:zprime@localhost:5432/zprime npm run dev:server
# terminal 2:
npm run dev:client        # http://localhost:5173, proxies /api to :3000
```

Schema changes: edit `server/src/db/schema.ts` → `npm run db:generate` → restart server (migrations auto-apply on boot).

## Tests

```bash
# needs a throwaway Postgres named zprime-test-pg on port 55432:
docker run -d --name zprime-test-pg -e POSTGRES_USER=zprime -e POSTGRES_PASSWORD=zprime \
  -e POSTGRES_DB=zprime -p 55432:5432 postgres:16-alpine
python3 scripts/smoke_test.py    # 39 end-to-end checks: vouchers, reports, GST, payroll, XML import
```

## Data & backups

All data lives in one Postgres database inside the `pgdata` Docker volume. The verified backup path is plain `pg_dump` (no product UI needed for a single-operator deployment):

```bash
# Backup
docker compose exec db pg_dump -U zprime zprime > backup.sql
```

**Restore** (the database must be empty or recreated — restoring over an existing schema fails on `CREATE TABLE` collisions):

```bash
docker compose stop app          # 1. stop the app so nothing writes during restore
docker compose exec db psql -U zprime -d postgres -c "DROP DATABASE zprime;"
docker compose exec db psql -U zprime -d postgres -c "CREATE DATABASE zprime;"
cat backup.sql | docker compose exec -T db psql -U zprime zprime   # 2. restore
docker compose start app         # 3. start the app
```

**Verify after restore:** open the app and spot-check a report (e.g. Trial Balance), or compare row counts:

```bash
docker compose exec db psql -U zprime -d zprime -tAc "SELECT count(*) FROM vouchers; SELECT count(*) FROM companies;"
```

This exact round-trip is regression-guarded by the test suite (`R-12` block in `scripts/final_regression.py`), so schema changes that would break a plain-SQL restore are caught before release.

**Whole-volume alternative:** to snapshot everything (including volume metadata), stop the stack and copy the named volume, e.g. `docker run --rm -v zprime_pgdata:/data -v $(pwd):/backup alpine tar czf /backup/pgdata.tgz -C /data .` — restore by reversing the copy into a fresh volume. Prefer `pg_dump` for version-safe, human-readable backups.

## Notes & limits

- GST reports are management summaries (not e-filing JSON); TDS is deduction/payable tracking without challan e-file formats.
- Serving the UI + API is single-container (`app`) + `db`. `JWT_SECRET` and `ADMIN_PASSWORD` are **required** (fail-fast at boot since v1.9.0); `POSTGRES_PASSWORD` still defaults to `zprime` — acceptable because the `db` service publishes no ports, but change it if you expose Postgres.
- **Login throttling (since v1.13.0):** 10 failed logins in 10 minutes for the same source IP + username lock that pair for the remainder of the window (`429 Too Many Login Attempts` with `Retry-After`); a successful login resets it. Legitimate users are never affected unless they repeatedly mistype. State is in-memory (resets on restart) and single-process by design — this is defense-in-depth, not a substitute for network controls. On an internet-exposed deployment, also put the app behind a reverse proxy with HTTPS and consider additional rate limiting at the proxy layer.
- Login responses are timing-equalized between unknown users and wrong passwords, so response latency does not reveal whether a username exists.
