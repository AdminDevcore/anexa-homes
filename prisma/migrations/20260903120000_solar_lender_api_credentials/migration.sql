-- Direct API submission for a lender that accepts applications over an API
-- rather than only a customer-facing link.
--
-- Three nullable columns rather than a mode flag: a lender without an
-- integration keeps today's link behaviour untouched, and "has an integration"
-- is exactly "all three are set".

ALTER TABLE "solar_lenders" ADD COLUMN IF NOT EXISTS "apiBaseUrl"      TEXT;
ALTER TABLE "solar_lenders" ADD COLUMN IF NOT EXISTS "apiKeyEncrypted" TEXT;
ALTER TABLE "solar_lenders" ADD COLUMN IF NOT EXISTS "apiProductSlug"  TEXT;
