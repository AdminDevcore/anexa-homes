-- Multi-PDF contract templates: a template becomes an ordered list of documents
-- that go out as ONE envelope with one signing link and one merged signed file.
-- Existing single-PDF templates get no rows here and keep using
-- document_templates.sourcePdfKey, so this migration changes no behaviour.

CREATE TABLE "document_template_documents" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "sourcePdfKey" TEXT,
    "pages" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_template_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "document_template_documents_templateId_order_idx" ON "document_template_documents"("templateId", "order");

ALTER TABLE "document_template_documents"
    ADD CONSTRAINT "document_template_documents_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "document_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_template_fields" ADD COLUMN "documentId" TEXT;

CREATE INDEX "document_template_fields_documentId_idx" ON "document_template_fields"("documentId");

ALTER TABLE "document_template_fields"
    ADD CONSTRAINT "document_template_fields_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "document_template_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
