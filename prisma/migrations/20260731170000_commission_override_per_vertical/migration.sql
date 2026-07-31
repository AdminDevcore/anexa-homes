-- Overrides are now written per vertical: Roofing and Solar pay differently, and
-- a rep working both sides earns off each at its own rate. Every existing row
-- predates Solar, so `roofing` is the correct backfill — the DEFAULT applies it
-- in place with no separate UPDATE.
--
-- The enum is physically still "Industry" (schema.prisma @@maps Vertical onto
-- it), so this ADD COLUMN emits no enum DDL.
ALTER TABLE "commission_overrides" ADD COLUMN     "vertical" "Industry" NOT NULL DEFAULT 'roofing';

-- The old key allowed one override per (beneficiary, source). That is now one
-- per (beneficiary, source, vertical) so the same pair can carry a roofing rate
-- and a solar rate side by side. Widening a unique key can never collide with
-- existing data: every old row is roofing, so the tuples stay distinct.
DROP INDEX "commission_overrides_companyId_beneficiaryId_sourceId_key";

CREATE UNIQUE INDEX "commission_overrides_companyId_beneficiaryId_sourceId_verti_key" ON "commission_overrides"("companyId", "beneficiaryId", "sourceId", "vertical");

-- Payout looks up overrides by (company, source, vertical) once per deal.
DROP INDEX "commission_overrides_companyId_sourceId_idx";

CREATE INDEX "commission_overrides_companyId_sourceId_vertical_idx" ON "commission_overrides"("companyId", "sourceId", "vertical");
