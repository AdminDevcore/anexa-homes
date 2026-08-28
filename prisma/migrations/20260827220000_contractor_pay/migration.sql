-- What a subcontractor billed for a job, and what we are actually paying him.
--
-- The commission table's opposite number, and deliberately not a row in it. A
-- commission is money owed to whoever SOLD the job; this is money owed to
-- whoever BUILT it, and the two differ in every way that matters downstream:
-- who may read the number (Commission:read, which reps hold, vs
-- ContractorInvoice, which only super_admin and accounting hold), what it does
-- to a job's books (a commission posts job-cost-EXCLUDED so paying the rep does
-- not make the job look unprofitable; a subcontractor's labour bill is the
-- textbook job cost and posts INCLUDED), and where the number comes from (a
-- commission is computed from a rule; this is typed off a PDF, because nothing
-- in this product can read an invoice).
--
-- `invoiceId` is UNIQUE: one pay line per invoice, which is what makes
-- "Generate" idempotent, and what lets a contractor who bills twice on one job
-- get paid twice.
CREATE TABLE "contractor_pays" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    -- "Industry", not "Vertical": the Prisma enum was renamed with @map, which
    -- is a zero-DDL rename, so the Postgres type still carries the old name.
    "vertical" "Industry",
    "invoiceId" TEXT NOT NULL,
    "projectId" TEXT,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "status" "CommissionStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractor_pays_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contractor_pays_invoiceId_key" ON "contractor_pays"("invoiceId");
CREATE INDEX "contractor_pays_companyId_status_idx" ON "contractor_pays"("companyId", "status");
CREATE INDEX "contractor_pays_companyId_userId_status_idx" ON "contractor_pays"("companyId", "userId", "status");
CREATE INDEX "contractor_pays_projectId_idx" ON "contractor_pays"("projectId");

ALTER TABLE "contractor_pays" ADD CONSTRAINT "contractor_pays_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- The bill IS the record: deleting the invoice takes the pay line with it,
-- rather than leaving a payable for a document nobody can produce.
ALTER TABLE "contractor_pays" ADD CONSTRAINT "contractor_pays_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contractor_pays" ADD CONSTRAINT "contractor_pays_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contractor_pays" ADD CONSTRAINT "contractor_pays_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A payroll run is "everyone we owe money to this period", so the same run that
-- pays the reps pays the crews. Exactly one of commissionId / contractorPayId
-- is set on any line. Nullable and unbackfilled: every payroll line that exists
-- today is a commission line and reads as exactly that.
ALTER TABLE "payroll_items" ADD COLUMN "contractorPayId" TEXT;
CREATE INDEX "payroll_items_contractorPayId_idx" ON "payroll_items"("contractorPayId");
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_contractorPayId_fkey"
    FOREIGN KEY ("contractorPayId") REFERENCES "contractor_pays"("id") ON DELETE CASCADE ON UPDATE CASCADE;
