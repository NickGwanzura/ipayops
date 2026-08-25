-- Durable notification and backup work queues.

ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE notification_deliveries
SET payload = COALESCE(payload, '{}'::jsonb),
    attempts = COALESCE(attempts, 0),
    max_attempts = COALESCE(max_attempts, 5),
    available_at = COALESCE(available_at, created_at, now()),
    updated_at = COALESCE(updated_at, created_at, now());

ALTER TABLE notification_deliveries
  ALTER COLUMN payload SET DEFAULT '{}'::jsonb,
  ALTER COLUMN payload SET NOT NULL,
  ALTER COLUMN attempts SET DEFAULT 0,
  ALTER COLUMN attempts SET NOT NULL,
  ALTER COLUMN max_attempts SET DEFAULT 5,
  ALTER COLUMN max_attempts SET NOT NULL,
  ALTER COLUMN available_at SET DEFAULT now(),
  ALTER COLUMN available_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'notification_deliveries'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE notification_deliveries DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'notification_deliveries'::regclass
      AND conname = 'notification_deliveries_status_check'
  ) THEN
    ALTER TABLE notification_deliveries
      ADD CONSTRAINT notification_deliveries_status_check
      CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'not_configured'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS notification_deliveries_claim_idx
  ON notification_deliveries (available_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS notification_deliveries_processing_lock_idx
  ON notification_deliveries (locked_at)
  WHERE status = 'processing';

ALTER TABLE backup_runs
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE backup_runs
SET attempts = COALESCE(attempts, 0),
    max_attempts = COALESCE(max_attempts, 3),
    available_at = COALESCE(available_at, created_at, now()),
    locked_at = COALESCE(locked_at, started_at),
    updated_at = COALESCE(updated_at, created_at, now());

ALTER TABLE backup_runs
  ALTER COLUMN attempts SET DEFAULT 0,
  ALTER COLUMN attempts SET NOT NULL,
  ALTER COLUMN max_attempts SET DEFAULT 3,
  ALTER COLUMN max_attempts SET NOT NULL,
  ALTER COLUMN available_at SET DEFAULT now(),
  ALTER COLUMN available_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS backup_runs_claim_idx
  ON backup_runs (available_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS backup_runs_processing_lock_idx
  ON backup_runs (locked_at)
  WHERE status = 'running';

CREATE UNIQUE INDEX IF NOT EXISTS backup_runs_active_organization_idx
  ON backup_runs (organization_id)
  WHERE status IN ('pending', 'running');
