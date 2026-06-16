import { prisma } from "@/server/db/client";
import { parseItems } from "./types";

/** Templates for the Settings list (with item + usage counts). */
export async function getWelcomeCallTemplates(companyId: string) {
  const rows = await prisma.welcomeCallTemplate.findMany({
    where: { companyId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, kind: true, active: true, position: true, items: true, _count: { select: { sessions: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    active: r.active,
    position: r.position,
    itemCount: parseItems(r.items).length,
    sessionCount: r._count.sessions,
  }));
}

/** One template's editable content. */
export async function getWelcomeCallTemplate(companyId: string, id: string) {
  const t = await prisma.welcomeCallTemplate.findFirst({
    where: { id, companyId },
    select: { id: true, name: true, kind: true, intro: true, closing: true, items: true },
  });
  if (!t) return null;
  return { id: t.id, name: t.name, kind: t.kind, intro: t.intro ?? "", closing: t.closing ?? "", items: parseItems(t.items) };
}

/** Active templates for the "send" picker on a lead. */
export async function getActiveWelcomeCallTemplates(companyId: string) {
  return prisma.welcomeCallTemplate.findMany({
    where: { companyId, active: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, kind: true },
  });
}

/** Sent calls for the Documents tracking list. */
export async function listWelcomeCalls(companyId: string) {
  return prisma.welcomeCallSession.findMany({
    where: { companyId },
    orderBy: { sentAt: "desc" },
    take: 200,
    select: {
      id: true,
      customerName: true,
      kind: true,
      status: true,
      sentAt: true,
      viewedAt: true,
      completedAt: true,
      leadId: true,
      template: { select: { name: true } },
    },
  });
}
