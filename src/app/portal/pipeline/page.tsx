import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { getActiveVertical } from "@/server/auth/vertical";
import { VERTICAL_LABEL } from "@/lib/vertical";
import { PageHeader, EmptyState } from "@/components/portal/ui";
import { type BoardLead } from "@/components/portal/pipeline-board";
import { PipelineView, type ListLead } from "@/components/portal/pipeline-view";
import type { FilterableDeal } from "@/lib/pipeline-filters";
import { addressSearchText } from "@/lib/address";
import { KanbanSquare } from "lucide-react";

export const metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  const user = await requireUser();
  if (!can(user, "read", "Lead")) redirect("/portal/dashboard");

  // The active vertical workspace's pipeline (isolated per vertical).
  const vertical = await getActiveVertical(user);
  const pipeline = await prisma.pipeline.findFirst({
    where: { companyId: user.companyId, vertical },
    orderBy: { isDefault: "desc" },
    include: { stages: { orderBy: { position: "asc" } } },
  });

  if (!pipeline || pipeline.stages.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Pipeline" />
        <EmptyState icon={KanbanSquare} title="No pipeline configured" />
      </div>
    );
  }

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const leads = await prisma.lead.findMany({
    where: { AND: [scope, { pipelineId: pipeline.id }] },
    orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      value: true,
      phone: true,
      address: true,
      city: true,
      state: true,
      zip: true,
      stageId: true,
      serviceType: true,
      createdAt: true,
      appointmentAt: true,
      stageChangedAt: true,
      appointmentDisposition: true,
      inspectionOutcome: true,
      assignedRepId: true,
      assignedRep: { select: { firstName: true, lastName: true } },
      setterId: true,
      setter: { select: { firstName: true, lastName: true } },
      sourceId: true,
      source: { select: { name: true } },
    },
  });

  // Whole-day age counts, computed against a single "now" per request.
  const now = Date.now();
  const daysSince = (d: Date | null | undefined, fallback: Date) =>
    Math.max(0, Math.floor((now - (d ?? fallback).getTime()) / 86_400_000));

  const stageMeta = new Map(pipeline.stages.map((s) => [s.id, s]));
  const leadsByStage: Record<string, BoardLead[]> = {};
  for (const s of pipeline.stages) leadsByStage[s.id] = [];
  const listLeads: ListLead[] = [];
  for (const l of leads) {
    // Everything the Filters panel narrows by, carried by the card and the list
    // row alike. Only the city is shown; the rest of the address rides along so
    // the search can match a street or ZIP the card never displays.
    const deal: FilterableDeal = {
      name: `${l.firstName} ${l.lastName}`,
      phone: l.phone,
      city: l.city,
      addressText: addressSearchText(l) || null,
      rep: l.assignedRep ? `${l.assignedRep.firstName} ${l.assignedRep.lastName}` : null,
      repId: l.assignedRepId,
      setter: l.setter ? `${l.setter.firstName} ${l.setter.lastName}` : null,
      setterId: l.setterId,
      source: l.source?.name ?? null,
      sourceId: l.sourceId,
      appointmentOutcome: l.appointmentDisposition,
      inspectionOutcome: l.inspectionOutcome,
      value: l.value,
      stageDays: daysSince(l.stageChangedAt, l.createdAt),
      appointmentAt: l.appointmentAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
    };
    if (l.stageId && leadsByStage[l.stageId]) {
      leadsByStage[l.stageId].push({ id: l.id, ...deal, ageDays: daysSince(l.appointmentAt, l.createdAt) });
    }
    const st = l.stageId ? stageMeta.get(l.stageId) : undefined;
    listLeads.push({
      id: l.id,
      ...deal,
      serviceType: l.serviceType,
      stageId: st ? l.stageId : null,
      stageName: st?.name ?? "—",
      stageColor: st?.color ?? "#A1A1AA",
      targetDays: st?.targetDays ?? 0,
    });
  }

  return (
    <PipelineView
      title={`${VERTICAL_LABEL[vertical]} Pipeline`}
      count={leads.length}
      stages={pipeline.stages.map((s) => ({ id: s.id, name: s.name, color: s.color, targetDays: s.targetDays }))}
      initialLeadsByStage={leadsByStage}
      listLeads={listLeads}
      canMove={can(user, "update", "Lead")}
    />
  );
}
