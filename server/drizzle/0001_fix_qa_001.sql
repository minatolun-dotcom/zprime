CREATE TABLE "voucher_counters" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"voucher_type_id" integer NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voucher_counters" ADD CONSTRAINT "voucher_counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_counters" ADD CONSTRAINT "voucher_counters_voucher_type_id_voucher_types_id_fk" FOREIGN KEY ("voucher_type_id") REFERENCES "public"."voucher_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "counter_company_type_uq" ON "voucher_counters" USING btree ("company_id","voucher_type_id");--> statement-breakpoint

-- Legacy dedupe (pre-fix data): rename duplicate (company, voucher type, number)
-- vouchers, keeping the earliest. The unique index below then always succeeds.
WITH dups AS (
  SELECT id, row_number() OVER (PARTITION BY company_id, voucher_type_id, number ORDER BY id) AS rn
  FROM vouchers
)
UPDATE vouchers SET number = vouchers.number || '~DUP' || (dups.rn - 1)
FROM dups
WHERE vouchers.id = dups.id AND dups.rn > 1;--> statement-breakpoint

-- Backfill counters: for every (company, voucher type) with existing vouchers,
-- set last_number to at least the highest numeric tail found in voucher
-- numbers (prefix/suffix-aware, non-numeric tails ignored). Overestimation is
-- safe (numbering skips forward); underestimation would risk collisions.
INSERT INTO voucher_counters (company_id, voucher_type_id, last_number)
SELECT g.company_id, g.voucher_type_id, g.maxn
FROM (
  SELECT v.company_id, v.voucher_type_id,
    GREATEST(
      vt.start_number - 1,
      COALESCE(MAX(CASE
        WHEN substring(v.number FROM greatest(length(vt.prefix), 0) + 1 FOR greatest(length(v.number) - length(vt.prefix) - length(vt.suffix), 0)) ~ '^\d+$'
        THEN (substring(v.number FROM greatest(length(vt.prefix), 0) + 1 FOR greatest(length(v.number) - length(vt.prefix) - length(vt.suffix), 0)))::int
        ELSE 0 END), 0)
    ) AS maxn
  FROM vouchers v
  JOIN voucher_types vt ON vt.id = v.voucher_type_id
  GROUP BY v.company_id, v.voucher_type_id, vt.start_number
) AS g
ON CONFLICT (company_id, voucher_type_id) DO UPDATE
SET last_number = GREATEST(voucher_counters.last_number, EXCLUDED.last_number);--> statement-breakpoint

-- The database is the final authority on voucher numbering.
CREATE UNIQUE INDEX "vouchers_company_type_number_uq" ON "vouchers" USING btree ("company_id","voucher_type_id","number");
