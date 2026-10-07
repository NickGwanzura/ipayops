CREATE TABLE IF NOT EXISTS intertown_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number text NOT NULL,
  sale_id uuid NOT NULL REFERENCES sales(id),
  destination_town text NOT NULL,
  driver_name text NOT NULL,
  driver_phone text NOT NULL,
  vehicle_registration text,
  transport_company text,
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'In transit' CHECK (status IN ('Prepared', 'In transit', 'Delivered', 'Cancelled')),
  driver_fee numeric(14,2) NOT NULL DEFAULT 0 CHECK (driver_fee >= 0),
  payment_status text NOT NULL DEFAULT 'Pending' CHECK (payment_status IN ('Pending', 'Paid')),
  payment_reference text,
  paid_at timestamptz,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  CHECK ((payment_status = 'Paid' AND paid_at IS NOT NULL) OR (payment_status = 'Pending' AND paid_at IS NULL))
);

CREATE TABLE IF NOT EXISTS intertown_dispatch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES intertown_dispatches(id) ON DELETE CASCADE,
  sale_item_id uuid NOT NULL REFERENCES sale_items(id),
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  serial_number text NOT NULL,
  UNIQUE (dispatch_id, sale_item_id)
);

CREATE INDEX IF NOT EXISTS intertown_dispatches_organization_idx ON intertown_dispatches (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS intertown_dispatches_sale_idx ON intertown_dispatches (sale_id);
CREATE INDEX IF NOT EXISTS intertown_dispatch_items_dispatch_idx ON intertown_dispatch_items (dispatch_id);
CREATE INDEX IF NOT EXISTS intertown_dispatch_items_sale_item_idx ON intertown_dispatch_items (sale_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS intertown_dispatch_items_sale_item_unique_idx ON intertown_dispatch_items (sale_item_id);

DROP TRIGGER IF EXISTS tenant_guard_intertown_dispatches ON public.intertown_dispatches;
CREATE TRIGGER tenant_guard_intertown_dispatches BEFORE INSERT OR UPDATE OR DELETE ON public.intertown_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.enforce_direct_tenant_context();
DROP TRIGGER IF EXISTS audit_business_intertown_dispatches ON public.intertown_dispatches;
CREATE TRIGGER audit_business_intertown_dispatches AFTER INSERT OR UPDATE OR DELETE ON public.intertown_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.audit_business_table_change();

DROP TRIGGER IF EXISTS tenant_guard_intertown_dispatch_items ON public.intertown_dispatch_items;
CREATE TRIGGER tenant_guard_intertown_dispatch_items BEFORE INSERT OR UPDATE OR DELETE ON public.intertown_dispatch_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_parent_tenant_context('intertown_dispatches', 'dispatch_id');
DROP TRIGGER IF EXISTS audit_business_intertown_dispatch_items ON public.intertown_dispatch_items;
CREATE TRIGGER audit_business_intertown_dispatch_items AFTER INSERT OR UPDATE OR DELETE ON public.intertown_dispatch_items
  FOR EACH ROW EXECUTE FUNCTION public.audit_business_table_change('intertown_dispatches', 'dispatch_id');
