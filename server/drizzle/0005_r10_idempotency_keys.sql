-- R-10 (B-10): server-side idempotency for voucher creation.
-- Additive only: one new table; no existing column changes, no destructive SQL,
-- no data backfill needed (existing vouchers keep working; the key is optional
-- per request). A client-generated key identifies ONE business event — replaying
-- it returns the ORIGINAL voucher instead of posting a duplicate. The unique
-- index on (company_id, key) is the final authority under concurrency, exactly
-- like the voucher-number unique index.
--
-- FK cascade notes:
--   company deleted  -> keys die with the company
--   voucher deleted  -> key rows die with it (the event is gone; a replay would
--                       then legitimately create a NEW voucher — deletion of a
--                       voucher via the R-02 rules is itself a deliberate act)

CREATE TABLE "idempotency_keys" (
	"id" serial PRIMARY KEY,
	"company_id" integer NOT NULL,
	"key" text NOT NULL,
	"voucher_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "idempotency_keys_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_company_key_uq" ON "idempotency_keys" USING btree ("company_id","key");--> statement-breakpoint
