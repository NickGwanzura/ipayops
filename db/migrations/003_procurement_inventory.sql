CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  contact_name text,
  phone text,
  payment_terms text,
  lead_time_days integer NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive', 'Blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS suppliers_organization_idx ON suppliers (organization_id);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number text NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  destination text NOT NULL,
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Pending approval', 'Approved', 'Partially received', 'Fully received', 'Cancelled')),
  currency text NOT NULL DEFAULT 'USD',
  total numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  expected_at date,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);

CREATE INDEX IF NOT EXISTS purchase_orders_organization_idx ON purchase_orders (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  sku text NOT NULL,
  description text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  received_quantity integer NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  unit_cost numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (received_quantity <= quantity)
);

CREATE INDEX IF NOT EXISTS purchase_order_items_order_idx ON purchase_order_items (purchase_order_id);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id),
  number text NOT NULL,
  received_by uuid REFERENCES users(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  UNIQUE (organization_id, number)
);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goods_receipt_id uuid NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  purchase_order_item_id uuid NOT NULL REFERENCES purchase_order_items(id),
  quantity integer NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS goods_receipts_order_idx ON goods_receipts (purchase_order_id, received_at DESC);

CREATE TABLE IF NOT EXISTS inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  purchase_order_item_id uuid REFERENCES purchase_order_items(id),
  serial_number text NOT NULL,
  sku text NOT NULL,
  description text NOT NULL,
  location text NOT NULL,
  status text NOT NULL DEFAULT 'Available' CHECK (status IN ('Available', 'Reserved', 'In transit', 'Sold', 'Installed', 'Warranty', 'Quarantined')),
  client_name text,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, serial_number)
);

CREATE INDEX IF NOT EXISTS inventory_items_organization_status_idx ON inventory_items (organization_id, status);
CREATE INDEX IF NOT EXISTS inventory_items_serial_idx ON inventory_items (organization_id, lower(serial_number));

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  reserved_by uuid REFERENCES users(id),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Released', 'Converted', 'Expired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_reservations_reference_idx ON inventory_reservations (organization_id, reference_type, reference_id);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_reservations_active_item_idx ON inventory_reservations (inventory_item_id) WHERE status = 'Active';
