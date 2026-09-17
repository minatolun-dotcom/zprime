# R-10 Investigation — zprime v1.9.0 · B-10 Duplicate Submissions / Idempotency

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-10 CONFIRMED — INVESTIGATION REQUIRED` (P2, live-reproduced on v1.9.0: duplicate submissions create duplicate vouchers, duplicate postings, and inflated outstanding/tax figures).
**Baseline:** HEAD `f2403b1c5bc51db83fe93d520c642ac0c35947ec` = tag `v1.9.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified. All probe data lived in the disposable docker stack (zprime-db-1) and was fully deleted (verified 0 leftovers).

---

## 1. Executive Summary

The production action plan's B-10 claim — *"duplicate submissions double-post; no idempotency key (INV2: same payload → vouchers 1,2)"* — is **CONFIRMED** by live reproduction on v1.9.0.

The server has **no idempotency mechanism of any kind** on `POST /vouchers`: no request key, no payload fingerprint, no natural-key dedup. Two identical payloads produce two distinct, internally-balanced vouchers with distinct auto numbers. Three concurrent identical POSTs produce three vouchers. A duplicated ₹3,000 sale inflates Receivables from 3,000 to 6,000 with two open bills — and would double-count GST in GSTR-1 and double-count stock.

The client's only mitigation is a `saving` state that disables the **Accept button** — but the `Ctrl+A` hotkey (the primary, keyboard-first workflow in zprime) invokes `save()` unconditionally, and even a naive `if (saving) return` guard would be unreliable due to stale-closure capture. The realistic double-accept path is open in the UI, and retry-after-timeout (network blip, slow response) double-posts with or without the UI.

One accidental partial shield exists: an **exact resend** of a bill-wise Sales voucher collides on the bill name (A-02 uniqueness) and returns 409 — but that protects only bill-wise sales; Payments (on_account), Journals, and inventory-only vouchers duplicate freely.

Severity **P2** (confirmed, matching the plan): silent financial overstatement requiring user action or a retry — not attacker-driven, not automatic, books stay internally balanced, but the figures are wrong.

## 2. Baseline Integrity

| Check | Result |
|---|---|
| `git status --short` | `?? ZLEDGER_PRODUCTION_ACTION_PLAN.md` only (intentional) |
| `git rev-parse HEAD` | `f2403b1c5bc51db83fe93d520c642ac0c35947ec` |
| `git describe --tags` | `v1.9.0` |
| `git diff --check` | clean |

Probe footprint: two disposable companies (`R10 DUP PROBE`, `R10 AR2 PROBE`) created and **fully deleted**; `SELECT count(*) … name LIKE 'R10 %'` → `0`. Probe scripts live in `/tmp` only.

## 3. The B-10 Claim

Plan (line 219): *"Duplicate submissions double-post | No idempotency key | P2 | INV2: same payload → vouchers 1,2 | Client-generated request key + unique index (or UI confirm)."*

## 4. Code Findings (pre-probe)

- `server/src/routes/vouchers.ts` — `POST /vouchers` (line 530): parse → loop{ `db.transaction(insertVoucherTx)` }. `insertVoucherTx` (line ~427) validates type/ledgers/refs/stock/bills, draws the next number via the locked `voucherCounters` row, inserts, writes body. **Every layer is per-request; nothing compares this request to any previous one.** `grep -i idempoten|requestId|dedupe` over `server/src` → 0 matches.
- `client/src/pages/VoucherScreen.tsx` — `save()` (line 200) → `setSaving(true)` → `post(...)`; the Accept button is `disabled={saving}` (line 512), **but** `useHotkeys({"Ctrl+A": () => save(), …}, [entries, inv, date, number, reference, narration, party, diff, vType])` (line 278) registers the hotkey handler **without** a `saving` guard and without `saving` in its deps — so the keyboard path is unprotected, and a closure-based guard would read a stale `saving=false` anyway (a ref would be required).
- Test coverage: `grep INV2|idempoten` over all suites → 0. The only duplicate-related checks are master name-uniqueness (group/section 409s). **Zero coverage of duplicate voucher submission.**

## 5. Live Reproductions (v1.9.0, disposable company, real HTTP)

### R1 — Sequential exact duplicate (Payment, on_account)
Same payload POSTed twice → **200 id=38 no=1** and **200 id=39 no=2**. Two vouchers, both posted. **CONFIRMED (INV2).**

### R2 — Sequential exact duplicate (Journal)
→ **200 no=1** and **200 no=2**. Confirms non-party vouchers duplicate equally.

### R3 — Concurrent identical POSTs (3 threads, same Payment payload)
→ `[(200, 42, '3'), (200, 43, '4'), (200, 44, '5')]` — **three vouchers created**. Auto-numbering races are handled correctly (distinct numbers), i.e. the infrastructure actively *helps* duplicates post cleanly.

### R4 — Bill-wise Sales duplicate (the accidental shield)
Exact resend of a `new_ref` bill-wise sale → **409** `Bill name "…" already exists on this party ledger` (A-02 bill-name uniqueness, coincidental). Client-accurate duplicate (re-accept recomputes the bill name from the fresh voucher number) → **200 no=2**. **The shield does not cover the real double-accept path.**

### R5 — Financial impact of one duplicated ₹3,000 sale
`GET /reports/receivables` after R4's client-accurate duplicate:
```
debtor total = 6000, bills = [S-1: 3000 (open), S-2: 3000 (open)], total = 6000
```
**Receivables doubled.** Since each voucher is internally balanced, TB stays balanced — the corruption is *overstatement*: receivables/payables, stock on hand, GST liability (GSTR-1 B2B/B2CS), and COGS are all inflated by the duplicate. The user sees no warning.

## 6. Verified Correct (NOT A BUG — VERIFIED)

- **Manual-number concurrency:** 3 concurrent POSTs with the same manual number → 1×200 + 2×409. The unique index `(companyId, voucherTypeId, number)` plus the collision-burn retry work exactly as designed.
- **Transaction atomicity:** every duplicate is a complete, balanced voucher — no partial state from this defect (INV1 invariant unaffected).
- **Payroll duplicate-month:** protected by R-02 duplicate-month rejection (separate mechanism, out of scope here).
- **Import path:** creates vouchers from user-selected XML files — a re-import is a deliberate user action with its own confirmation flow; not a duplicate-submission defect (out of scope for R-10).

## 7. Root Cause

`POST /vouchers` treats every request as a new business event. Vouchers have no natural key (two identical cash payments in one day are legitimately distinct in accounting), so without an explicit request identity the server *cannot* distinguish "user re-accepted the form" from "new identical transaction". The client suppresses only the button-click path; the hotkey and network-retry paths both reach the server as fresh requests.

## 8. Severity Assessment

**P2 — confirmed.** Silent overstatement of financial figures (AR/AP/stock/GST) from an ordinary user action (double-accept, double-Enter, retry after timeout). Not P1 because it requires a user/retry trigger, is not remotely exploitable, and leaves books internally balanced; not P3 because the wrong figures flow into statutory GST reports and collection workflows without any warning.

## 9. Proposed R-10 Scope (for approval — NOT implemented)

1. **Server idempotency (migration 0005, additive):** new table `idempotency_keys` (`id`, `company_id → companies.id`, `key text`, `voucher_id → vouchers.id`, `created_at`, `UNIQUE(company_id, key)`). `POST /vouchers` accepts an optional client key (header `X-Idempotency-Key` or body field): if `(company, key)` exists, return the **original voucher** (200, same id) instead of creating a second; otherwise record the key and voucher in the same transaction as the insert. Missing key = current behavior (backwards compatible; import/payroll unaffected).
2. **Client:** generate a UUID when a **new** voucher form opens (not per attempt), send it with every save attempt (retry-safe by construction); add a `savingRef` guard so the `Ctrl+A` hotkey path is truly single-shot.
3. **Tests:** regression block — same key twice → same voucher id, single posting; different key → two vouchers; concurrent same-key → one voucher; key company-scoped; no-key legacy payload still works; replayed key after voucher cancel returns the cancelled voucher faithfully. Browser check — double Ctrl+A on a payment creates exactly one voucher.

**Alternative rejected:** UI-only confirm dialog — does nothing for network retries, contradicts the keyboard-first flow, and leaves the API surface unprotected (the plan's "or UI confirm" is the weaker option).

## 10. Out of Scope

Payroll/import idempotency (separate existing protections/flows), audit trail, PUT/DELETE idempotency (already naturally idempotent or guarded by R-02 rules), JWT/auth changes.

## 11. Final Recommendation

Proceed to human review with the scope in §9. The migration is additive, the mechanism is opt-in per request, and no accounting mathematics change: it decides **whether a second identical event is recorded**, not how anything calculates.

**R-10 CONFIRMED — INVESTIGATION REQUIRED**
