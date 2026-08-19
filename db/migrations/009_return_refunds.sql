ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS refund_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  ADD COLUMN IF NOT EXISTS refund_status text NOT NULL DEFAULT 'Pending' CHECK (refund_status IN ('Pending', 'Processed', 'Not applicable')),
  ADD COLUMN IF NOT EXISTS refund_method text CHECK (refund_method IN ('Bank transfer', 'Cash', 'Card', 'Mobile money', 'Credit note')),
  ADD COLUMN IF NOT EXISTS refund_reference text,
  ADD COLUMN IF NOT EXISTS credit_note_number text,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

ALTER TABLE consultant_targets
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS returns_refund_status_idx ON returns (organization_id, refund_status, created_at DESC);
