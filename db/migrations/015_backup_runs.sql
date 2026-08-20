CREATE TABLE IF NOT EXISTS backup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  storage_key text,
  size_bytes bigint CHECK (size_bytes >= 0),
  checksum_sha256 text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS backup_runs_organization_created_idx
  ON backup_runs (organization_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS backup_runs_active_organization_idx
  ON backup_runs (organization_id)
  WHERE status IN ('pending', 'running');
