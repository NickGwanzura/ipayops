CREATE TABLE IF NOT EXISTS supplier_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_type text NOT NULL CHECK (product_type IN ('Laptop', 'POS')),
  product_name text NOT NULL,
  manufacturer text,
  model text,
  sku text NOT NULL,
  warranty_months integer NOT NULL DEFAULT 12 CHECK (warranty_months >= 0 AND warranty_months <= 120),
  unit_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  cost_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  selling_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  currency text NOT NULL DEFAULT 'USD',
  serial_required boolean NOT NULL DEFAULT true CHECK (serial_required = true),
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, supplier_id, sku)
);

CREATE INDEX IF NOT EXISTS supplier_products_organization_idx ON supplier_products (organization_id, status, product_type);

UPDATE supplier_products SET cost_price = unit_cost WHERE cost_price = 0 AND unit_cost > 0;

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS supplier_product_id uuid REFERENCES supplier_products(id),
  ADD COLUMN IF NOT EXISTS product_type text CHECK (product_type IN ('Laptop', 'POS')),
  ADD COLUMN IF NOT EXISTS serial_required boolean NOT NULL DEFAULT true CHECK (serial_required = true);

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS product_type text CHECK (product_type IN ('Laptop', 'POS')),
  ADD COLUMN IF NOT EXISTS supplier_product_id uuid REFERENCES supplier_products(id),
  ADD COLUMN IF NOT EXISTS cost_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  ADD COLUMN IF NOT EXISTS selling_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (selling_price >= 0);

ALTER TABLE repair_requisitions
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES inventory_items(id);

UPDATE repair_requisitions rr
SET inventory_item_id = wc.inventory_item_id
FROM warranty_claims wc
WHERE rr.claim_id = wc.id AND rr.inventory_item_id IS NULL;

ALTER TABLE expense_claims
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES inventory_items(id),
  ADD COLUMN IF NOT EXISTS replacement_item_id uuid REFERENCES replacement_items(id),
  ADD COLUMN IF NOT EXISTS repair_requisition_id uuid REFERENCES repair_requisitions(id),
  ADD COLUMN IF NOT EXISTS serial_number_snapshot text;

CREATE INDEX IF NOT EXISTS expense_claims_inventory_item_idx ON expense_claims (organization_id, inventory_item_id);
CREATE INDEX IF NOT EXISTS expense_claims_replacement_idx ON expense_claims (organization_id, replacement_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_organization_serial_ci_idx ON inventory_items (organization_id, lower(serial_number));

ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS purchase_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (purchase_cost >= 0),
  ADD COLUMN IF NOT EXISTS selling_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (selling_price >= 0);

ALTER TABLE quotation_items
  ADD COLUMN IF NOT EXISTS supplier_product_id uuid REFERENCES supplier_products(id),
  ADD COLUMN IF NOT EXISTS product_type text CHECK (product_type IN ('Laptop', 'POS'));
