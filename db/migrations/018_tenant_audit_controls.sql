CREATE OR REPLACE FUNCTION public.enforce_direct_tenant_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  setting_value text;
  context_organization_id uuid;
  row_organization_id uuid;
BEGIN
  setting_value := NULLIF(current_setting('app.organization_id', true), '');
  IF setting_value IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  BEGIN
    context_organization_id := setting_value::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid app.organization_id transaction setting.' USING ERRCODE = '22023';
  END;

  row_organization_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  IF row_organization_id IS NULL OR row_organization_id <> context_organization_id THEN
    RAISE EXCEPTION 'Tenant mutation rejected for table %.', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_parent_tenant_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  setting_value text;
  context_organization_id uuid;
  parent_organization_id uuid;
  parent_id uuid;
  child_data jsonb;
  foreign_key_value text;
BEGIN
  setting_value := NULLIF(current_setting('app.organization_id', true), '');
  IF setting_value IS NOT NULL THEN
    BEGIN
      context_organization_id := setting_value::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid app.organization_id transaction setting.' USING ERRCODE = '22023';
    END;
  END IF;

  child_data := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  foreign_key_value := NULLIF(child_data ->> TG_ARGV[1], '');
  IF foreign_key_value IS NULL THEN
    RAISE EXCEPTION 'Referenced parent %.% cannot be resolved.', TG_ARGV[0], TG_ARGV[1] USING ERRCODE = '23503';
  END IF;

  BEGIN
    parent_id := foreign_key_value::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Referenced parent %.% cannot be resolved.', TG_ARGV[0], TG_ARGV[1] USING ERRCODE = '23503';
  END;

  EXECUTE format('SELECT organization_id FROM public.%I WHERE id = $1', TG_ARGV[0])
    INTO parent_organization_id
    USING parent_id;
  IF NOT FOUND OR parent_organization_id IS NULL THEN
    -- ON DELETE CASCADE removes the parent before this child trigger runs.
    -- A normal child delete must still resolve its parent below.
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Referenced parent %.% cannot be resolved.', TG_ARGV[0], TG_ARGV[1] USING ERRCODE = '23503';
  END IF;

  IF setting_value IS NOT NULL AND parent_organization_id <> context_organization_id THEN
    RAISE EXCEPTION 'Tenant mutation rejected for child table %.', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_business_table_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  row_data jsonb;
  old_data jsonb;
  new_data jsonb;
  organization_id_value text;
  organization_id uuid;
  actor_setting text;
  actor_user_id uuid;
  fallback_user_id text;
  entity_id uuid;
  changed_columns jsonb := '[]'::jsonb;
  parent_id uuid;
  parent_organization_id uuid;
  foreign_key_value text;
BEGIN
  row_data := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  IF TG_OP = 'UPDATE' THEN
    old_data := to_jsonb(OLD);
    new_data := to_jsonb(NEW);
    SELECT COALESCE(jsonb_agg(column_name ORDER BY column_name), '[]'::jsonb)
      INTO changed_columns
      FROM (
        SELECT column_name
        FROM jsonb_object_keys(old_data || new_data) AS keys(column_name)
        WHERE old_data -> column_name IS DISTINCT FROM new_data -> column_name
      ) AS changed;
  END IF;

  IF TG_NARGS >= 2 THEN
    foreign_key_value := NULLIF(row_data ->> TG_ARGV[1], '');
    IF foreign_key_value IS NULL THEN
      RAISE EXCEPTION 'Referenced parent %.% cannot be resolved.', TG_ARGV[0], TG_ARGV[1] USING ERRCODE = '23503';
    END IF;
    BEGIN
      parent_id := foreign_key_value::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Referenced parent %.% cannot be resolved.', TG_ARGV[0], TG_ARGV[1] USING ERRCODE = '23503';
    END;
    EXECUTE format('SELECT organization_id FROM public.%I WHERE id = $1', TG_ARGV[0])
      INTO parent_organization_id
      USING parent_id;
    IF NOT FOUND OR parent_organization_id IS NULL THEN
      -- ON DELETE CASCADE removes the parent before this child audit trigger
      -- runs. Do not create a dangling audit row or abort the cascade.
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'Referenced parent %.% cannot be resolved.', TG_ARGV[0], TG_ARGV[1] USING ERRCODE = '23503';
    END IF;
    organization_id_value := parent_organization_id::text;
  ELSE
    organization_id_value := NULLIF(row_data ->> 'organization_id', '');
  END IF;

  BEGIN
    organization_id := organization_id_value::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    organization_id := NULL;
  END;

  actor_setting := NULLIF(current_setting('app.actor_user_id', true), '');
  BEGIN
    actor_user_id := actor_setting::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    actor_user_id := NULL;
  END;

  IF actor_user_id IS NULL THEN
    FOREACH fallback_user_id IN ARRAY ARRAY[
      NULLIF(row_data ->> 'created_by', ''),
      NULLIF(row_data ->> 'requested_by', ''),
      NULLIF(row_data ->> 'uploaded_by', ''),
      NULLIF(row_data ->> 'updated_by', '')
    ] LOOP
      BEGIN
        actor_user_id := fallback_user_id::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        actor_user_id := NULL;
      END;
      EXIT WHEN actor_user_id IS NOT NULL;
    END LOOP;
  END IF;

  BEGIN
    entity_id := COALESCE(row_data ->> 'id', row_data ->> 'organization_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    entity_id := NULL;
  END;

  -- A cascading organization delete removes the parent row before the child
  -- audit trigger runs. Do not insert an audit row that would reference that
  -- row and abort the cascade; ordinary business deletes still insert below.
  IF TG_OP = 'DELETE'
     AND organization_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.organizations AS organization_row WHERE organization_row.id = organization_id)
  THEN
    RETURN OLD;
  END IF;

  INSERT INTO public.audit_logs (
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) VALUES (
    organization_id,
    actor_user_id,
    'db.' || lower(TG_OP),
    TG_TABLE_NAME,
    entity_id,
    jsonb_build_object(
      'source', 'database_trigger',
      'operation', lower(TG_OP),
      'changedColumns', changed_columns
    )
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organization_id'
      AND c.table_name NOT IN ('audit_logs', 'rate_limit_buckets', 'sessions', 'schema_migrations')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tenant_guard_%I ON public.%I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER tenant_guard_%I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_direct_tenant_context()',
      table_name,
      table_name
    );
    EXECUTE format('DROP TRIGGER IF EXISTS audit_business_%I ON public.%I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER audit_business_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_business_table_change()',
      table_name,
      table_name
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  child_table text;
  parent_table text;
  foreign_key_column text;
BEGIN
  FOR child_table, parent_table, foreign_key_column IN
    VALUES
      ('purchase_order_items', 'purchase_orders', 'purchase_order_id'),
      ('goods_receipt_items', 'goods_receipts', 'goods_receipt_id'),
      ('stock_transfer_items', 'stock_transfers', 'transfer_id'),
      ('quotation_items', 'quotations', 'quotation_id'),
      ('sale_items', 'sales', 'sale_id'),
      ('return_items', 'returns', 'return_id'),
      ('job_card_items', 'job_cards', 'job_card_id'),
      ('invoice_items', 'invoices', 'invoice_id'),
      ('delivery_note_items', 'delivery_notes', 'delivery_note_id')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tenant_guard_%I ON public.%I', child_table, child_table);
    EXECUTE format(
      'CREATE TRIGGER tenant_guard_%I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_parent_tenant_context(%L, %L)',
      child_table,
      child_table,
      parent_table,
      foreign_key_column
    );
    EXECUTE format('DROP TRIGGER IF EXISTS audit_business_%I ON public.%I', child_table, child_table);
    EXECUTE format(
      'CREATE TRIGGER audit_business_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_business_table_change(%L, %L)',
      child_table,
      child_table,
      parent_table,
      foreign_key_column
    );
  END LOOP;
END;
$$;
