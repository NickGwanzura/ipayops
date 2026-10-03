-- Invoices were created without a due date, so overdue tracking never triggered. Backfill open invoices with the
-- default 30-day term; new invoices get their due date at creation (INVOICE_PAYMENT_TERMS_DAYS).
UPDATE invoices SET due_at = (issued_at::date + 30) WHERE due_at IS NULL AND status IN ('Issued', 'Draft');
