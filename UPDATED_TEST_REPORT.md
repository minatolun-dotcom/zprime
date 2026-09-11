# zprime — UPDATED TEST REPORT

**Date:** 2026-09-08 · **Environment:** Linux, Node 22 (tsx), PostgreSQL 16 in Docker (`zprime-test-pg`, port 55432), fresh schema per suite; plus a full `docker compose` stack run.

## Suites executed (all green)

| Suite | Checks | Result | What it proves |
|---|---|---|---|
| `scripts/smoke_test.py` (original, unmodified) | 39 | **39 / 39** | Core flows: masters, all voucher types, GST vouchers, TB/BS/P&L to the paisa, stock costing, bill aging, TDS, payroll net, XML import + dedup, Docker client serve |
| `scripts/attack_test.py` (adversarial pass 1; 1 expectation corrected per policy) | 88 | **88 / 88** | Auth/IDOR/isolation, double-entry bypass, numbering, negative stock, FY boundary, fuzzing, SQLi/XSS/XML attacks, atomicity, perf sanity |
| `scripts/fix_regression.py` (new) | 65 | **65 / 65** | Every BUG-001…009 fix, verified at the API boundary |
| `scripts/attack2.py` (new — attacks the fixes) | 29 | **29 / 29** | 50-way numbering race (unique & sequential 1..50), settlement race serialization, edited/deleted bill interactions, restart resilience, FY-crossing numbering, cross-company concurrent numbering, payroll double-run race, XML counter sync, nested date fields, 200-entry voucher |
| `scripts/reconcile.py` (new — Phase 9) | 48 | **48 / 48** | Hand-computed full-business reconciliation (below) |

**Total: 269 checks, 0 failures.**

## Phase 9 reconciliation — hand-computed scenario, every number derived before running

Fresh company "Recon Traders" (Maharashtra, GSTIN 27…), then:

| Txn | Entry |
|---|---|
| Opening journal | Dr Cash 2,00,000 · Dr Bank 3,00,000 · Cr Capital 5,00,000 |
| Opening stock journal | Dr Opening Stock 40,000 · Cr Capital 40,000 (items: 100 A @200 weighted-avg, 50 B @400 FIFO) |
| Purchase intra (registered) | Dr Purchases 50,000 · Dr CGST 4,500 · Dr SGST 4,500 · Cr Sigma 59,000 (bill PUR-1) |
| Sale intra 27→27 | Dr Pune Stores 94,400 (bill INV-1) · Cr Sales 80,000 · Cr CGST 7,200 · Cr SGST 7,200 |
| Sale inter 27→29 | Dr Omega 1,18,000 (bill INV-2) · Cr Sales 1,00,000 · Cr IGST 18,000 |
| Receipt | Dr Bank 94,400 · Cr Pune Stores 94,400 (against INV-1) |
| Payment | Dr Sigma 30,000 (against PUR-1) · Cr Bank 30,000 |
| Payment | Dr Rent 12,000 · Cr Bank 12,000 |

**Verified against exact expected values (not read-backs):**

- **TB**: Dr 7,72,400 = Cr 7,72,400; per-ledger: Cash 2,00,000 Dr; Bank 3,52,400 Dr; Opening Stock 40,000 Dr; Purchases 50,000 Dr; Rent 12,000 Dr; Omega 1,18,000 Dr; Sales 1,80,000 Cr; CGST 2,700 Cr (4,500 Dr − 7,200 Cr); SGST 2,700 Cr; IGST 18,000 Cr; Sigma 29,000 Cr; Capital 5,40,000 Cr ✓
- **P&L**: Sales 1,80,000; Purchases 50,000; Opening stock 40,000; Closing stock 40,000; COGS 50,000 (no consumption); Indirect (Rent) 12,000; **Net profit 1,18,000** ✓
- **Balance Sheet**: Assets = Cash 2,00,000 + Bank 3,52,400 + Stock 40,000 + Omega 1,18,000 = **7,10,400**; Liabilities = Capital 5,40,000 + Sigma 29,000 + net GST 23,400 + Profit 1,18,000 = **7,10,400**; **difference 0** ✓
- **Bills Receivable/Payable**: Omega INV-2 open 1,18,000; Pune Stores closed; Sigma PUR-1 open 29,000 ✓
- **GSTR-1**: B2B taxable 1,80,000; IGST 18,000; CGST 7,200; SGST 7,200 ✓
- **GSTR-3B**: outward taxable 1,80,000 (IGST 18,000 / CGST 7,200 / SGST 7,200); ITC CGST 4,500 + SGST 4,500; **net payable 23,400** ✓
- **Registers/Ledger**: Sales register 2 vouchers totalling 2,12,400; Bank ledger 4 movements, closing 3,52,400 ✓
- **Stock**: Alpha 100 Nos @ 20,000 (weighted-avg); Beta 50 Nos @ 20,000 (FIFO) ✓

### Identity scoreboard

| Identity | Status |
|---|---|
| Total Debits = Total Credits | ✅ (7,72,400 = 7,72,400, and after every attack suite) |
| Assets = Liabilities + Capital | ✅ (7,10,400 = 7,10,400, difference indicator 0) |
| Ledger totals = Trial Balance | ✅ (per-ledger values match hand computation) |
| Sales transactions = Sales Register | ✅ |
| Purchase transactions = Purchase Register | ✅ |
| Stock movements = Stock Summary | ✅ (qty & value per item, weighted-avg & FIFO) |
| GST transactions = GST reports | ✅ (GSTR-1, GSTR-3B, ITC, net payable) |
| TDS transactions = TDS report | ✅ (smoke suite, 194C) |
| Payroll vouchers = Salary Register | ✅ (smoke suite, net 48,200) |
| Outstanding transactions = Bills Receivable/Payable | ✅ (incl. settlement-race safety) |

## Docker verification (post-fix image rebuilt from scratch)

- `docker compose down -v && up -d --build` on a **fresh volume**: migrations (incl. `0001_fix_qa_001`) auto-applied; `/api/health` ok; login ok; companies API ok; client served (HTTP 200); app logs contain **0** error/fatal lines.

## Known follow-ups (non-blocking, unchanged from QA_REPORT.md)

- GST reports remain summaries (no e-invoice/e-way JSON).
- No user roles / audit trail yet.
- CSV is generated client-side; server-side CSV endpoints (if added later) must reuse `lib/csv.ts` semantics.

---

# Addendum — final acceptance-repair pass (2026-09-10)

Repair of ACCEPTANCE_REPORT.md findings F-GRP-01, F-TDS-01, A-02…A-07 (see BUG_FIX_REPORT.md for root causes and files changed). Every suite re-run green on a fresh schema — 483 checks total, 0 failures — including the real-browser acceptance suite (117/117) against a rebuilt client, and a Docker fresh-volume deployment test (build → up → healthy → migrations auto-applied → endpoints verified in-container → restart → data intact).

Key invariants re-verified after the fixes: Dr=Cr on every voucher and report; Assets = Liabilities + Capital with no difference banner; GST ledger == GSTR-1 == GSTR-3B (duty-head amounts authoritative, contradictions flagged not dropped); TDS deducted − remitted = outstanding; bills receivable/payable reconcile to named bills; sub-period P&L equals independent engine period math; company isolation and voucher-numbering protections intact; BUG-002 allocation guards hold in real use.
