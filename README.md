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

**Reports** (all with period picker, Alt+F1 detailed/condensed, drill-down, **Export CSV + Print** on every view — R-66)
- Balance Sheet, Profit & Loss, Trial Balance, Day Book
- Ledger Vouchers (running balance), Group Summary, Cash/Bank Book
- **Chart of Accounts** — every group and ledger in one expandable tree with period balances, type-to-filter (Alt+O)
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
- **Invoice printing** — Sales and Delivery Note vouchers (alter mode) render a GST-ready invoice face with the party's master details and amount in words; report pages print clean via a print stylesheet (chrome and buttons hidden)
- Company settings, simple JWT login
- **Company users** — the company creator adds/removes users and resets passwords in Company Settings → Users; every user has full access to the company (no permission levels, Tally-style)

**Keyboard workflow (TallyPrime parity — R-54)**

| Key | Action |
|---|---|
| `F2` | Date / period (voucher date, Day Book + report date inputs) |
| `F4` `F5` `F6` `F7` `F8` `F9` | Contra · Payment · Receipt · Journal · Sales · Purchase — from any screen (suppressed while a voucher is open in the editor — Esc first) |
| `F10` | Manufacturing Journal — from any screen (same editor suppression) |
| `Alt+F1`…`Alt+F9` | Aliases of Alt+F1…F9 (also reachable as `Alt+1`…`Alt+9`) — Debit/Credit Note, Stock/Delivery/Receipt Note |
| `Alt+F5`…`Alt+F9`, `Ctrl+F7` | Debit Note · Credit Note · Stock Journal · Delivery Note · Receipt Note · Physical Stock |
| `Ctrl+A` | Accept / save voucher (accepts the on-the-fly ledger modal too) |
| `Alt+J` | Apply GST on Sales/Purchase/CN/DN (Tally's statutory-adjustment slot) |
| `Alt+C` | Create ledger on the fly |
| `Alt+D` / `Alt+X` | Delete / cancel the open voucher (edit mode, confirm-guarded) |
| `Alt+G` | **Go To** — type-to-filter jump to any report, master, voucher or utility |
| `Alt+S` | Company Settings (Tally's Stock-Query chord, unused here) — from any screen |
| `Alt+O` | Chart of Accounts explorer — every group & ledger, one tree |
| `F3` | Change company (company select) |
| `+` / `-` | Next / previous report day (period length kept) |
| `Alt+F1` | Detailed / condensed report view |
| `Esc` | Back the way you came; closes modals; the Gateway is the last stop |
| (chip) | A few chips are click-only conveniences, not keyboard keys — e.g. the voucher screen's `F12` Ref/Party chip (F12 is browser-reserved in tab view). Everything listed in the table above fires from the physical keyboard. |
| `Enter` | Drill down / add entry row · type-ahead ledger & item search |

The Gateway carries Tally-style menu mnemonics (`C` `A` `V` `K` `R` `U` in the operator's order — Create, Alter, Vouchers, Day Book first — plus per-item letters/digits and the `Alt+S` settings chord; zprime's own layer — official TallyPrime documents no such global table). The Vouchers pane lists types by shortcut class: plain F-keys first (F4…F10), then Alt+ chords, then Ctrl+. Keys a browser consumes before the page (`F1` `F11` `F12`, `Ctrl+N/W/P/S`, `Alt+F4`) are avoided or need app-window mode — see **Shortcut keys & the browser** below.

**Shortcut keys & the browser (R-51)**
In a normal browser **tab**, some chords are reserved by the browser itself and never reach the page — notably `F5` (reload in some browsers), `F6` (address bar), `F11/F12` (fullscreen/DevTools), `Alt+1–9` (Firefox tab switch) and `Alt`-letter menu access (Firefox/Linux). zprime intercepts everything the browser forwards, but it cannot intercept what the browser consumes first.

For the **full keyboard**, run zprime in an app/standalone window (it ships as an installable PWA):

- **HTTPS or localhost deployments** — install directly: Chrome/Edge → menu ⋮ → **Install app**; Firefox → address-bar install icon. A standalone window has no tab strip, address bar or menu bar, so every advertised key behaves as labelled.
- **Plain-HTTP LAN-IP deployments** (`http://<ip>:<port>`) — browsers only offer PWA install on secure origins, so use the app-window shortcut instead: Chrome/Edge → ⋮ → **Cast, save and share → Create shortcut… → Open as window** (or launch `chrome --app=http://<ip>:<port>`). Same standalone effect, no HTTPS required.

`F11` (fullscreen) and `F12` (DevTools) remain reserved at the OS/browser level in every context — they are not used by the voucher vocabulary. The Gateway Shortcuts card carries the same reminder.

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

This exact round-trip is regression-guarded by the test suite (`R-12` block in `scripts/final_regression.py`) — and since R-39 that guard compares **content, not just row counts**: postings-bearing tables (`vouchers`, `voucher_entries`, `ledgers`, `bill_allocations`, `inventory_entries`, `stock_items`, `payslips`, `pay_heads`, `companies`, `user_companies`, `users`) are hash-compared row-for-row between the live and restored databases, and the restored schema must be byte-identical to the live one. Schema or data drift that would break a plain-SQL restore is caught before release.

**Schedule backups (host cron):** the runbook assumes a human runs the dump — automate it on the Docker host so it actually happens:

```cron
# /etc/cron.d/zprime-backup — daily 02:30, keep 14 days
30 2 * * * root cd /srv/zprime && docker compose exec db pg_dump -U zprime zprime > /var/backups/zprime/$(date +\%F).sql && find /var/backups/zprime -name '*.sql' -mtime +14 -delete
```

(Create `/var/backups/zprime` first; adjust the app directory to where your `docker-compose.yml` lives. Copy that file off the host — a backup on the same disk as the database is not a backup.)

**Drill the restore:** a backup that has never been restored is a hope, not a backup. The suite proves the *path* works on every release; only a drill proves *your* backup file restores. Quarterly (and after any restore-relevant change: Postgres major version, disk migration), restore the latest real backup file into a scratch database and spot-check a report before you ever need it in anger:

```bash
docker compose exec db psql -U zprime -d postgres -c "CREATE DATABASE r39_drill;"
cat /var/backups/zprime/2026-09-21.sql | docker compose exec -T db psql -U zprime -d r39_drill -v ON_ERROR_STOP=1
docker compose exec db psql -U zprime -d r39_drill -tAc "SELECT count(*) FROM vouchers"
docker compose exec db psql -U zprime -d postgres -c "DROP DATABASE r39_drill;"
```

**Whole-volume alternative:** to snapshot everything (including volume metadata), stop the stack and copy the named volume, e.g. `docker run --rm -v zprime_pgdata:/data -v $(pwd):/backup alpine tar czf /backup/pgdata.tgz -C /data .` — restore by reversing the copy into a fresh volume. Prefer `pg_dump` for version-safe, human-readable backups.

## New Financial Year (Tally's recommended path)

Tally's guidance for crossing 31 March is: **do not** create a new company or
fiddle with year settings — keep the same company and **change the current
period**. zprime follows the same model (R-56):

- **Nothing to migrate.** All reports are period-parametric and openings are
  computed from full history, so last year's vouchers remain reachable at any
  time and balances carry forward automatically.
- **Company settings stay fixed.** *Financial Year Begins* and *Books Begin
  From* (Company → Alter) describe the company's FIRST year and the earliest
  entry date — never change them to "start a new year".

**Checklist at year end**

1. Finish the old year: post all pending vouchers; reconcile GST (GSTR-1/3B
   for 1 Apr → 31 Mar) and TDS/TCS returns for the closing FY.
2. Press **Alt+F2** on the Gateway and set the session period to the new FY
   (e.g. 1 Apr 2026 → 31 Mar 2027). It is stored per company in this browser;
   Day Book and every report default to it. *Reset to FY* clears it.
3. Create any **recurring vouchers** for the new year as usual. Voucher
   numbering behaves as configured per voucher type (*Create → Voucher Types →
   Restart Numbering*): **Never** continues the one continuous series;
   **Each financial year (Tally)** restarts automatic numbers at the type's
   Start Number every FY. Flip periodicity only before the type's first
   voucher — after that the setting is locked (use a new type instead).
4. Stock, ledgers and masters carry over untouched. Physical stock counts for
   the new year go in as Physical Stock vouchers dated 1 April.
5. If you *want* a fresh set of books (new entity, data handover), create a
   new company and enter opening balances — zprime has no split-data path
   (documented boundary; not planned).

**Pre-books and future dates:** vouchers dated before *Books Begin From* or
in the future are accepted with an amber advisory (never silently dropped) and
are fully counted in openings and reports.

## e-Invoice & e-Way Bill connectivity (optional)

zprime can submit e-invoices and e-way bills to NIC directly (R-28+): B2B e-invoice → IRN, e-way bill from IRN, direct e-way bills for B2C (no IRN), and the full EWB lifecycle (vehicle/extend/cancel). Without credentials, payload **generate + download** works as always.

- Enable API access on the NIC portals (e-invoice IRP and — for direct EWBs — the separate EWB system), collect credentials + public key, set `IRP_ENC_KEY` in `.env` (`openssl rand -base64 32`), then configure per company in **Company Settings → IRP / e-Way Bill Connectivity** (sandbox/production rows, masked read-back).
- Full runbook — hosts, first-submit walkthrough, NIC error-code decode, rotation, backup notes: **[`ONBOARDING_IRP_EWB.md`](ONBOARDING_IRP_EWB.md)**.

## Notes & limits

- GST reports are management summaries (not e-filing JSON); TDS is deduction/payable tracking without challan e-file formats.
- Serving the UI + API is single-container (`app`) + `db`. `JWT_SECRET` and `ADMIN_PASSWORD` are **required** (fail-fast at boot since v1.9.0); `POSTGRES_PASSWORD` still defaults to `zprime` — acceptable because the `db` service publishes no ports, but change it if you expose Postgres.
- **Login throttling (since v1.13.0):** 10 failed logins in 10 minutes for the same source IP + username lock that pair for the remainder of the window (`429 Too Many Login Attempts` with `Retry-After`); a successful login resets it. Legitimate users are never affected unless they repeatedly mistype. State is in-memory (resets on restart) and single-process by design — this is defense-in-depth, not a substitute for network controls. On an internet-exposed deployment, also put the app behind a reverse proxy with HTTPS and consider additional rate limiting at the proxy layer.
- Login responses are timing-equalized between unknown users and wrong passwords, so response latency does not reveal whether a username exists.
- **First boot with a new company (R-42 drill):** a fresh company starts with the standard account groups + seeded accounting ledgers (cash/bank/duties), **starter units `Nos` and `Pieces`, and godown `Main`** (R-44) — so your first inventoried item can be saved immediately; edit or delete these on the Masters pages if you prefer different names. Typing an unknown ledger/item name in a voucher and pressing Enter offers inline quick-create (Tally Alt+C analogue); a freshly opened voucher screen no longer offers create while its pick lists are still loading (R-43) — if the Loading hint shows, wait a beat and re-pick.
