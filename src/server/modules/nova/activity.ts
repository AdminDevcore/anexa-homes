import { prisma } from "@/server/db/client";

export type NovaActivityItem = {
  id: string;
  /** Who asked Nova — the person it acted as. */
  actor: string;
  text: string;
  failed: boolean;
  createdAt: string;
};

/**
 * What Nova changed on one deal, for its Activity tab: every write it carried
 * out, or tried to and could not, newest first. Backed by the audit trail
 * itself, so the tab cannot disagree with it.
 *
 * Reads, proposals, refusals and cancellations are in the trail but not here:
 * the tab records what happened to the deal, not who looked at it.
 */
export async function getNovaActivity(companyId: string, leadId: string, take = 50): Promise<NovaActivityItem[]> {
  const rows = await prisma.novaAuditEvent.findMany({
    where: { companyId, leadId, kind: "write", phase: { in: ["executed", "failed"] } },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, actorId: true, phase: true, result: true, error: true, createdAt: true },
  });
  if (rows.length === 0) return [];

  const people = await prisma.user.findMany({
    where: { companyId, id: { in: [...new Set(rows.map((r) => r.actorId))] } },
    select: { id: true, firstName: true, lastName: true },
  });
  const names = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]));

  return rows.map((r) => {
    const result = (r.result ?? {}) as { done?: unknown; summary?: unknown };
    const failed = r.phase === "failed";
    const text = failed
      ? `Couldn't finish: ${String(result.summary ?? "a change")}${r.error ? ` ${r.error}` : ""}`
      : String(result.done ?? result.summary ?? "Made a change.");
    return {
      id: r.id,
      actor: names.get(r.actorId) ?? "A former teammate",
      text,
      failed,
      createdAt: r.createdAt.toISOString(),
    };
  });
}
