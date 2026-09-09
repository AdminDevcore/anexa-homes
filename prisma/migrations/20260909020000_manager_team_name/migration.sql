-- The name a sales manager's team goes by ("Team Alpha", "Team Kings").
--
-- Nullable and unconstrained on purpose: every existing manager starts without
-- a name, and a team with no name still reads as "<Manager>'s team" everywhere
-- it is shown, so nothing breaks before anybody fills these in.
ALTER TABLE "users" ADD COLUMN "teamName" TEXT;
