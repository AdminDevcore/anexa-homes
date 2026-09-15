import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { getActiveVertical } from "@/server/auth/vertical";
import { getAppointmentDispositions, getClaimStatuses } from "@/server/modules/settings/queries";
import { VERTICAL_LABEL } from "@/lib/vertical";
import { PageHeader, EmptyState } from "@/components/portal/ui";
import { type BoardLead } from "@/components/portal/pipeline-board";
import { PipelineView, type ListLead } from "@/components/portal/pipeline-view";
import type { SavedFilterView } from "@/components/portal/pipeline-views-menu";
import { addressSearchText } from "@/lib/address";
import { OUTCOME_CATEGORY_LABELS, outcomeCategory } from "@/lib/dispositions";
import type { ClaimStatusOption } from "@/lib/claim-status";
import { serviceTypeLabel } from "@/lib/service-types";
import { BLOCKER_LABEL } from "@/lib/solar-pipeline";
import {
  DEAL_TYPE_LABEL,
  PRIORITY_LABEL,
  buildFilterFields,
  customFieldKey,
  sanitizeConditions,
  sanitizeMatch,
  type FactValue,
} from "@/lib/pipeline-filters";
import { KanbanSquare } from "lucide-react";

export const metadata = { title: "Pipeline" };

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

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
  const [leads, customFieldDefs, dispositions, claimStatuses, viewRows] = await Promise.all([
    prisma.lead.findMany({
      where: { AND: [scope, { pipelineId: pipeline.id }] },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        value: true,
        phone: true,
        email: true,
        address: true,
        city: true,
        state: true,
        zip: true,
        stageId: true,
        serviceType: true,
        dealType: true,
        priority: true,
        claimStatus: true,
        blockedBy: true,
        createdAt: true,
        appointmentAt: true,
        stageChangedAt: true,
        appointmentDisposition: true,
        inspectionOutcome: true,
        customFields: true,
        assignedRepId: true,
        assignedRep: { select: { firstName: true, lastName: true } },
        setterId: true,
        setter: { select: { firstName: true, lastName: true } },
        sourceId: true,
        source: { select: { name: true } },
        project: { select: { customFields: true } },
      },
    }),
    // The company's own fields become filters too (Settings → Fields).
    prisma.customFieldDef.findMany({
      where: { companyId: user.companyId, vertical },
      orderBy: [{ entity: "asc" }, { position: "asc" }],
      select: { entity: true, key: true, label: true, type: true, options: true },
    }),
    getAppointmentDispositions(user.companyId, vertical),
    vertical === "roofing" ? getClaimStatuses(user.companyId, vertical) : Promise.resolve<ClaimStatusOption[]>([]),
    // Your own views and every shared one; somebody else's private view never leaves the server.
    prisma.pipelineFilterView.findMany({
      where: { companyId: user.companyId, vertical, OR: [{ createdById: user.userId }, { shared: true }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, shared: true, conditions: true, match: true, createdById: true },
    }),
  ]);

  // Whole-day age counts, computed against a single "now" per request.
  const now = Date.now();
  const daysSince = (d: Date | null | undefined, fallback: Date) =>
    Math.max(0, Math.floor((now - (d ?? fallback).getTime()) / 86_400_000));

  // What a filter chip or option shows for a stored value. Enum maps list their
  // options in this key order.
  const labels: Record<string, Record<string, string>> = {
    rep: {},
    setter: {},
    source: {},
    city: {},
    service_type: {},
    appt_status: { ...OUTCOME_CATEGORY_LABELS },
    priority: PRIORITY_LABEL,
    deal_type: DEAL_TYPE_LABEL,
    claim_status: Object.fromEntries(claimStatuses.map((s) => [s.key, s.label])),
    blocked_by: { ...BLOCKER_LABEL },
  };

  const stageMeta = new Map(pipeline.stages.map((s) => [s.id, s]));
  const leadsByStage: Record<string, BoardLead[]> = {};
  for (const s of pipeline.stages) leadsByStage[s.id] = [];
  const listLeads: ListLead[] = [];
  for (const l of leads) {
    const name = `${l.firstName} ${l.lastName}`;
    const rep = l.assignedRep ? `${l.assignedRep.firstName} ${l.assignedRep.lastName}` : null;
    const setter = l.setter ? `${l.setter.firstName} ${l.setter.lastName}` : null;
    const stageDays = daysSince(l.stageChangedAt, l.createdAt);
    const ageDays = daysSince(l.appointmentAt, l.createdAt);
    const city = l.city?.trim() || null;

    if (l.assignedRepId && rep) labels.rep[l.assignedRepId] = rep;
    if (l.setterId && setter) labels.setter[l.setterId] = setter;
    if (l.sourceId && l.source) labels.source[l.sourceId] = l.source.name;
    // "Plano" and "plano " are one city; the first spelling seen names it.
    if (city) labels.city[city.toLowerCase()] ??= city;
    labels.service_type[l.serviceType] = serviceTypeLabel(l.serviceType);

    const facts: Record<string, FactValue> = {
      rep: l.assignedRepId,
      setter: l.setterId,
      source: l.sourceId,
      outcome: l.appointmentDisposition || null,
      appt_status: l.appointmentDisposition ? outcomeCategory(l.appointmentDisposition, dispositions) : null,
      inspection: l.inspectionOutcome || null,
      priority: l.priority,
      deal_type: l.dealType,
      claim_status: l.claimStatus || null,
      service_type: l.serviceType,
      blocked_by: l.blockedBy,
      city: city?.toLowerCase() ?? null,
      zip: l.zip?.trim() || null,
      value: l.value,
      stage_days: stageDays,
      age_days: ageDays,
      appointment_at: l.appointmentAt?.toISOString() ?? null,
      created_at: l.createdAt.toISOString(),
    };
    const leadValues = asRecord(l.customFields);
    const projectValues = asRecord(l.project?.customFields);
    for (const def of customFieldDefs) {
      const raw = (def.entity === "project" ? projectValues : leadValues)[def.key];
      facts[customFieldKey(def.entity, def.key)] =
        raw === undefined || raw === null || String(raw).trim() === "" ? null : String(raw);
    }

    // Only the city is shown on a card/row; the full address, email and people
    // ride along so the search can match what the card never displays.
    const searchText = [name, l.phone, l.email, addressSearchText(l), rep, setter, l.source?.name, l.appointmentDisposition, l.inspectionOutcome]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (l.stageId && leadsByStage[l.stageId]) {
      leadsByStage[l.stageId].push({
        id: l.id,
        name,
        value: l.value,
        phone: l.phone,
        city: l.city,
        rep,
        ageDays,
        stageDays,
        appointmentOutcome: l.appointmentDisposition,
        inspectionOutcome: l.inspectionOutcome,
      });
    }
    const st = l.stageId ? stageMeta.get(l.stageId) : undefined;
    listLeads.push({
      id: l.id,
      searchText,
      phoneDigits: (l.phone ?? "").replace(/\D/g, ""),
      stageDays,
      facts,
      stageId: st ? st.id : null,
      targetDays: st?.targetDays ?? 0,
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

  const fields = buildFilterFields({
    vertical,
    stages: pipeline.stages.map((s) => ({ id: s.id, name: s.name })),
    customFields: customFieldDefs.map((d) => ({
      entity: d.entity,
      key: d.key,
      label: d.label,
      type: d.type,
      options: Array.isArray(d.options) ? d.options.filter((o): o is string => typeof o === "string") : [],
    })),
    deals: listLeads,
    labels,
  });

  const canShareViews = can(user, "update", "Pipeline");
  const views: SavedFilterView[] = viewRows.map((v) => {
    const mine = v.createdById === user.userId;
    return {
      id: v.id,
      name: v.name,
      shared: v.shared,
      conditions: sanitizeConditions(v.conditions),
      match: sanitizeMatch(v.match),
      mine,
      canEdit: mine || (v.shared && canShareViews),
    };
  });

  return (
    <PipelineView
      title={`${VERTICAL_LABEL[vertical]} Pipeline`}
      count={leads.length}
      stages={pipeline.stages.map((s) => ({ id: s.id, name: s.name, color: s.color, targetDays: s.targetDays }))}
      initialLeadsByStage={leadsByStage}
      listLeads={listLeads}
      canMove={can(user, "update", "Lead")}
      fields={fields}
      views={views}
      canShareViews={canShareViews}
    />
  );
}
