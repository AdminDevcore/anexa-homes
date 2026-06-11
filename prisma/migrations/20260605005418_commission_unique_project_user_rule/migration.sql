-- Prevent duplicate commissions for the same (project, recipient, rule).
CREATE UNIQUE INDEX "commissions_projectId_userId_ruleId_key" ON "commissions"("projectId", "userId", "ruleId");
