/**
 * Seed stage-change notification rules for the roofing pipeline (in-app + email).
 * Idempotent: each rule is keyed by name — re-running replaces it in place.
 *
 *   DATABASE_URL="<prod>" pnpm tsx scripts/seed-notification-rules.ts
 *
 * "assigned_rep" is the dynamic rep on the deal; roles notify everyone active in
 * that role. There is no per-deal installer, so "installer" = all installers.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

type Rule = { name: string; stageKey: string; roles: string[]; dynamic?: string[] };

const RULES: Rule[] = [
  { name: "Scope Received → Super Admin, Sales Manager, Admin", stageKey: "scope_received", roles: ["super_admin", "manager", "admin"] },
  { name: "Scope Complete → Sales Manager, Owner", stageKey: "scope_complete_17", roles: ["manager", "super_admin"] },
  { name: "Supplement Needed → Sales Rep, Admin, Sales Manager", stageKey: "supplement_needed", roles: ["admin", "manager"], dynamic: ["assigned_rep"] },
  { name: "Supplement Submitted → Sales Rep, Sales Manager", stageKey: "supplement_submitted_18", roles: ["manager"], dynamic: ["assigned_rep"] },
  { name: "Supplement Approved → Sales Rep, Sales Manager, Installer", stageKey: "supplement_approved_19", roles: ["manager", "installer"], dynamic: ["assigned_rep"] },
  { name: "Front Check Received → Sales Rep, Sales Manager, Admin, Installer, Accounting", stageKey: "front_check_received_20", roles: ["manager", "admin", "installer", "accounting"], dynamic: ["assigned_rep"] },
  { name: "Scheduled → Sales Rep, Sales Manager, Admin, Installer", stageKey: "scheduled", roles: ["manager", "admin", "installer"], dynamic: ["assigned_rep"] },
  { name: "QC Inspection → Accounting", stageKey: "qc_inspection", roles: ["accounting"] },
  { name: "Depreciation Requested → Sales Manager, Sales Rep, Admin, Super Admin, Accounting", stageKey: "depreciation_requested", roles: ["manager", "admin", "super_admin", "accounting"], dynamic: ["assigned_rep"] },
];

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  for (const company of companies) {
    const pipeline = await prisma.pipeline.findFirst({
      where: { companyId: company.id, vertical: "roofing" },
      select: { id: true, stages: { select: { id: true, key: true } } },
    });
    if (!pipeline) { console.log(`! ${company.name}: no roofing pipeline, skipping`); continue; }
    const stageId = Object.fromEntries(pipeline.stages.map((s) => [s.key, s.id]));

    let created = 0, skipped = 0;
    for (const r of RULES) {
      const sid = stageId[r.stageKey];
      if (!sid) { console.log(`  ⚠ stage "${r.stageKey}" not found — skipping "${r.name}"`); skipped++; continue; }
      // Replace any existing rule with the same name (idempotent re-run).
      await prisma.notificationRule.deleteMany({ where: { companyId: company.id, name: r.name } });
      await prisma.notificationRule.create({
        data: {
          companyId: company.id,
          name: r.name,
          event: "stage_changed",
          conditions: { stageId: sid },
          recipients: { roles: r.roles, userIds: [], dynamic: r.dynamic ?? [] },
          channels: ["in_app", "email"],
          titleTemplate: "{{customer}} → {{stage}}",
          bodyTemplate: "{{actor}} moved {{customer}} to {{stage}}.",
        },
      });
      created++;
    }
    console.log(`✅ ${company.name}: ${created} rules set${skipped ? `, ${skipped} skipped` : ""}`);
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
