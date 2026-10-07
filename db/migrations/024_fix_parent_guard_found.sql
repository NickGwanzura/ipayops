-- PL/pgSQL does not set FOUND after EXECUTE ... INTO, so "IF NOT FOUND" was always true and every insert into a
-- guarded child table (quotation_items, sale_items, purchase_order_items, ...) was rejected. Detect a missing parent
-- from the NULL result instead.

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
  IF parent_organization_id IS NULL THEN
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
    IF parent_organization_id IS NULL THEN
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
