-- R-88: per-company (manual) backup/restore — scope bookkeeping on the
-- existing deployment-level run history. Additive only.
--
-- Extend backup_runs with a scope dimension so the same audit trail records
-- both deployment-wide runs (current behavior, scope_kind = 'deployment') and
-- per-company runs (scope_kind = 'company', company_id populated). Existing
-- rows are all deployment runs -> set scope_kind = 'deployment' once; every
-- future company run carries its cid. company_id is nullable (deployment rows
-- have none) and FK'd to companies so a removed company leaves its run rows
-- intact (set null) rather than cascading them away.
--
-- Why extend the existing table rather than add a second one: the audit trail
-- is "everything this deployment's backup subsystem did", and scope is a
-- property of a run, not a separate subsystem. One history table to render
-- and to assert on; the UI filters by scope_kind (+ company_id for company
-- runs) and the restore engine reads scope_kind to choose the restore path.
ALTER TABLE "backup_runs" ADD COLUMN "scope_kind" text DEFAULT 'deployment' NOT NULL;
ALTER TABLE "backup_runs" ADD COLUMN "company_id" integer;
CREATE INDEX "backup_runs_company_scope_idx" ON "backup_runs" USING btree ("company_id","scope_kind");
UPDATE "backup_runs" SET "scope_kind" = 'deployment' WHERE "scope_kind" IS NULL;
