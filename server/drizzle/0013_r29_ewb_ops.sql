-- R-29: EWB lifecycle operations — verbatim ledger of vehicle updates,
-- validity extensions, and cancellations against accepted e-way bills.
-- Additive only: one new table; no destructive SQL; no data backfill (no ops
-- can exist until an operator performs one). The 'cancelled' submission
-- status is a TEXT value, not DDL — documented in schema.ts.
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0013.ts).
CREATE TABLE "irp_ewb_ops" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"submission_id" integer,
	"op" text NOT NULL,
	"request" jsonb,
	"response" jsonb,
	"error" jsonb,
	"requested_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "irp_ewb_ops" ADD CONSTRAINT "irp_ewb_ops_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "irp_ewb_ops" ADD CONSTRAINT "irp_ewb_ops_submission_id_irp_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."irp_submissions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "irp_ewb_ops" ADD CONSTRAINT "irp_ewb_ops_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "irp_ewb_ops_submission_idx" ON "irp_ewb_ops" USING btree ("submission_id","created_at");
