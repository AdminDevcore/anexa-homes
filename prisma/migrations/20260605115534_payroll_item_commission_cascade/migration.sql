-- Deleting a commission now removes its payroll line (no stale snapshot / dangling ref).
ALTER TABLE "payroll_items" DROP CONSTRAINT "payroll_items_commissionId_fkey";
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "commissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
