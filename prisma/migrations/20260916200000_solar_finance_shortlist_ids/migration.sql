-- The ways to pay a rep ticked on the Financing step. The proposal's payment
-- menu is built from exactly these beside the quoted option; before this it
-- offered cash and one programme from every lender whatever was ticked.
-- Additive: every existing deal starts with nothing ticked, and documents
-- already generated keep the menus they froze.
ALTER TABLE "solar_finance" ADD COLUMN     "shortlistIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
