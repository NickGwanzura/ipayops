CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  due_at date,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed', 'Skipped')),
  completed_by uuid REFERENCES users(id),
  completed_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, title)
);

CREATE INDEX IF NOT EXISTS onboarding_tasks_organization_idx ON onboarding_tasks (organization_id, status, due_at);

CREATE TABLE IF NOT EXISTS employee_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('Onboarding', 'Offboarding', 'Reactivated')),
  status text NOT NULL DEFAULT 'Completed' CHECK (status IN ('Requested', 'Completed', 'Cancelled')),
  effective_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_lifecycle_organization_idx ON employee_lifecycle_events (organization_id, created_at DESC);
