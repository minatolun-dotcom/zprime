-- R-28: IRP/EWB connectivity (opt-in) — per-company credentials stored
-- AES-256-GCM encrypted at rest, and the submission ledger that satisfies the
-- legal duty to persist the IRN ("an invoice without IRN will not be a legal
-- document"). Additive only: two new tables; no destructive SQL; no data
-- backfill (no company has credentials until an operator configures them).
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0012.ts).
CREATE TABLE "irp_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_enc" text NOT NULL,
	"gstin" text NOT NULL,
	"username" text NOT NULL,
	"password_enc" text NOT NULL,
	"public_key_pem" text,
	"endpoint_override" text,
	"created_by" integer,
	"updated_by" integer,
	"updated_at" timestamp with time zone
);
CREATE TABLE "irp_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"voucher_id" integer,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"irn" text,
	"ack_no" text,
	"ack_date" text,
	"ewb_no" text,
	"ewb_valid_until" text,
	"response" jsonb,
	"error" jsonb,
	"requested_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "irp_credentials" ADD CONSTRAINT "irp_credentials_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "irp_credentials" ADD CONSTRAINT "irp_credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "irp_credentials" ADD CONSTRAINT "irp_credentials_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "irp_submissions" ADD CONSTRAINT "irp_submissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "irp_submissions" ADD CONSTRAINT "irp_submissions_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "irp_submissions" ADD CONSTRAINT "irp_submissions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
CREATE UNIQUE INDEX "irp_creds_company_env_uq" ON "irp_credentials" USING btree ("company_id","environment");
CREATE INDEX "irp_subs_company_created_idx" ON "irp_submissions" USING btree ("company_id","created_at");
CREATE UNIQUE INDEX "irp_subs_accepted_uq" ON "irp_submissions" USING btree ("voucher_id","kind") WHERE status = 'accepted';
CREATE UNIQUE INDEX "irp_subs_pending_uq" ON "irp_submissions" USING btree ("voucher_id","kind") WHERE status = 'pending';
