-- One row per time a solar deal's appointment moved from one time to another.
-- Additive only: a new child table of leads, nothing existing is altered.

-- CreateTable
CREATE TABLE "lead_appointment_reschedules" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "toAt" TIMESTAMP(3) NOT NULL,
    "clearedOutcome" TEXT,
    "movedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_appointment_reschedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_appointment_reschedules_leadId_createdAt_idx" ON "lead_appointment_reschedules"("leadId", "createdAt");

-- AddForeignKey
ALTER TABLE "lead_appointment_reschedules" ADD CONSTRAINT "lead_appointment_reschedules_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_appointment_reschedules" ADD CONSTRAINT "lead_appointment_reschedules_movedById_fkey" FOREIGN KEY ("movedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
