# zprime

A self-hostable, keyboard-first accounting app for local usage — modern web UI with a classic accounting workflow: Gateway home screen, function-key driven voucher entry, and drill-down reports.

**Stack:** Node 22 · Fastify · React (Vite + Tailwind) · PostgreSQL · Docker

## Quick start

```bash
cp .env.example .env      # optional: adjust passwords/secret
docker compose up -d
# open http://localhost:3000 — login: admin / admin123
```

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

All data lives in the `pgdata` Docker volume. Backup: `docker compose exec db pg_dump -U zprime zprime > backup.sql`. Restore: `cat backup.sql | docker compose exec -T db psql -U zprime zprime`.

## Notes & limits

- GST reports are management summaries (not e-filing JSON); TDS is deduction/payable tracking without challan e-file formats.
- Serving the UI + API is single-container (`app`) + `db`. Change `JWT_SECRET` and `ADMIN_PASSWORD` before exposing beyond localhost.
