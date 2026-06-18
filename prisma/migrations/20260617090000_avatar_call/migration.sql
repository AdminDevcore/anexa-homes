-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CallMode" AS ENUM ('confirm', 'avatar');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AvatarStatus" AS ENUM ('none', 'generating', 'ready', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AlterTable
ALTER TABLE "welcome_call_templates" ADD COLUMN IF NOT EXISTS "mode" "CallMode" NOT NULL DEFAULT 'confirm';

-- AlterTable
ALTER TABLE "welcome_call_sessions" ADD COLUMN IF NOT EXISTS "mode" "CallMode" NOT NULL DEFAULT 'confirm';
ALTER TABLE "welcome_call_sessions" ADD COLUMN IF NOT EXISTS "avatarStatus" "AvatarStatus" NOT NULL DEFAULT 'none';
ALTER TABLE "welcome_call_sessions" ADD COLUMN IF NOT EXISTS "segments" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "welcome_call_sessions" ADD COLUMN IF NOT EXISTS "recordingStorageKey" TEXT;
ALTER TABLE "welcome_call_sessions" ADD COLUMN IF NOT EXISTS "recordedAt" TIMESTAMP(3);
