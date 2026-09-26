# PROJECT.md — What zprime Is

The permanent technical/product description of zprime. Every claim here is verifiable against the repository at the current tagged release (see `RELEASES.md`). Status vocabulary: **IMPLEMENTED** (working and verified), **PARTIALLY IMPLEMENTED**, **PLANNED** (roadmap, not built), **OUT OF SCOPE** (deliberately not built).

## Identity & purpose

**zprime** is a self-hostable, keyboard-first Indian accounting application for a small business or accounting consultancy. It follows the classic Tally-style workflow — Gateway home screen → function-key voucher entry → reports with drill-down — with an original web UI. It is intentionally **not** a multi-tenant SaaS ERP.

## Architecture

- **Backend:** Node 22, Fastify 5, TypeScript (`server/`)
- **Frontend:** React 18 + Vite + Tailwind, keyboard-first UI (`client/`)
- **Database:** PostgreSQL 16
- **ORM:** Drizzle (schema in `server/src/db/schema.ts`; migrations in `server/drizzle/`, auto-applied on boot)
- **Deployment:** Docker Compose — single `app` container (serves UI + API) + `db` (postgres:16-alpine, named volume, healthcheck)
- **Auth:** JWT `{uid, username}` in an httpOnly cookie, verified in a global preHandler (`server/src/routes/auth.ts`). No companyId in the token — by design (R-03).
- **Authorization:** centralized in `cid()` (`server/src/lib/routes.ts`) — every `/api/c/:cid/*` route verifies authenticated user → company membership server-side on every request; unauthorized ⇒ 404 with no existence leak. Company routes (list/detail/update/members) are membership-gated. Company creation is atomic with the owner membership. Minimal owner-only member management. (R-03, Model C membership junction `user_companies`.)
- **Multi-company:** one user may belong to multiple companies; company selection is URL-based (`/company/:cid`); the company list shows only authorized memberships. Stale/revoked company URLs render a neutral "Company not found" notice.

## Accounting model

- Indian accounting: financial year 1 Apr – 31 Mar, ₹ Indian number format.
- 28 pre-defined account groups + unlimited custom groups and ledgers (GSTIN, taxability, bill-wise enabled, bank flag, TDS sections).
- Double-entry with validation: `validateEntries` (Dr = Cr within tolerance), company-scoped reference validation (`assertRefsTx`), per-company unique ledger/group names.
- Voucher types: Contra (F4), Payment (F5), Receipt (F6), Journal (F7), Sales (F8), Purchase (F9), Credit Note (Alt+F6), Debit Note (Alt+F5), plus Delivery Note, Receipt Note, Stock Journal, Physical Stock, Manufacturing Journal, Payroll.
- Atomic voucher writes in a transaction with party-ledger `FOR UPDATE` locking where bills are involved; numbering via a DB counter row + per-company unique index (numbers are never reused or rewound).
- **Voucher cancellation (R-02):** Model A — mark + exclude. Cancel preserves the row, number, entries, inventory and bills; no reversal entries are ever created; active reports exclude the voucher; uncancel restores exactly. `cancelled_at/cancel_reason/cancelled_by` metadata (FK → users since R-03). Cancelled vouchers cannot be edited or deleted (409).
- **Bill-wise:** New Ref / Against Ref / Advance / On Account, validated by `validateBillsTx`; settled bills protect their vouchers from cancellation (R-02 settled-bill guard).
- **Opening balances (R-07):** ledger openings (Dr +/Cr −) flow into TB/BS/closings via the books-begin carry; item openings value the BS stock line from the inventory engine. Party openings surface in Bills Receivable/Payable as a display-only "Opening Balance" bill (never settleable via Against Ref — settle via On Account). Balance Sheet stock is taken from the inventory engine and Stock-in-Hand *sub-group* ledgers are zeroed structurally (no double-count). Unfunded item openings surface honestly as the BS "Difference in books" banner — the Tally-faithful remedy is a manual opening journal (Dr stock/asset ledgers, Cr Capital), documented as the supported workflow (F-07-2, Model A, decision in `R-07_INVESTIGATION.md` §8).

## Inventory

- Stock items, units, stock groups/categories, godowns; opening qty/value per item; reorder flag.
- Valuation: chronological per-item replay at read time (no mutable balances → no valuation race). **Weighted average is the default**; FIFO is implemented but non-default.
- Sales/Purchase, Delivery/Receipt Notes, Stock Journal, Physical Stock (counted-qty diff), Manufacturing Journal (source/target) all move stock.
- F-INV-01: inventory-only vouchers (`entries: []`) are valid only for inventory-category vouchers carrying ≥1 real stock movement; accounting-only vouchers require balanced ledger entries; negative Physical-Stock counted quantities are rejected.

## GST

- CGST/SGST/IGST posting via duty ledgers; intra/inter-state determination from party state vs company state (A-07: posted duty heads are authoritative, contradictions surface as `supplyMismatch`, never silently re-classified).
- **GSTR-1:** B2B/B2C/CDNR/CDNUR (R-05 signed note semantics — notes reduce output tax honestly) + HSN Table 12 (outward Sales inventory lines only — R-01; snapshot → item-master → "-" resolution for HSN code/rate). **GSTR-3B:** outward tax, ITC, net payable; RCM Table 4(A)(3) inward-RCM + ITC exclusion (R-23). **GSTR-9** annual return: Tables 4/5/6-7/8/9/12 with ITC reconciliation and 3B cross-check (R-26).
- Tax semantics: GST booked in ledgers must always appear in the GST reports (duty heads authoritative).
- **PARTIALLY IMPLEMENTED / known gaps (deliberate, current scope):** GSTR-2B/portal-upload APIs, e-filing JSON export. GST reports reconcile with the books; they are not portal-upload formats.

## Connectivity: e-Invoice & e-Way Bill (R-24…R-31) — IMPLEMENTED (opt-in)

- **Payload generation (stateless, always available):** NIC v1.01 e-invoice JSON (R-24) and EWB-01 e-way bill JSON (R-25) per voucher — download for manual portal upload; strict all-at-once validation; no credentials required.
- **Live submission (opt-in, per company + environment):** `irp_credentials` (AES-256-GCM at rest, `IRP_ENC_KEY`, boot fail-fast) + NIC sandbox/production environments (R-28): B2B e-invoice → IRN, EWB from IRN (R-28), **direct EWBs for B2C via the separate EWB-API v1.03** (R-30), and the full EWB lifecycle — vehicle update, once-ever validity extension (8-h window), 24-h cancellation — with **birth-path routing** to the system the EWB was born on (R-31). Hard idempotency (repeat submit returns the stored result with zero network calls); every submission/op recorded verbatim as the legal record (`irp_submissions`/`irp_ewb_ops`); masked credential read-back; honest 422/409/502 banners; wire-faithful mock for CI. Operator runbook: `ONBOARDING_IRP_EWB.md`.
- **Not implemented:** e-invoice cancellation, consolidated EWB, multi-vehicle split, EWB closure, GSP-intermediary flows beyond endpoint config, signed-invoice display/verification (the IRN QR itself renders on the invoice face — R-68), auto-retry queues.

## Payroll & TDS/TCS

- Employees, pay heads (earning/deduction → any ledger), salary structures; one-click monthly payroll processing creating a Payroll voucher + payslips; DB-enforced unique (employee, month) prevents duplicate runs.
- R-02 protections: processed payroll cannot be hard-deleted; cancellation preserves payslips; Salary Register excludes cancelled payroll.
- TDS: sections master (194C etc.), "Deduct TDS" helper on vouchers, entry snapshots, TDS payable report (deduction/payable tracking, no challan e-filing).
- TCS (R-27, Income-tax s. 206C): sections master, "Collect TCS" helper (gross-based one-click balancing), TCS report (collected − remitted = payable), excluded from GST duty aggregation with a dedicated neutrality proof. Thresholds are surfaced as reference data — **never enforced** (deliberate operator-judgment posture).

## Reports

All with period picker, Alt+F1 detailed/condensed, drill-down, **Export CSV (every view, R-66) and Print (print stylesheet)**: Balance Sheet, P&L (sub-period = period movements; FY view = cumulative), Trial Balance (with out-of-balance difference surface — R-14), Chart of Accounts (R-63 single-tree explorer), Day Book (incl. RCM badge — R-23), Ledger Vouchers (running balance), Group Summary, Cash/Bank Book (O-1 period semantics: future vouchers never contaminate historical windows), Sales/Purchase Registers, Stock Summary, Bills Receivable/Payable (incl. display-only party opening bills — R-07), GSTR-1 (with e-invoice/EWB submit + lifecycle actions), GSTR-3B, GSTR-9, TDS report, TCS report, Salary Register, Cheque Register, Audit Trail (company chronology + per-voucher history — R-18/R-20).

## XML import

- Tally-style XML import of masters (groups/ledgers/stock items/units/godowns) and vouchers (all types, bill refs, GSTIN); duplicates skipped.
- **Transaction + validation integrity (R-04, v1.4.0):** the import path runs in a single transaction with API-equivalent double-entry/bill validation (all-or-nothing per import), per-voucher error attribution, a dry-run mode (`?dryRun=1` — identical transaction path, full rollback, nothing persisted), and imported-ledger taxability classification (B-03/B-05/B-13/B-14 resolved).

## Utilities & UI philosophy

- Cheque printing with amount-in-words; cheque register; company settings; CSV report export on every report view (R-66) + report print stylesheet + **invoice printing** for Sales/Delivery Note vouchers (GST-ready face, party master details, amount in words).
- **Keyboard-first:** F2 date · F4–F9/Alt+F-keys quick vouchers · Ctrl+A accept (vouchers and, since R-72, the master editor — Ctrl+S aliases it there) · Alt+F1 detailed/condensed · Esc back · Enter adds entry row · type-ahead ledger & item search. The UI is compact and minimal by design — no ERP clutter.
- **Quick-create (Tally Alt+C analogue):** typing an unknown ledger/item in a voucher and pressing Enter opens inline creation; while a freshly mounted screen's options are on their initial fetch the create path is suppressed with a "Loading options…" hint (R-43 F-42-1 guard). Fresh companies seed accounting ledgers plus starter units (Nos, Pieces) and godown Main — ordinary masters, edit/delete freely (R-44 F-42-2).

## Financial year model

- Per-company books-begin date and FY 1 Apr–31 Mar; period-scoped reports; company-scoped voucher counters per type.

## Deployment model

- `docker compose up -d` → app (port 3000, healthcheck) + db; migrations auto-apply on boot on an empty volume; admin seed on first boot. Restart preserves data (named volume). Change `JWT_SECRET`/`ADMIN_PASSWORD` before exposing beyond localhost (README).
- Fresh-install and upgrade-from-previous-release paths are verified at every release that adds a migration (see `RELEASES.md`).

## v1 scope boundaries (deliberate)

- **IMPLEMENTED:** everything above as marked.
- **IMPLEMENTED:** everything above as marked — including RCM (R-23), TCS (R-27), e-invoice/e-way bill connectivity (R-24…R-31), GSTR-9 (R-26), and the append-only audit trail (R-18/R-20).
- **Formerly PLANNED audit candidates, now resolved:** import integrity (v1.4.0), CN/DN GST sign + CDNR and Apply-GST party balance (v1.5.0), negative-stock guard (v1.6.0), opening balances in reports (R-07). Current candidates live in `ROADMAP.md`.
- **OUT OF SCOPE for v1:** multi-organization/workspaces, invitations/email workflows, SSO/2FA, granular RBAC matrix, period locking, batch/serial tracking, BOM/production orders, multi-currency, subscription billing, GSTR-2B, e-filing JSON export, portal-upload APIs.

## Verification capability (what proves it works)

- 1,234 Python checks across 6 suites (smoke 39, adversarial 88, bug-fix 65, reconciliation 61, final regression 952, attack-the-fixes 29) + 725 real-browser checks (run.js baseline 153 + 23 R-scenario suites + 3 persona suites: beginner/pro/hacker) — see `STATE.md` for exact commands; `RELEASES.md` for release-time totals.
- Independent expectation engine (`scripts/acceptance/engine.py`, pure Python, zero shared code with the app) reconciles TB/BS/P&L/FIFO stock/bills/GSTR-1/GSTR-3B/TDS/cash-bank/salary to the paisa.
