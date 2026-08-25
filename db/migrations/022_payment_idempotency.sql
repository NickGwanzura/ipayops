ALTER TABLE invoice_payments
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_idempotency_idx
  ON invoice_payments (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
