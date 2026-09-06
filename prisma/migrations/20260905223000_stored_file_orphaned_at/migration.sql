-- The start of the 30-day retention window for deleted file bytes.
--
-- Deliberately NOT `createdAt`: that is the age of the file, so purging on it
-- would delete a two-year-old document the day after somebody removed it by
-- mistake. This records when the bytes were first seen with nothing pointing at
-- them. Nullable and unset on every existing row, so the first sweep marks and
-- a later one deletes — no existing object becomes purgeable by this migration.
ALTER TABLE "stored_files" ADD COLUMN "orphanedAt" TIMESTAMP(3);
