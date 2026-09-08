-- POINTING ONE OF A PARTNER'S FIELDS SOMEWHERE ELSE, WITHOUT A DEPLOY.
--
-- The Submission tab publishes what feeds every field on the wire. Five rows
-- are settings, because more than one figure is true and only the partner knows
-- which. The rest were stated as fixed — each has one obvious source — and that
-- is right until a partner wants something else in a box, at which point the
-- answer being in code makes it a deploy.
--
-- A row here overrides ONE field for ONE partner: another Anexa value from the
-- whitelist in `lender-field-map.ts`, or a constant an admin typed. NO ROW
-- MEANS NO OVERRIDE, so this table changes nothing by existing — every partner
-- keeps sending exactly what it sent yesterday until somebody maps something.
--
-- `sourceKey` is a whitelist key and not a column name on purpose: a mapping
-- cannot name an arbitrary field, so "no SSN, no date of birth, no consent
-- flag" survives making the mapping editable.
CREATE TABLE "solar_lender_field_map" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "lenderId"  TEXT NOT NULL,
  "wireField" TEXT NOT NULL,
  "sourceKey" TEXT,
  "literal"   TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "solar_lender_field_map_pkey" PRIMARY KEY ("id")
);

-- One override per field per partner: the mapping is a statement about a box,
-- and two rows for one box is a coin toss at submission time.
CREATE UNIQUE INDEX "solar_lender_field_map_lenderId_wireField_key"
  ON "solar_lender_field_map" ("lenderId", "wireField");

CREATE INDEX "solar_lender_field_map_companyId_idx"
  ON "solar_lender_field_map" ("companyId");

ALTER TABLE "solar_lender_field_map"
  ADD CONSTRAINT "solar_lender_field_map_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "solar_lender_field_map"
  ADD CONSTRAINT "solar_lender_field_map_lenderId_fkey"
  FOREIGN KEY ("lenderId") REFERENCES "solar_lenders" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
