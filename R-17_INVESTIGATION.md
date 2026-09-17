# R-17 Investigation — zprime v1.16.0 · Audit-Trail Groundwork (created_by / updated_by)

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-17 CONFIRMED — INVESTIGATION REQUIRED` (P3 feature-groundwork item, fully scoped; bounded migration + centralized propagation; no defect behind it).
**Baseline:** HEAD `b919e161cb8a28f547a7846d8565762f36165532` = tag `v1.16.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source, test, migration, or doc file modified.

---

## 1. Executive Summary

Human selected audit-trail groundwork as the R-17 target. This investigation scopes the **smallest honest groundwork**: an actor-provance layer for **vouchers only** — `created_by` and `updated_by` (FK → `users.id`, nullable, `ON DELETE SET NULL`), populated server-side from `req.userId` on every write path. It deliberately **excludes** the master tables (ledgers/groups/items/units/godowns) for the reason in §4: their generic CRUD has no per-row historical data to anchor the columns to today, so `created_by` there would be immediately-stale metadata, not provance. Scope can extend to masters later without rework, since the columns follow the established `cancelled_by` pattern.

This is groundwork, not the audit-trail feature: no audit-events table, no history UI, no WHO-did-WHAT-WHEN log viewer. It establishes the identity plumbing so the future feature can be added without another migration campaign.

## 2. Baseline Integrity

- `git rev-parse HEAD` → `b919e161cb8a28f547a7846d8565762f36165532`; `git describe --tags` → `v1.16.0`; tree clean (intentional untracked plan only).
- Baseline: 868/868 Python + 219/219 browser; product status RELEASE CANDIDATE.

## 3. Current Actor Infrastructure (source-verified)

1. `vouchers.cancelled_by` (schema.ts:187): `integer("cancelled_by").references(() => users.id, { onDelete: "set null" })` — the exact column pattern to replicate. Set at cancel (`cancelledBy: req.userId`, vouchers.ts:710), cleared at uncancel (vouchers.ts:778).
2. `req.userId` is available on every authenticated route (auth plugin preHandler; R-03 made it the authorization identity), so the actor is already flow-proven end-to-end.
3. `vouchers.created_at` exists (`defaultNow()`); **no `updated_at` exists anywhere** — confirmed by grep.
4. **Voucher write paths (complete map — three inserts, one update, two cancel sites):**
   - `POST /vouchers` → `insertVoucherTx(tx, c, input, "manual")` (vouchers.ts:565) — insert site 1; sets `source`.
   - XML import → own `tx.insert(vouchers)` with `source: "import"` (import.ts:448) — insert site 2 (import does NOT reuse `insertVoucherTx` — the R-17 implementation must cover both).
   - `PUT /vouchers/:id` → rewrites body inside the R-02-frozen transaction (vouchers.ts:600) — the `updated_by` site.
   - `POST /vouchers/:id/cancel` → sets `cancelledBy: req.userId` (710) — already actor-stamped.
   - `POST /vouchers/:id/uncancel` → clears actor fields (778) — untouched by R-17.
   - R-10 idempotent replay returns the original voucher without inserting — no actor event (correct).
   - `DELETE /vouchers/:id` → row deleted (R-02 rules); audit trail will rely on cancel-first semantics — unchanged here.
5. Master tables: `crud.ts` has a **single generic handler** for POST/PUT/DELETE (one insert site, one update site). Seeded rows (company-creation starter ledgers, default groups/types) have no actor.

## 4. Scope Decision: vouchers only, masters deferred

`created_by` on masters would be immediately-stale metadata: there is no master history surface, no report, no UI anchor. On vouchers the columns are *useful today*: Day Book and ledger drill-downs can show "entered by X, edited by Y" without any new feature. The investigation therefore recommends: **vouchers now; masters deferred** until the full audit feature (or a master-history need) justifies them. The generic-CRUD site makes adding them later a ~15-line change.

## 5. Proposed R-17 Scope (bounded, additive — NOT implemented)

**Migration `0006_r17_voucher_actor.sql` (additive, hand-authored per 0003/0004/0005 convention):**
```sql
ALTER TABLE "vouchers"
  ADD COLUMN "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "vouchers"
  ADD COLUMN "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
```
- Nullable, no `NOT NULL`, no backfill. Honesty rule: existing rows keep NULL ("before audit groundwork"). A pragmatic backfill (vouchers whose `source='import'`... the importing user isn't reconstructible) is deliberately **not** attempted — fabricating actor values is worse than NULL.
- Drizzle snapshot + journal entry per the established convention.
- Optional `updated_at` (additive, same migration): recommended **yes** — it turns `updated_by` into verifiable provance and costs one column; default null for existing rows.

**Schema (`schema.ts`):** `createdBy`/`updatedBy` (+ optional `updatedAt`) mirroring the `cancelledBy` pattern.

**Server propagation (centralized, ~6 lines total):**
- `insertVoucherTx` gains an `actor` parameter; `POST /vouchers` passes `req.userId`; `createdBy` set at insert. Import passes the importing user's id (it runs inside the authenticated request context).
- `PUT /vouchers/:id` sets `updatedBy: req.userId` (+ `updatedAt: now()`) in the existing `.set()`.

**Display (minimal, pattern exists):** Day Book/VoucherScreen "entered by / edited by" only where actor values are non-null. **No** new history UI.

**Tests:**
- Python block (~5 checks in `final_regression.py`): manual POST → `created_by == admin id`; import → `created_by == importing user`; PUT → `updated_by` set + `created_by` unchanged; uncancel/cancel semantics unchanged; TB balanced throughout.
- Browser: no dedicated suite — the 153-check baseline exercises voucher create/edit via real UI and would fail on any regression; optional screenshot-level check only.

**Explicitly out of scope:** audit-events table, history viewer, master-table columns, WHO-deleted records (rely on cancel-first), backfill of fabricated actors, report changes.

## 6. Risks

- Migration is additive and nullable → upgrade-safe; fresh installs get the columns from zero (verified pattern: 0003/0005).
- `insertVoucherTx` signature change touches manual + import paths — both covered by regression checks above.
- No accounting-math surface touched (actor stamping is orthogonal to calculations).
- `ON DELETE SET NULL` matches `cancelled_by`; user deletion remains unsupported in-product (documented in R-03 review), so behavior is theoretical anyway.

## 7. Final Recommendation

Proceed to HUMAN_REVIEW with the §5 scope: one additive migration (2–3 columns), centralized propagation at the two insert sites + one update site, optional Day Book display, ~5 regression checks. Deferred: masters, audit-events table, history UI.

**R-17 CONFIRMED — INVESTIGATION REQUIRED**
