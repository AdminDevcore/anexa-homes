-- Adjuster meeting + install dates for the calendar.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "adjusterMeetingAt" TIMESTAMP(3);
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "installDate" TIMESTAMP(3);
