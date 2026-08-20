ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS phone text;

UPDATE organization_settings
SET address = COALESCE(NULLIF(address, ''), '15th Floor, Trust Towers, 54-56, Samora Machel Ave, Harare'),
    phone = COALESCE(NULLIF(phone, ''), '077 867 4550'),
    updated_at = now()
WHERE address IS NULL OR address = '' OR phone IS NULL OR phone = '';
