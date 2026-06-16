-- CreateEnum
CREATE TYPE "CallKind" AS ENUM ('welcome', 'completion');

-- AlterTable
ALTER TABLE "welcome_call_sessions" ADD COLUMN     "kind" "CallKind" NOT NULL DEFAULT 'welcome';

-- AlterTable
ALTER TABLE "welcome_call_templates" ADD COLUMN     "kind" "CallKind" NOT NULL DEFAULT 'welcome';
