-- R-84 (A1): Tally's deposit-slip "printed" bookkeeping — the timestamp
-- when an operator printed this voucher's bank leg on a (cash/cheque) deposit
-- slip. NULL = never printed (every pre-R-84 row). The Deposit Slips page
-- lists unreconciled legs by default and can include printed ones (Tally's
-- F8 Incl-Printed parity). Operator-action-stamped only, never inferred.
-- Generated via drizzle-kit's programmatic API (see scripts/gen-0023.ts).
ALTER TABLE "vouchers" ADD COLUMN "deposit_slip_printed_at" timestamp with time zone;
