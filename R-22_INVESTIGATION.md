# R-22 Investigation — zprime v1.20.0 · Masters Actor Columns

**Status:** investigation complete — implementation NOT started (per protocol).
**Verdict:** `R-22 CONFIRMED — FULLY SCOPED, NO BLOCKERS` (approved product decision after two documented deferrals; direct replication of the R-17 pattern onto masters; one additive migration; no accounting-math surface).
**Baseline:** HEAD `398e20c…` = tag `v1.20.0`; working tree clean except this report and the intentional untracked `ZLEDGER_PRODUCTION_ACTION_PLAN.md`. No source/test/doc modified.

---

## 1. Executive Summary

R-22 extends R-17's actor provance from vouchers to **masters**: `created_by` / `updated_by` (FK → users, `ON DELETE SET NULL`, nullable — no fabricated backfill) plus `updated_at` on the master tables that have a per-row identity and a mutation surface. The two prior deferrals (R-17, R-20 roadmaps) were justified by "no per-row history surface to anchor the columns"; the R-18/R-20 audit work **removed that objection**: the audit_events table and the new Audit Trail page now establish both the pattern and a visible surface, and knowing who created/altered a ledger, stock item, or employee is meaningful provance for a multi-member company.

## 2. The Complete Write-Site Map (verified against source)

| Master write path | Location | Actor status today |
|---|---|---|
| Generic CRUD POST (9 master kinds: groups, ledgers, units, stock-groups, stock-categories, godowns, stock-items, voucher-types, tds-sections) | `crud.ts:100` | needs `created_by` |
| Generic CRUD PUT | `crud.ts:121` | needs `updated_by` + `updated_at` (created_by immutable) |
| Employees + pay-heads CRUD (payroll.ts) | same generic handler | covered by the crud change automatically |
| XML import: ensureLedger / ensureItem / groups / units / godowns inserts | `import.ts:197,221,241,251,261` | needs `created_by` (importing user — same rule as R-17's voucher import) |
| Company seeding: reserved groups + starter ledgers | `companies.ts:55,95` | **system** — no authenticated actor exists at creation time; columns stay NULL (honest) |
| Voucher types seeded per company | `companies.ts` seedCompanyTx | same — NULL (honest) |

One `crud()` signature change propagates to all 11 registered master kinds in one place. Import needs 5 one-line stamps. Seeding stays NULL by design — fabricating an actor for rows created before any user session would be dishonest (identical to R-17's no-backfill rule).

## 3. Design Decisions

1. **Tables covered:** `ledgers, groups, units, stock_groups, stock_categories, godowns, stock_items, employees, pay_heads`. **Excluded:** `voucher_types` (system-seeded, no user-facing CRUD surface for creation — rows are born at company creation) and `tds_sections` (same seed path). If a future feature lets users create custom voucher types, its columns can be added then.
2. **Column shape:** exact R-17 replication — `created_by`/`updated_by` `integer REFERENCES users(id) ON DELETE SET NULL` (nullable), `updated_at timestamp with time zone` (nullable, set only on edit). No `createdAt` changes (tables already have it).
3. **No backfill** — pre-R-22 masters honestly show NULL ("created before actor provance existed").
4. **crud() change is minimal:** POST gains `createdBy: actorId(req)`; PUT sets `updatedBy` + `updatedAt` and never touches `created_by` (client-supplied values are stripped — `delete data.createdBy/updatedBy/updatedAt` before save, same trust rule as R-03/R-17: actor comes from the verified JWT only).

## 4. Proposed R-22 Scope (for approval)

1. **Migration `0008_r22_master_actor.sql`** (additive, hand-authored per convention): 3 columns × 9 tables (27 ALTERs) + snapshot `0008_snapshot.json` generated programmatically + journal entry (idx 8).
2. **schema.ts:** `createdBy/updatedBy/updatedAt` on the 9 master tables.
3. **Server propagation:** `crud.ts` (~6 lines: actor param from req, stamping per §3); `import.ts` 5 stamp sites (importing actor).
4. **Tests:** `final_regression.py` +8 R-22 checks → 637 (manual master create stamps created_by; PUT stamps updated_by/updated_at and preserves created_by; import-created ledger/item carry the importing actor; seeded reserved groups/starter ledgers stay NULL; last actor survives user deletion is NOT tested — SET NULL is schema-level, already proven in R-03; cross-company 404 unaffected).
5. **Browser:** covered by existing suites (no UI change — provance display is a later feature; masters' actor fields are API-visible today). No new browser suite.
6. **Docs:** CHANGELOG/STATE/CONTINUE/RELEASES/ROADMAP per convention.
7. **Projected totals:** Python **919/919**, browser **253/253** unchanged (zero client changes). Proposed release: **v1.21.0 — "master-table actor provance"**.

## 5. Blast Radius

- **Accounting math:** zero — provance columns only; no calculation, posting, valuation, or report surface touched.
- **Migration:** additive-only (nullable columns, no backfill); fresh-install and upgrade paths both trivially safe; drift guard (R-12 block) will verify plain-SQL restore still works.
- **Security:** actor always from `req.userId` (verified JWT); client-supplied createdBy/updatedBy stripped at the crud boundary; import stamps the importing actor (R-17 rule).
- **Suites:** the 11 CRUD registrations all flow through the one handler; existing master regression blocks unaffected (new columns are nullable, inserts that omit them behave identically).

## 6. Out of Scope (unchanged from R-17/R-20 deferrals)

Master-row **history** display (an audit-events equivalent for masters), Day Book/MasterPage provance UI, voucher_types/tds_sections columns (system-seeded), retention/export, RBAC.

---

**Final verdict:** `R-22 CONFIRMED — FULLY SCOPED, NO BLOCKERS · AWAITING SCOPE APPROVAL`
