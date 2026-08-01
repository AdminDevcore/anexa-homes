-- Per-vertical overrides for scalar CompanySettings fields (branding, workflow).
-- Additive with a default: existing rows get '{}', which means "inherit every
-- column exactly as before", so Roofing's rendered branding does not change.
ALTER TABLE "company_settings"
  ADD COLUMN "verticalOverrides" JSONB NOT NULL DEFAULT '{}';
