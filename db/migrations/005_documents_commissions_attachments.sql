ALTER TABLE sales ADD COLUMN IF NOT EXISTS consultant_id uuid REFERENCES users(id);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number text NOT NULL,
  sale_id uuid NOT NULL UNIQUE REFERENCES sales(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  status text NOT NULL DEFAULT 'Issued' CHECK (status IN ('Draft', 'Issued', 'Paid', 'Void')),
  currency text NOT NULL DEFAULT 'USD',
  total numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_at date,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  sale_item_id uuid REFERENCES sale_items(id),
  description text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0)
);

CREATE TABLE IF NOT EXISTS delivery_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number text NOT NULL,
  sale_id uuid NOT NULL UNIQUE REFERENCES sales(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Dispatched', 'Delivered', 'Cancelled')),
  delivery_address text,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);

CREATE TABLE IF NOT EXISTS delivery_note_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_note_id uuid NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
  sale_item_id uuid NOT NULL REFERENCES sale_items(id),
  serial_number text NOT NULL,
  description text NOT NULL
);

CREATE TABLE IF NOT EXISTS commission_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES sales(id),
  consultant_id uuid REFERENCES users(id),
  rate numeric(6,3) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'Provisional' CHECK (status IN ('Provisional', 'Approved', 'Paid', 'Voided')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('job', 'claim')),
  entity_id uuid NOT NULL,
  file_name text NOT NULL,
  storage_key text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoices_organization_idx ON invoices (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_notes_organization_idx ON delivery_notes (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS commission_entries_organization_idx ON commission_entries (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS attachments_entity_idx ON attachments (organization_id, entity_type, entity_id, created_at DESC);
