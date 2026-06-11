-- Team-chat file/photo/PDF attachments.
ALTER TABLE "files" ADD COLUMN "conversationId" TEXT;
ALTER TABLE "files" ADD COLUMN "messageId" TEXT;
CREATE INDEX "files_conversationId_idx" ON "files"("conversationId");
CREATE INDEX "files_messageId_idx" ON "files"("messageId");
ALTER TABLE "files" ADD CONSTRAINT "files_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "files" ADD CONSTRAINT "files_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
