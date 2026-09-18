-- R-23: reverse charge mechanism (RCM) — classification groundwork.
-- Additive only: one boolean column; no destructive SQL; no backfill of
-- accounting data (every existing voucher is honestly regular-charge —
-- DEFAULT false expresses exactly that).
-- RCM is marked PER-TRANSACTION, not per-supplier: one supplier can mix
-- regular goods and RCM services (GTA, legal, imports of services), so the
-- voucher is the unit of reverse charge. The self-assessed duty lines are
-- ordinary voucher_entries on a dutyHead='RCM' ledger; this column lets the
-- report distinguish a reverse-charge inward (Table 4(A)(3)) from a
-- supplier-charged one (regular ITC).
ALTER TABLE "vouchers" ADD COLUMN "is_rcm" boolean NOT NULL DEFAULT false;

-- Idempotent seeding: every EXISTING company gets the "RCM Payable" starter
-- ledger (dutyHead='RCM') unless it already has one. The (company_id, name)
-- unique index makes double-insert impossible; WHERE NOT EXISTS makes the
-- statement safe to re-run. Deterministic and additive — no rows updated or
-- deleted, only the one master row added per company. (New companies get the
-- same ledger from seedCompanyTx in code.)
INSERT INTO "ledgers" ("company_id", "name", "group_id", "duty_head", "gst_registration_type", "taxability")
SELECT c.id, 'RCM Payable',
       (SELECT g.id FROM "groups" g WHERE g.company_id = c.id AND g.name = 'Duties & Taxes' LIMIT 1),
       'RCM', 'none', 'none'
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "ledgers" l WHERE l.company_id = c.id AND l.duty_head = 'RCM'
);
