-- Privileged-account TOTP MFA with encrypted secrets and hash-only recovery codes.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS mfa_assured boolean NOT NULL DEFAULT false;

UPDATE sessions
SET mfa_assured = false
WHERE mfa_assured IS NULL;

ALTER TABLE sessions
  ALTER COLUMN mfa_assured SET DEFAULT false,
  ALTER COLUMN mfa_assured SET NOT NULL;

-- Sessions that existed before privileged MFA cannot carry assurance. Remove
-- current privileged sessions at migration time so they must authenticate again.
DELETE FROM sessions s
USING users u
WHERE u.id = s.user_id
  AND u.role IN ('ceo', 'finance');

CREATE OR REPLACE FUNCTION public.invalidate_privileged_role_sessions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND (NEW.role IN ('ceo', 'finance') OR OLD.role IN ('ceo', 'finance')) THEN
    DELETE FROM public.sessions WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invalidate_privileged_role_sessions ON public.users;
CREATE TRIGGER invalidate_privileged_role_sessions
  AFTER UPDATE OF role ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_privileged_role_sessions();

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_secret_encrypted text,
  ADD COLUMN IF NOT EXISTS mfa_enabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS mfa_recovery_code_hashes jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE users
SET mfa_recovery_code_hashes = '[]'::jsonb
WHERE mfa_recovery_code_hashes IS NULL;

ALTER TABLE users
  ALTER COLUMN mfa_recovery_code_hashes SET DEFAULT '[]'::jsonb,
  ALTER COLUMN mfa_recovery_code_hashes SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND conname = 'users_mfa_recovery_code_hashes_array_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_mfa_recovery_code_hashes_array_check
      CHECK (jsonb_typeof(mfa_recovery_code_hashes) = 'array');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS mfa_login_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  remember boolean NOT NULL DEFAULT false,
  kind text NOT NULL CHECK (kind IN ('enroll', 'verify')),
  pending_secret_encrypted text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 8),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mfa_login_challenges_user_organization_fk
    FOREIGN KEY (user_id, organization_id)
    REFERENCES users(id, organization_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS mfa_login_challenges_user_active_idx
  ON mfa_login_challenges (user_id, created_at DESC)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS mfa_login_challenges_expiry_active_idx
  ON mfa_login_challenges (expires_at)
  WHERE consumed_at IS NULL;

DO $$
BEGIN
  IF to_regprocedure('public.enforce_direct_tenant_context()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_guard_mfa_login_challenges ON public.mfa_login_challenges;
    CREATE TRIGGER tenant_guard_mfa_login_challenges
      BEFORE INSERT OR UPDATE OR DELETE ON public.mfa_login_challenges
      FOR EACH ROW EXECUTE FUNCTION public.enforce_direct_tenant_context();
  END IF;

  IF to_regprocedure('public.audit_business_table_change()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS audit_business_mfa_login_challenges ON public.mfa_login_challenges;
    CREATE TRIGGER audit_business_mfa_login_challenges
      AFTER INSERT OR UPDATE OR DELETE ON public.mfa_login_challenges
      FOR EACH ROW EXECUTE FUNCTION public.audit_business_table_change();
  END IF;
END $$;
