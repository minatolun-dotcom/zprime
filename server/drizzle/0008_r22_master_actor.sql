-- R-22: master-table actor provance — replicate the R-17 voucher actor columns
-- on the master tables that have a user-facing creation/mutation surface.
-- Additive only: three nullable columns per table; existing rows keep NULL
-- (honest "before actor provance existed" state — fabricating actor values is
-- worse than null). No destructive SQL, no backfill. System-seeded rows
-- (reserved groups, starter ledgers, voucher types, TDS sections) stay NULL
-- by design: no authenticated actor exists at seeding time, and fabricating
-- one would be dishonest. FK behavior mirrors R-17/R-02: ON DELETE SET NULL,
-- so deleting a user never blocks or destroys master history.
ALTER TABLE "groups" ADD COLUMN "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "groups" ADD COLUMN "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "groups" ADD COLUMN "updated_at" timestamp with time zone;

ALTER TABLE "ledgers" ADD COLUMN "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "ledgers" ADD COLUMN "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "ledgers" ADD COLUMN "updated_at" timestamp with time zone;

ALTER TABLE "units" ADD COLUMN "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "units" ADD COLUMN "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "units" ADD COLUMN "updated_at" timestamp with time zone;

ALTER TABLE "stock_groups" ADD COLUMN "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "stock_groups" ADD COLUMN "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "stock_groups" ADD COLUMN "updated_at" timestamp with time zone;

ALTER TABLE "stock_categories" ADD COLUMN "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "stock_categories" ADD COLUMN "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "stock_categories" ADD COLUMN "updated_at" timestamp with time zone;

ALTER TABLE "godowns" ADD COLUMN "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "godowns" ADD COLUMN "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "godowns" ADD COLUMN "updated_at" timestamp with time zone;

ALTER TABLE "stock_items" ADD COLUMN "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "stock_items" ADD COLUMN "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "stock_items" ADD COLUMN "updated_at" timestamp with time zone;

ALTER TABLE "employees" ADD COLUMN "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "employees" ADD COLUMN "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "employees" ADD COLUMN "updated_at" timestamp with time zone;

ALTER TABLE "pay_heads" ADD COLUMN "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "pay_heads" ADD COLUMN "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "pay_heads" ADD COLUMN "updated_at" timestamp with time zone;
