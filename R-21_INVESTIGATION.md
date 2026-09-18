# R-21 Investigation — zprime v1.19.0 · UI Hardening Pair

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-21 CONFIRMED — TWO SCOPED UX HARDENING ITEMS, NO BLOCKERS` (client-advisory warning + a true server dry-run; no migration, no accounting-math change, server guards untouched).
**Baseline:** HEAD `d531e50…` = tag `v1.19.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source/test/doc modified.

---

## 1. Executive Summary

R-04 (§15) observed two UX gaps that are "companions to B-01/B-03, not standalone bugs": **(a)** VoucherScreen gives no negative-stock feedback until the server rejects the save, and **(b)** XML Import offers no pre-validation — the operator discovers row errors only after committing. Both remain true on v1.19.0. Both are now cheap, well-bounded fixes because the hard part already exists server-side:

- **Negative stock:** R-06's `assertStockAvailabilityTx` guards the server; the UI just never warns. Fix: a client-advisory amber warning computed from the **existing** `GET /stock-summary?to=<voucher date>` (runningQty per item), shown live as outward rows are typed. Non-blocking — the server guard remains the authority and is untouched.
- **Import pre-validation:** the R-04 import already validates everything (Dr=Cr, references, stock availability, duplicates) inside one transaction. Fix: a `?dryRun=1` mode that runs the **identical** code path and rolls back at the end (throw a sentinel from inside the transaction after building stats), returning the same result table the real import shows — with "nothing was imported". The client gets a **Validate** button beside **Start Import**.

Both fixes are advisory/visibility only; neither changes posting, valuation, or report math.

## 2. Item A — VoucherScreen negative-stock warning

**Today:** `STOCK_FLOW` sign map (line 17) drives outward rows negative; the user learns of insufficiency only from the red banner after Ctrl+A (`Insufficient stock: "item" would go negative…` — R-06's message, verified in the R-06 regression block).

**Design:**
- VoucherScreen already loads `allItems`; add a query for `GET /stock-summary?to=<voucher date>` (cid-scoped; `asOf` semantics = chronological qty up to date — exactly the guard's own chronology).
- On every inventory-row change: for each item, `wouldBe = runningQty + Σ(client deltas)` (outward flows negative per STOCK_FLOW; multiple rows summed; `physical` rows skipped — absolute by definition). If `wouldBe < -1e-9` on any outward item → amber strip under the inventory grid: `Insufficient stock: "R06 Widget" — only 2 available on 2026-07-03. Save will be rejected unless "Allow Negative Stock" is enabled.`
- Suppressed when the company opted in (`allowNegativeStock` from `GET /companies/:id` — same field the settings page PUTs). Suppressed on fetch failure (silent-degrade; the server still catches everything at save).
- Edit mode: advisory only (the server's prev-exclusion chronology stays authoritative; a warning that's slightly conservative on a heavily-backdated edit is acceptable for an advisory hint).

## 3. Item B — Import dry-run validation

**Today:** `POST /xml` → `runImport` in ONE transaction (R-04/B-05); row-level failures roll back everything, but the operator only sees the outcome after attempting a full commit. Stats/errors display exists (`stats.errors`, skipped counts) — it's just post-commit.

**Design:**
- Server: accept `?dryRun=1` (query — works for both multipart and JSON bodies). Inside `runImport`, after processing, if dryRun: `throw { dryRun: true, stats }` **before** any return — the transaction wrapper rolls back every insert (masters, vouchers, counters, audit events, idempotency records — all live in the same tx). The route's catch recognizes the sentinel (`err?.dryRun`) and returns `{ ...stats, dryRun: true }` with 200, **before** `pgFriendly` mangling. Everything else propagates unchanged.
- This is a true pre-validation: identical parsers, identical `validateEntries`/`assertStockAvailabilityTx`/reference checks — the operator previews exactly what the real run would do (counts per master type, vouchers, skipped duplicates, first 10 warnings).
- Client: a second button **Validate** (ghost style) beside **Start Import**; result card reuses the existing table with a blue "Dry run — nothing was imported" banner; Start Import unchanged.

**Safety notes:** dry-run cannot persist anything (single-tx rollback); no new authorization surface (same cid() POST as the real import); a malicious/absent dryRun value simply behaves as a normal import attempt — no new failure mode. Re-entrancy: two dry-runs in parallel each get their own transaction.

## 4. Blast Radius

- **Accounting math:** zero — advisory UI + rollback-only server path; guards and valuation untouched.
- **Migration:** none.
- **Security:** no new endpoints; dry-run rides the existing cid()-gated import route.
- **Existing suites:** R-06 block (guard semantics) and import blocks unaffected; the real-import path is byte-identical when `dryRun` is absent.

## 5. Proposed R-21 Scope (for approval)

1. **Server:** `import.ts` dry-run mode (~12 lines: sentinel + query flag + catch branch).
2. **Client:** `VoucherScreen.tsx` advisory warning (~30 lines incl. stock-summary query + suppression); `ImportXml.tsx` Validate button + dry-run result banner (~35 lines).
3. **Tests:** `final_regression.py` +8 R-21 checks → 627 (dry-run returns stats & persists NOTHING — vouchers/ledgers/counters counts unchanged; unbalanced XML → error listed, nothing persisted; oversell XML → item named, nothing persisted; real import after dry-run unaffected; dry-run needs auth/cid like the real route). New `scripts/acceptance/r21_ui.js` ~7 checks (warning appears when overselling via UI, clears on correction, suppressed on opted-in company, absent on non-stock types; Validate shows counts + nothing-imported banner + Day Book unchanged; Start Import then shows the voucher).
4. **Docs:** CHANGELOG/STATE/CONTINUE/RELEASES/ROADMAP per convention.
5. **Projected totals:** Python **909/909**, browser **247/247**. Proposed release: **v1.20.0 — "voucher and import pre-validation UX"**.

## 6. Out of Scope

Server-side warning push (WebSocket/SSE), import row-level diff preview UI, per-line GST validation display, any change to guard messages/semantics.

---

**Final verdict:** `R-21 CONFIRMED — FULLY SCOPED, NO BLOCKERS · AWAITING SCOPE APPROVAL`
