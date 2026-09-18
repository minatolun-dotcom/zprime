# R-18 Investigation — zprime v1.17.0 · Full Audit Feature (voucher events + viewer)

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-18 CONFIRMED — IMPLEMENTATION PROPOSED` (P3 feature item built on the R-17 groundwork; no defect behind it — this is the approved product decision from the R-18 direction question).
**Baseline:** HEAD `fd938dbf09e8efcdabf9299316cba5cae30eceb6` = tag `v1.17.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified.

---

## 1. Executive Summary

R-18 delivers the **full audit feature** for vouchers: an append-only `audit_events` table recording WHO did WHAT WHEN at every voucher lifecycle transition, plus a minimal read-only history viewer on the voucher screen. The R-17 groundwork (actor columns on vouchers, the verified three-site write map, the `cancelled_by` precedent) makes this a bounded, low-risk build.

Two side-findings from this investigation:

- **F-R18-1 (P3, folded into R-18):** the **payroll voucher insert** (`payroll.ts:133`, `source: "payroll"`) does **not** stamp `created_by` — R-17 covered manual, import, and edit, but payroll predates the actor parameter and was missed. Payroll vouchers will show a NULL author despite the run being initiated by an authenticated user. R-18 adds the stamp (trivially) since the site is now in scope anyway.
- **F-R18-2 (verified, not a bug):** hard delete of vouchers is deliberately constrained (R-02: cancelled vouchers undeletable; settlement guards block deleting settled/stranding vouchers), so `delete` events will be rare and referential integrity of the events table survives.

**Capture-mode decision: same-transaction writes.** The audit insert executes inside the same DB transaction as the state change, giving the guarantee that matters: **an event exists iff the change committed.** An out-of-band/async writer would introduce a new failure mode (accounting changed, audit lost) — exactly what an audit trail must not do. The hook is a single trivial insert per transition; no accounting-math surface is touched.

## 2. Baseline Integrity

- `git rev-parse HEAD` → `fd938dbf09e8efcdabf9299316cba5cae30eceb6` = `v1.17.0` ✓
- Working tree clean apart from this report + intentional untracked action plan ✓
- All 19 tags intact, immutability untouched ✓

## 3. Event Capture Map (verified against source)

| Transition | Site | tx available | Actor source | Event |
|---|---|---|---|---|
| Manual create | `vouchers.ts:568` → `insertVoucherTx` | yes | `req.userId` | `create` |
| XML import create | `import.ts:444` (own insert) | yes | importing user (`req.userId`) | `create` |
| **Payroll create** | `payroll.ts:133` (own insert) | yes | `req.userId` — **stamp missing today (F-R18-1)** | `create` |
| Edit | `vouchers.ts:603` PUT handler | yes | `req.userId` | `edit` |
| Cancel | `vouchers.ts:713` block | yes | `req.userId` (already stamped on the voucher) | `cancel` + reason in detail |
| Uncancel | `vouchers.ts:784` block | yes | `req.userId` | `uncancel` |
| Delete | `vouchers.ts:793` handler | yes | `req.userId` | `delete` + one-line snapshot (type/number/date/amount) of what was removed |
| R-10 idempotent replay | returns original record | — | — | **no event** (correct: no state change occurred) |

All seven capture sites already run inside `db.transaction(...)` — the same-tx hook needs no new transaction boundaries.

## 4. Proposed Design

### 4.1 Migration `0007_r18_audit_events.sql` (additive, hand-authored per convention)

```
audit_events:
  id          serial PK
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE
  voucher_id  integer NOT NULL REFERENCES vouchers(id)  ON DELETE CASCADE
  actor_id    integer          REFERENCES users(id)     ON DELETE SET NULL
  action      text NOT NULL    -- create | edit | cancel | uncancel | delete
  detail      text             -- cancel reason; delete snapshot; NULL otherwise
  created_at  timestamptz NOT NULL DEFAULT now()
  index (company_id, voucher_id)   -- viewer query
  index (company_id, created_at)   -- future timeline needs
```

**No backfill.** Pre-R-18 transitions are unknowable; seeding `create` events from R-17's `created_by` would fabricate event timestamps (migration time ≠ actual time). Pre-R-18 vouchers show an honest empty history. Same honesty rule as R-17's actor columns.

**Retention:** no purge job — rows are tiny and append-only. Documented as a future need, not built now.

### 4.2 Capture hook

A small `recordAuditEvent(tx, companyId, voucherId, actorId, action, detail?)` helper (single insert, ~5 lines) called at the seven sites above. Payroll also gains `createdBy: req.userId` (F-R18-1 fix). No other voucher logic changes; R-02 cancel/uncancel semantics untouched.

### 4.3 Viewer (minimal, read-only)

- **API:** `GET /vouchers/:id/audit` — `cid()`-gated (membership enforced centrally, exactly like every voucher route) → `[{ action, actorUsername, createdAt, detail }]` ascending, actor resolved via join to `users`.
- **UI:** one compact **History** line on `VoucherScreen.tsx` for existing vouchers (fetch on load): `Created by alice · edited by bob · cancelled by alice (reason) · 14 Jan 2026, 10:32`. No new page, no company-wide timeline (explicitly out — UI creep; the Day Book remains the company-wide surface). Silent-degrade if the fetch fails.

## 5. Blast Radius / Verification Plan

- **Tests:** ~8 regression checks — create/edit/cancel/uncancel/delete event chains with correct actors; cancel reason captured; delete snapshot captured; import produces per-voucher `create` events with the importing actor; payroll stamps `created_by` + `create` event; **cross-company 404** on the audit endpoint; **atomicity proof** (forced audit failure aborts the posting — no state change without its event).
- **Browser:** new ~4-check `r18_ui.js` — History line renders after create/edit/cancel; empty (honest) for untouched vouchers; no History surface on failed fetch.
- **No accounting-math change.** Migration additive; fresh + upgrade safe (0007 forward-applies in both paths).
- Expected battery: 875 → ~883 automated; browser 219 → ~223.

## 6. Out of Scope (unchanged product boundaries)

Masters/ledger audit events, company-wide audit timeline page, audit retention/export, full RBAC, GST compliance family (RCM/e-invoice/e-way/GSTR-9/TCS) — all remain postponed product decisions.

## 7. Final Recommendation

Proceed to implementation with the scope in §4. The feature rides entirely on verified R-17 groundwork; the only new engineering risk (same-tx coupling) is mitigated by the triviality of the hook and the atomicity regression test.
