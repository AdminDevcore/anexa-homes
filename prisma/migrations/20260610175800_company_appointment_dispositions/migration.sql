-- Customizable appointment outcomes on company settings (additive; schema already declares it).
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "appointmentDispositions" JSONB NOT NULL DEFAULT '[]';
