-- A deal's reference at the lender, when the first one has to be abandoned.
--
-- Defaults to 0 on every existing row, and 0 means "use the design id" — the
-- reference every deal already submits under. So this migration changes no
-- submission that works today.
ALTER TABLE "solar_designs"
  ADD COLUMN "lenderSubmissionAttempt" INTEGER NOT NULL DEFAULT 0;
