-- Consolidate the role model: CEO, Manager, Finance, and Sales Consultant.
UPDATE users SET role = 'manager', updated_at = now() WHERE role IN ('admin', 'hr', 'operator');
UPDATE users SET role = 'sales_consultant', updated_at = now() WHERE role = 'installer';
UPDATE users SET is_active = false, updated_at = now() WHERE role = 'viewer';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('ceo', 'manager', 'finance', 'sales_consultant'));
