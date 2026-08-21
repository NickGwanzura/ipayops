CREATE TABLE IF NOT EXISTS user_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('ceo', 'manager', 'finance', 'sales_consultant')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_count integer NOT NULL DEFAULT 1 CHECK (sent_count >= 1),
  accepted_at timestamptz,
  accepted_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX IF NOT EXISTS user_invitations_organization_idx
  ON user_invitations (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_invitations_token_idx
  ON user_invitations (token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS user_invitations_active_email_idx
  ON user_invitations (lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
