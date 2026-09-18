-- R-24: e-invoice payload generation — the one schema gap.
-- The NIC v1.01 BuyerDtls block mandates a 6-digit PIN code; the company
-- (seller) pincode already exists, the party (buyer) pincode does not.
-- Additive only: one nullable text column; no backfill (pre-R-24 ledgers
-- honestly have no pincode until the operator sets one — the payload
-- validator reports it, it never guesses).
ALTER TABLE "ledgers" ADD COLUMN "party_pincode" text;
