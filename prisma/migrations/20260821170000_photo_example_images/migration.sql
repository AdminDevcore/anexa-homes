-- An example photo per checklist slot: the shot a rep can look at before
-- taking their own, so "Main service entrance" stops being a guess.
--
-- The bytes live in the storage driver like a lender's logo, not in `files`:
-- an example belongs to the checklist rather than to any one job, and a files
-- row would land in that deal's photo folder and in its compiled PDF as if the
-- crew had taken it. Nullable, so every existing slot is unchanged.
ALTER TABLE "photo_template_items" ADD COLUMN "exampleKey" TEXT;
-- The cache-buster in the serving URL, so a replaced example is a new URL.
ALTER TABLE "photo_template_items" ADD COLUMN "exampleUpdatedAt" TIMESTAMP(3);
