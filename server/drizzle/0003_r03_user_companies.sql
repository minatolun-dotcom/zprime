-- R-03: user -> company authorization (Model C membership junction).
-- Additive only: no existing column changes, no destructive SQL.
-- Authorization boundary: cid() joins membership server-side per request.

CREATE TABLE "user_companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_companies_user_company_uq" ON "user_companies" USING btree ("user_id","company_id");--> statement-breakpoint
CREATE INDEX "user_companies_company_id_idx" ON "user_companies" USING btree ("company_id");--> statement-breakpoint

-- Backfill. v1.2.0's effective access model was "every authenticated user can
-- access every company" (authorization did not exist). This backfill therefore
-- grants every EXISTING user an owner membership on every EXISTING company:
-- deterministic, nobody loses access they had before the upgrade, and no
-- privilege above the pre-R-03 status quo is granted. Companies/users created
-- AFTER this migration go through the API, which grants only explicit
-- memberships. Single-user deployments (the documented norm) end with the
-- seeded admin owning every company.
INSERT INTO "user_companies" ("user_id", "company_id", "role")
SELECT u.id, c.id, 'owner' FROM "users" u CROSS JOIN "companies" c;--> statement-breakpoint

-- cancelled_by (v1.2.0) now has an authoritative identity target. A deleted
-- user must not block voucher reads: keep the value nullable and null it on
-- user deletion (no user-deletion route exists today; future-proofing only).
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;