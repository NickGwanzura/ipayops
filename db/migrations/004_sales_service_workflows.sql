CREATE TABLE IF NOT EXISTS stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number text NOT NULL,
  source_location text NOT NULL,
  destination_location text NOT NULL,
  status text NOT NULL DEFAULT 'In transit' CHECK (status IN ('In transit', 'Received', 'Cancelled')),
  created_by uuid REFERENCES users(id),
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  CHECK (source_location <> destination_location)
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  serial_number text NOT NULL,
  sku text NOT NULL,
  description text NOT NULL,
  UNIQUE (transfer_id, inventory_item_id)
);

CREATE INDEX IF NOT EXISTS stock_transfers_organization_idx ON stock_transfers (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_transfer_items_transfer_idx ON stock_transfer_items (transfer_id);

CREATE TABLE IF NOT EXISTS shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number text NOT NULL,
  transfer_id uuid REFERENCES stock_transfers(id),
  sale_id uuid,
  carrier text,
  tracking_number text,
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Dispatched', 'In transit', 'Delivered', 'Cancelled')),
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  CHECK (transfer_id IS NOT NULL OR sale_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS shipments_organization_idx ON shipments (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  client_type text NOT NULL DEFAULT 'Organisation' CHECK (client_type IN ('Person', 'Organisation')),
  contact_name text,
  email text,
  phone text,
  address text,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id),
  name text NOT NULL,
  source text,
  status text NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'Qualified', 'Converted', 'Lost')),
  owner_id uuid REFERENCES users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id),
  lead_id uuid REFERENCES leads(id),
  name text NOT NULL,
  stage text NOT NULL DEFAULT 'Discovery' CHECK (stage IN ('Discovery', 'Qualified', 'Quotation', 'Negotiation', 'Won', 'Lost')),
  value numeric(14,2) NOT NULL DEFAULT 0 CHECK (value >= 0),
  owner_id uuid REFERENCES users(id),
  expected_close date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number text NOT NULL,
  client_id uuid NOT NULL REFERENCES clients(id),
  opportunity_id uuid REFERENCES opportunities(id),
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Sent', 'Accepted', 'Expired', 'Converted', 'Cancelled')),
  currency text NOT NULL DEFAULT 'USD',
  total numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  valid_until date,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);

CREATE TABLE IF NOT EXISTS quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  sku text NOT NULL,
  description text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number text NOT NULL,
  quotation_id uuid UNIQUE REFERENCES quotations(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  status text NOT NULL DEFAULT 'Confirmed' CHECK (status IN ('Confirmed', 'Partially returned', 'Returned', 'Cancelled')),
  currency text NOT NULL DEFAULT 'USD',
  total numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);

CREATE TABLE IF NOT EXISTS sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  quotation_item_id uuid REFERENCES quotation_items(id),
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  serial_number text NOT NULL,
  sku text NOT NULL,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  returned boolean NOT NULL DEFAULT false,
  UNIQUE (sale_id, inventory_item_id)
);

CREATE TABLE IF NOT EXISTS returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number text NOT NULL,
  sale_id uuid NOT NULL REFERENCES sales(id),
  status text NOT NULL DEFAULT 'Completed' CHECK (status IN ('Requested', 'Approved', 'Completed', 'Rejected')),
  reason text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);

CREATE TABLE IF NOT EXISTS return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  sale_item_id uuid NOT NULL REFERENCES sale_items(id),
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  condition text NOT NULL DEFAULT 'Good' CHECK (condition IN ('Good', 'Damaged', 'Quarantined')),
  UNIQUE (return_id, sale_item_id)
);

CREATE INDEX IF NOT EXISTS clients_organization_idx ON clients (organization_id, name);
CREATE INDEX IF NOT EXISTS leads_organization_idx ON leads (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS opportunities_organization_idx ON opportunities (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quotations_organization_idx ON quotations (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_organization_idx ON sales (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS returns_organization_idx ON returns (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS job_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number text NOT NULL,
  client_id uuid NOT NULL REFERENCES clients(id),
  sale_id uuid REFERENCES sales(id),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled', 'In progress', 'Completed', 'Cancelled')),
  installer_id uuid REFERENCES users(id),
  scheduled_for timestamptz,
  notes text,
  signoff_name text,
  signoff_notes text,
  signed_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);

CREATE TABLE IF NOT EXISTS job_card_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_card_id uuid NOT NULL REFERENCES job_cards(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  serial_number text NOT NULL,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  configuration_notes text,
  UNIQUE (job_card_id, inventory_item_id)
);

CREATE TABLE IF NOT EXISTS warranty_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL UNIQUE REFERENCES inventory_items(id),
  client_id uuid REFERENCES clients(id),
  sale_id uuid REFERENCES sales(id),
  starts_at date NOT NULL,
  expires_at date NOT NULL,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Expired', 'Voided')),
  terms text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at >= starts_at)
);

CREATE TABLE IF NOT EXISTS warranty_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number text NOT NULL,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  client_id uuid REFERENCES clients(id),
  warranty_contract_id uuid REFERENCES warranty_contracts(id),
  status text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Under assessment', 'Approved', 'Repair', 'Replacement', 'Resolved', 'Rejected')),
  issue text NOT NULL,
  resolution text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);

CREATE TABLE IF NOT EXISTS repair_requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number text NOT NULL,
  claim_id uuid NOT NULL REFERENCES warranty_claims(id) ON DELETE CASCADE,
  description text NOT NULL,
  estimated_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (estimated_cost >= 0),
  status text NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested', 'Approved', 'Issued', 'Completed', 'Cancelled')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);

CREATE TABLE IF NOT EXISTS replacement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES warranty_claims(id) ON DELETE CASCADE,
  original_inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  replacement_inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (claim_id)
);

CREATE INDEX IF NOT EXISTS job_cards_organization_idx ON job_cards (organization_id, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS warranty_contracts_organization_idx ON warranty_contracts (organization_id, expires_at);
CREATE INDEX IF NOT EXISTS warranty_claims_organization_idx ON warranty_claims (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS repair_requisitions_organization_idx ON repair_requisitions (organization_id, created_at DESC);
