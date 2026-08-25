-- Hash-only password recovery tokens with tenant and audit protection.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND conname = 'users_id_organization_key'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_id_organization_key UNIQUE (id, organization_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT password_reset_tokens_user_organization_fk
    FOREIGN KEY (user_id, organization_id)
    REFERENCES users(id, organization_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_active_idx
  ON password_reset_tokens (user_id, created_at DESC)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_cleanup_idx
  ON password_reset_tokens (expires_at)
  WHERE used_at IS NULL;

DO $$
BEGIN
  IF to_regprocedure('public.enforce_direct_tenant_context()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_guard_password_reset_tokens ON public.password_reset_tokens;
    CREATE TRIGGER tenant_guard_password_reset_tokens
      BEFORE INSERT OR UPDATE OR DELETE ON public.password_reset_tokens
      FOR EACH ROW EXECUTE FUNCTION public.enforce_direct_tenant_context();
  END IF;

  IF to_regprocedure('public.audit_business_table_change()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS audit_business_password_reset_tokens ON public.password_reset_tokens;
    CREATE TRIGGER audit_business_password_reset_tokens
      AFTER INSERT OR UPDATE OR DELETE ON public.password_reset_tokens
      FOR EACH ROW EXECUTE FUNCTION public.audit_business_table_change();
  END IF;
END $$;
