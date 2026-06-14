import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { getActiveIndustry } from "@/server/auth/industry";
import { INDUSTRY_LABEL } from "@/lib/industry";
import { PageHeader, EmptyState } from "@/components/portal/ui";
import { type BoardLead } from "@/components/portal/pipeline-board";
import { PipelineView, type ListLead } from "@/components/portal/pipeline-view";
import { ListFilter } from "@/components/portal/list-filter";
import { KanbanSquare } from "lucide-react";

export const metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  const user = await requireUser();
  if (!can(user, "read", "Lead")) redirect("/portal/dashboard");

  // The active industry workspace's pipeline (isolated per industry).
  const industry = await getActiveIndustry(user);
  const pipeline = await prisma.pipeline.findFirst({
    where: { companyId: user.companyId, industry },
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
      city: true,
      stageId: true,
      serviceType: true,
      createdAt: true,
      appointmentAt: true,
      stageChangedAt: true,
      appointmentDisposition: true,
      inspectionOutcome: true,
      assignedRep: { select: { firstName: true, lastName: true } },
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
    const rep = l.assignedRep ? `${l.assignedRep.firstName} ${l.assignedRep.lastName}` : null;
    const name = `${l.firstName} ${l.lastName}`;
    if (l.stageId && leadsByStage[l.stageId]) {
      leadsByStage[l.stageId].push({
        id: l.id,
        name,
        value: l.value,
        phone: l.phone,
        city: l.city,
        rep,
        ageDays: daysSince(l.appointmentAt, l.createdAt),
        stageDays: daysSince(l.stageChangedAt, l.createdAt),
        appointmentOutcome: l.appointmentDisposition,
        inspectionOutcome: l.inspectionOutcome,
      });
    }
    const st = l.stageId ? stageMeta.get(l.stageId) : undefined;
    listLeads.push({
      id: l.id,
      name,
      value: l.value,
      city: l.city,
      rep,
      serviceType: l.serviceType,
      stageName: st?.name ?? "—",
      stageColor: st?.color ?? "#A1A1AA",
      createdAt: l.createdAt.toISOString(),
    });
  }

  return (
    <ListFilter placeholder="Search deals by name, address…">
      <PipelineView
        title={`${INDUSTRY_LABEL[industry]} Pipeline`}
        count={leads.length}
        stages={pipeline.stages.map((s) => ({ id: s.id, name: s.name, color: s.color, targetDays: s.targetDays }))}
        initialLeadsByStage={leadsByStage}
        listLeads={listLeads}
        canMove={can(user, "update", "Lead")}
      />
    </ListFilter>
  );
}
