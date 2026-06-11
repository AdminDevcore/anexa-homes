-- Per-industry contract templates (idempotent: safe if added concurrently).
ALTER TABLE "document_templates" ADD COLUMN IF NOT EXISTS "industry" "Industry" NOT NULL DEFAULT 'roofing';
CREATE INDEX IF NOT EXISTS "document_templates_companyId_industry_idx" ON "document_templates"("companyId", "industry");
