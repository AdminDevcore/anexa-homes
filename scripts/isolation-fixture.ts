/**
 * Isolation-test fixture: single-workspace users and matched Roofing/Solar data,
 * so `scripts/isolation-probe.ts` has something real to try to break.
 *
 * LOCAL DEV DATABASE ONLY. It creates users with a known password and writes
 * marker records; never point it at production.
 *
 *   SOLAR_VERTICAL_ENABLED=1 npx tsx scripts/isolation-fixture.ts
 *
 * Users are deliberately chosen so each test isolates ONE variable:
 *   isoroof / isosolar / isodual  — role `admin`, so RBAC is wide open and only
 *                                   the workspace grant differs
 *   isorep                        — non-admin, proves RBAC and workspace compose
 *   isoacctroof / isoacctsolar    — accounting, the only roles that reach Reports
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();
const PASSWORD = "Passw0rd!";

async function main() {
  const company = await db.company.findFirstOrThrow({ select: { id: true } });
  const companyId = company.id;
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const users = [
    // ADMIN role on purpose: admins are RBAC-unrestricted (listScope returns the
    // whole company), so the ONLY variable left under test is the workspace
    // grant. It is also the strongest form of the claim — if an admin cannot
    // cross the boundary, no lesser role can.
    { email: "isoroof@test.local", firstName: "Iso", lastName: "Roof", role: "admin" as const, verticals: ["roofing" as const] },
    { email: "isosolar@test.local", firstName: "Iso", lastName: "Solar", role: "admin" as const, verticals: ["solar" as const] },
    { email: "isodual@test.local", firstName: "Iso", lastName: "Dual", role: "admin" as const, verticals: ["roofing" as const, "solar" as const] },
    // A deliberately non-admin, single-workspace staff member: proves RBAC and
    // workspace isolation COMPOSE rather than one masking the other.
    { email: "isorep@test.local", firstName: "Iso", lastName: "Rep", role: "sales_rep" as const, verticals: ["roofing" as const] },
    // Reports are gated to accounting/super_admin, so the A/R aging leak test
    // needs an accounting user per workspace.
    { email: "isoacctroof@test.local", firstName: "Iso", lastName: "AcctRoof", role: "accounting" as const, verticals: ["roofing" as const] },
    { email: "isoacctsolar@test.local", firstName: "Iso", lastName: "AcctSolar", role: "accounting" as const, verticals: ["solar" as const] },
  ];
  const ids: Record<string, string> = {};
  for (const u of users) {
    const row = await db.user.upsert({
      where: { companyId_email: { companyId, email: u.email } },
      update: { verticals: u.verticals, role: u.role, status: "active", deletedAt: null, passwordHash },
      create: { ...u, companyId, passwordHash, status: "active" },
      select: { id: true },
    });
    ids[u.email] = row.id;
    // The portal layout redirects to /onboarding until this is set, which would
    // make every page probe a 307 and every isolation assertion vacuously pass.
    await db.userOnboarding.upsert({
      where: { userId: row.id },
      update: { completedAt: new Date("2026-01-01T00:00:00Z") },
      create: { userId: row.id, completedAt: new Date("2026-01-01T00:00:00Z") },
    });
  }

  // Knowledge: one category per workspace, each with an item. The hard rule.
  for (const v of ["roofing", "solar"] as const) {
    const cat = await db.knowledgeCategory.upsert({
      where: { id: `00000000-0000-4000-8000-00000000000${v === "roofing" ? "1" : "2"}` },
      update: { name: `ISO ${v} training`, vertical: v, visibleRoles: [] },
      create: {
        id: `00000000-0000-4000-8000-00000000000${v === "roofing" ? "1" : "2"}`,
        companyId, name: `ISO ${v} training`, vertical: v, visibleRoles: [],
      },
      select: { id: true },
    });
    await db.knowledgeItem.upsert({
      where: { id: `00000000-0000-4000-8000-0000000000${v === "roofing" ? "11" : "12"}` },
      update: { title: `ISO ${v} SECRET DOC` },
      create: {
        id: `00000000-0000-4000-8000-0000000000${v === "roofing" ? "11" : "12"}`,
        companyId, categoryId: cat.id, type: "article", title: `ISO ${v} SECRET DOC`,
        body: `Body for ${v} only`,
      },
    });
  }

  // One lead per workspace, tagged so probes can look for the marker string.
  const leadIds: Record<string, string> = {};
  for (const v of ["roofing", "solar"] as const) {
    const lead = await db.lead.upsert({
      where: { id: `00000000-0000-4000-8000-0000000001${v === "roofing" ? "01" : "02"}` },
      update: { vertical: v, firstName: "ISO", lastName: `${v}LEAD` },
      create: {
        id: `00000000-0000-4000-8000-0000000001${v === "roofing" ? "01" : "02"}`,
        companyId, vertical: v, firstName: "ISO", lastName: `${v}LEAD`,
        address: `${v} probe street`,
      },
      select: { id: true },
    });
    leadIds[v] = lead.id;
  }

  // Tasks: roofing-only, solar-only, company (NULL).
  const taskSpecs = [
    { id: "00000000-0000-4000-8000-000000000201", title: "ISO ROOFING TASK", vertical: "roofing" as const },
    { id: "00000000-0000-4000-8000-000000000202", title: "ISO SOLAR TASK", vertical: "solar" as const },
    { id: "00000000-0000-4000-8000-000000000203", title: "ISO COMPANY TASK", vertical: null },
  ];
  for (const t of taskSpecs) {
    await db.task.upsert({
      where: { id: t.id },
      update: { title: t.title, vertical: t.vertical, assigneeId: ids["isodual@test.local"] },
      create: { id: t.id, companyId, title: t.title, vertical: t.vertical, assigneeId: ids["isodual@test.local"] },
    });
  }

  // Files: company / workspace(solar, parentless) / private(owned by isoroof).
  const fileSpecs = [
    { id: "00000000-0000-4000-8000-000000000301", name: "ISO-COMPANY.txt", scope: "company" as const, vertical: null, uploadedById: null },
    { id: "00000000-0000-4000-8000-000000000302", name: "ISO-SOLAR-WS.txt", scope: "workspace" as const, vertical: "solar" as const, uploadedById: null },
    { id: "00000000-0000-4000-8000-000000000303", name: "ISO-PRIVATE.txt", scope: "private" as const, vertical: null, uploadedById: ids["isoroof@test.local"] },
    { id: "00000000-0000-4000-8000-000000000304", name: "ISO-SOLAR-DEAL.txt", scope: "workspace" as const, vertical: null, uploadedById: null, leadId: leadIds.solar },
  ];
  for (const f of fileSpecs) {
    await db.fileAsset.upsert({
      where: { id: f.id },
      update: { name: f.name, scope: f.scope, vertical: f.vertical, uploadedById: f.uploadedById, leadId: (f as { leadId?: string }).leadId ?? null },
      create: {
        id: f.id, companyId, kind: "document", name: f.name, storageKey: `iso/${f.name}`,
        mimeType: "text/plain", size: 3, scope: f.scope, vertical: f.vertical,
        uploadedById: f.uploadedById, leadId: (f as { leadId?: string }).leadId ?? null,
      },
    });
  }

  console.log(JSON.stringify({ companyId, users: ids, leads: leadIds }, null, 2));
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
