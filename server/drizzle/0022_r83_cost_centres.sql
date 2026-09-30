-- R-83 (F-83-8): Tally F11 Cost Centres — the two-level master
-- (cost_categories -> cost_centres; a NULL category = Tally's "Primary Cost
-- Category"), the per-ledger opt-in (ledgers.track_cost_centre, Tally's
-- "Cost centres are applicable" — default false, every existing ledger
-- unaffected) and the per-row allocation dimension
-- (voucher_cost_allocations, entry-cascade). ADDITIVE ONLY, no destructive
-- SQL, no backfill. An allocation is a DIMENSION of the posting, never a
-- second posting: the voucher write path enforces that a row's allocations
-- sum to the row's signed amount, so the trial balance cannot move.
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0022.ts).
CREATE TABLE "cost_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"updated_at" timestamp with time zone
);
CREATE TABLE "cost_centres" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"category_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"updated_at" timestamp with time zone
);
CREATE TABLE "voucher_cost_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"cost_centre_id" integer NOT NULL,
	"amount" numeric(18, 2) NOT NULL
);
ALTER TABLE "ledgers" ADD COLUMN "track_cost_centre" boolean DEFAULT false NOT NULL;
ALTER TABLE "cost_categories" ADD CONSTRAINT "cost_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "cost_categories" ADD CONSTRAINT "cost_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "cost_categories" ADD CONSTRAINT "cost_categories_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_category_id_cost_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."cost_categories"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "voucher_cost_allocations" ADD CONSTRAINT "voucher_cost_allocations_entry_id_voucher_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."voucher_entries"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "voucher_cost_allocations" ADD CONSTRAINT "voucher_cost_allocations_cost_centre_id_cost_centres_id_fk" FOREIGN KEY ("cost_centre_id") REFERENCES "public"."cost_centres"("id") ON DELETE no action ON UPDATE no action;
CREATE UNIQUE INDEX "cost_cat_company_name_uq" ON "cost_categories" USING btree ("company_id","name");
CREATE UNIQUE INDEX "cost_centre_company_name_uq" ON "cost_centres" USING btree ("company_id","name");
CREATE INDEX "cost_centre_category_idx" ON "cost_centres" USING btree ("category_id");
CREATE INDEX "cost_alloc_entry_idx" ON "voucher_cost_allocations" USING btree ("entry_id");
CREATE INDEX "cost_alloc_centre_idx" ON "voucher_cost_allocations" USING btree ("cost_centre_id");
