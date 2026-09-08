-- Put the starred inverter on the deals that were drawn before it could reach them.
--
-- The catalogue's "Default" star has always meant "the item a new design starts
-- on for this kind", and for the inverter it never did: nothing read it, so
-- `inverterId` stayed null on every design ever built. The code half of this is
-- in `resolveDesignInverter`, which fills the slot on the next recompute — but a
-- deal that is already priced and sitting in front of a customer does not
-- recompute, and that is exactly the deal the lender refuses.
--
-- ONLY the empty slot is touched. A design that names an inverter — including
-- one that names last year's — is left alone, for the same reason the module
-- backfill would be: re-pointing a quote somebody has already been shown at
-- this year's product is not a correction, it is a different system.
--
-- No default starred, no row updated. A company that has not chosen one is not
-- given a guess.
UPDATE "solar_designs" d
SET "inverterId" = e."id"
FROM "solar_equipment" e
WHERE d."inverterId" IS NULL
  AND e."companyId" = d."companyId"
  AND e."vertical" = d."vertical"
  AND e."kind" = 'inverter'
  AND e."isActive" = TRUE
  AND e."isDefault" = TRUE;
