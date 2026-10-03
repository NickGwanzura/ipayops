-- Commission already paid out cannot be reduced in place; returns record the amount to recover instead.
ALTER TABLE commission_entries
  ADD COLUMN IF NOT EXISTS clawback_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (clawback_amount >= 0);
