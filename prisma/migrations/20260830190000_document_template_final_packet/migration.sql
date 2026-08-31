-- Which contract templates make up the closeout packet sent at install
-- completion. Default false: no existing template joins the packet until
-- somebody ticks it in the template editor.
ALTER TABLE "document_templates" ADD COLUMN "finalPacket" BOOLEAN NOT NULL DEFAULT false;
