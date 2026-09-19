-- R-27: TCS (Tax Collected at Source, Income-tax s. 206C) — collection-side
-- mirror of the TDS machinery. Additive only: one new master table, two
-- snapshot columns; no destructive SQL; no accounting-data backfill.
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0011.ts);
-- hand-appended idempotent seed follows the 0009 RCM precedent.
CREATE TABLE "tcs_sections" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"section" text NOT NULL,
	"description" text,
	"rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"threshold" numeric(18, 2) DEFAULT '0' NOT NULL
);
ALTER TABLE "ledgers" ADD COLUMN "tcs_section_id" integer;
ALTER TABLE "voucher_entries" ADD COLUMN "tcs_section_id" integer;
ALTER TABLE "tcs_sections" ADD CONSTRAINT "tcs_sections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "tcs_company_section_uq" ON "tcs_sections" USING btree ("company_id","section");

-- Idempotent seeding: every EXISTING company gets the "TCS Payable" starter
-- ledger (dutyHead='TCS') unless it already has one. The (company_id, name)
-- unique index makes double-insert impossible; WHERE NOT EXISTS makes the
-- statement safe to re-run. Deterministic and additive — no rows updated or
-- deleted, only the one master row added per company. (New companies get the
-- same ledger from seedCompanyTx in code.)
INSERT INTO "ledgers" ("company_id", "name", "group_id", "duty_head", "gst_registration_type", "taxability")
SELECT c.id, 'TCS Payable',
       (SELECT g.id FROM "groups" g WHERE g.company_id = c.id AND g.name = 'Duties & Taxes' LIMIT 1),
       'TCS', 'none', 'none'
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "ledgers" l WHERE l.company_id = c.id AND l.duty_head = 'TCS'
);
