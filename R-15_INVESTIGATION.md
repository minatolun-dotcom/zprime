# R-15 Investigation — zprime v1.14.0 · Opening GST Balances (Candidate) + Readiness Sweep

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `NO P1/P2 DEFECT CONFIRMED — TEST HARDENING / READINESS REVIEW RECOMMENDED` (the opening-GST candidate is NOT A BUG — VERIFIED; recommended follow-up is a regression-locking test block, not a code change).
**Baseline:** HEAD `dc75b19744dbca517f6755a57492b99680316de4` = tag `v1.14.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified.

---

## 1. Executive Summary

With all B-01…B-12 findings and all §12 UX items dispositioned, R-15 investigated the highest remaining candidate from the action plan (§13 P2: "opening GST balances") plus a readiness sweep of what remains.

**Finding: there is no defect.** The application handles opening GST balances correctly by design, and live-probe evidence on v1.14.0 confirms a clean separation of concerns:

| Concern | Mechanism | Probe result (migrated-books scenario: IGST Cr 5,000 opening + interstate sale, taxable 10,000 + IGST 900) |
|---|---|---|
| Statutory return (GSTR-3B net, GSTR-1) | Derived **purely from period voucher entries** (`voucherGst()` — openings never enter the query) | net IGST **900** — correct period-only return semantics |
| Book position (GST duty ledger) | Ledger opening + movement | IGST closing **−5,900** Cr (−5,000 opening → −5,900) — true liability position |
| Books balance (TB / BS) | Opening entries must be entered paired by the operator | difference **−5,000** when the opening is entered unpaired — surfaced exactly by R-14's new TB banner + Gateway Books Health card |

There is no code path that equates the return figure with the ledger closing (no false invariant), the return correctly excludes pre-registration/pre-books-begin tax positions, and an unpaired opening is honestly visible as a books imbalance (which is the operator's entry responsibility, not a calculation). The historical B-02 lesson (opening *stock* value silently breaking the Balance Sheet) does **not** generalize to opening *GST*: a stock opening needed a *modeled accounting treatment* decision; a duty-ledger opening is an ordinary ledger opening and already behaves as one.

**Disposition: NOT A BUG — VERIFIED.** The only worthwhile follow-up is a small test-hardening block that locks this verified semantics in so it cannot regress (the same gap class as B-11: verified-correct behavior with zero coverage).

## 2. Baseline Integrity

- `git rev-parse HEAD` → `dc75b19744dbca517f6755a57492b99680316de4`; `git describe --tags` → `v1.14.0`; tree clean (intentional untracked plan file only).
- Baseline: **860/860** Python + **219/219** browser.
- Probe cleanup: disposable company 10 fully deleted via SQL (vouchers, entries, idempotency keys, ledgers, memberships, company), verified 0 leftovers; probe scripts removed from /tmp.

## 3. Source-Verified Architecture

1. `ledgerBalances()` (`accounting.ts:16`): ledger `openingBalance` is a real column input to every balance computation (TB, ledger reports, BS).
2. `gstr1()` / `gstr3b()` (`gst.ts`): both derive from `voucherGst(companyId, from, to, kind)` — a query over `voucher_entries` ⋈ `ledgers` ⋈ `vouchers` filtered to the period. **No opening term exists anywhere in the GST path** (grep for `opening` in `gst.ts`: zero matches).
3. `dutyHead` classification: `voucherGst` classifies entries by the *ledger's* `dutyHead` (IGST/CGST/SGST/CESS) — company creation seeds IGST/CGST/SGST-UTGST/CESS/TDS duty ledgers (`companies.ts:85-93`).
4. R-14's `difference` field + Books Health card now surface any unpaired-opening imbalance immediately (live-confirmed above).

## 4. Remaining Roadmap Candidates (post-R-15 sweep)

| Candidate | Source | Assessment |
|---|---|---|
| Opening-GST balances | plan §13 P2 | NOT A BUG — VERIFIED (this investigation); recommend regression-lock tests only |
| Audit-trail groundwork (`created_by`/`updated_by`) | plan Phase 5 / §13 P3 | Schema-expanding feature across every table; plan itself POSTPONEs the full audit trail; only start with explicit product decision |
| Opening-stock journal helper | plan §12.3 | Documented F-07-2 Model A limitation (R-07) — out of scope |
| RCM / e-invoice / e-way / GSTR-9 / TCS / batch / BOM | plan §13 P4 | POSTPONE — unchanged |
| Readiness review | protocol | Recommended next formal step (see §7) |

## 5. Proposed R-15 Scope (test-hardening only — NOT implemented)

`final_regression.py` R-15 block (~6 checks, no source changes):
1. Fresh company + paired openings (Cr 5,000 IGST liability vs Dr 5,000 Cash/BS counterpart) → TB difference 0.
2. Interstate sale (taxable 10,000 + IGST 900) → GSTR-3B `net.igst == 900` (openings excluded).
3. GSTR-1 `totals.netIgst == 900`.
4. IGST duty-ledger `ledger-vouchers` opening −5,000 / closing −5,900 (book position includes opening).
5. Unpaired opening (omit the counterpart) → TB `difference == -5000` and BS `difference == 5000` (R-14 surface catches it).
6. TB identity `difference == totalDebit - totalCredit` on the migrated-books company.

Expected battery: 866/866 Python; browser unchanged (219/219).

## 6. Non-Bugs Verified

- **F-15-1** — "GST reports must include opening GST balances to reconcile with duty ledgers": NOT A BUG — VERIFIED. Returns are period-only by law and by design; the ledger carries the position; nothing in the app falsely equates them.
- **F-15-2** — "Unpaired openings silently corrupt reports": NOT A BUG — VERIFIED (post-R-14). The imbalance is honestly visible in TB/BS difference and the Books Health card; it reflects the operator's actual (unpaired) entries rather than a calculation error.

## 7. Final Recommendation

No code change is warranted for the opening-GST candidate. Two honest paths forward, in protocol order:

1. **Approved test-hardening (§5):** lock the verified opening-GST semantics into the regression suite (~6 checks, no source changes) — the smallest R-15 that adds real protection.
2. **Formal readiness review:** with all plan findings dispositioned and no P1/P2 defects remaining, a formal read-of-the-whole readiness review (the "is zprime production-ready" gate with fresh evidence) is the natural next milestone before any new feature scope.

**NO P1/P2 DEFECT CONFIRMED — TEST HARDENING / READINESS REVIEW RECOMMENDED**
