import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Phone,
  Mail,
  MapPin,
  ShieldCheck,
  Ruler,
  ArrowLeft,
  Pencil,
  ListTodo,
  Hammer,
  Camera,
  Users,
  ClipboardCheck,
  DollarSign,
  CalendarClock,
  Calculator,
} from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getLeadDetail } from "@/server/modules/leads/queries";
import { getDealFinancials, getProjectPayout } from "@/server/modules/costs/queries";
import { isStageCommissionEligible, COMMISSION_GATE_LABEL } from "@/server/modules/payroll/eligibility";
import { DealFinancialsCard } from "@/components/portal/deal-financials";
import { ProjectPayoutCard } from "@/components/portal/project-payout";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { STAFF_ROLES, isAdmin } from "@/server/rbac/matrix";
import { EditJobDialog } from "@/components/portal/edit-job-dialog";
import { getProjectPhotoChecklists } from "@/server/modules/photos/queries";
import { getAppointmentDispositions, getInspectionOutcomes } from "@/server/modules/settings/queries";
import { SolarOpsCard } from "@/components/portal/solar-ops-card";
import { getLinkedDealSummary } from "@/server/modules/vertical/crossover-queries";
import { getRoofReport } from "@/server/modules/roof/queries";
import { RoofReportButton } from "@/components/portal/roof-report";
import { BuildPresentationButton } from "@/components/portal/build-presentation-button";
import { CashBidButton } from "@/components/portal/cash-bid-panel";
import { InsuranceContractButton } from "@/components/portal/insurance-contract-panel";
import { getCashBidsForLead } from "@/server/modules/cashbid/queries";
import { SendWelcomeCallButton } from "@/components/portal/send-welcome-call-button";
import { getActiveWelcomeCallTemplates } from "@/server/modules/welcome-call/queries";
import { PageHeader } from "@/components/portal/ui";
import { NoteForm } from "@/components/portal/note-form";
import { FilesSection } from "@/components/portal/files-section";
import { DealPhotos, type GroupPhoto } from "@/components/portal/deal-photos";
import { DealCallRecordings, type CallRecording } from "@/components/portal/deal-call-recordings";
import { PHOTO_GROUP_KEYS, type PhotoGroup } from "@/lib/photo-groups";
import { CALL_GROUP_KEYS, type CallGroup } from "@/lib/call-groups";
import { LeadTasks } from "@/components/portal/lead-tasks";
import { ProjectPhotos } from "@/components/portal/project-photos";
import { StartProductionButton } from "@/components/portal/start-production-button";
import { ProjectSchedule } from "@/components/portal/project-schedule";
import { DealActionsPanel } from "@/components/portal/deal-actions-panel";
import { ClaimInfoCard } from "@/components/portal/claim-info-card";
import { DealTypeToggle } from "@/components/portal/deal-type-toggle";
import { DealTabs } from "@/components/portal/deal-tabs";
import { getScopeForLead, listScopeTemplate } from "@/server/modules/scope/queries";
import { isScopeReady, stageAtOrAfterScope, canSeeScopeCosts } from "@/server/modules/scope/policies";
import { ScopeOfWorkPanel } from "@/components/portal/scope-of-work-panel";
import {
  ProjectStatusControl,
  QcChecklistEditor,
  CrewAssigner,
} from "@/components/portal/project-workflows";
import { Button } from "@/components/ui/button";
import { currentFormatters } from "@/lib/format-server";
import { serviceTypeLabel } from "@/lib/service-types";

export const metadata = { title: "Appointment" };

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const fmt = await currentFormatters();
  const { id } = await params;
  const user = await requireUser();
  const lead = await getLeadDetail(user, id);
  if (!lead) notFound();

  // Cash deals (customer pays out of pocket / financing) hide the insurance UI:
  // no claim worksheet, no scope of work, and "Status" instead of "Claim Status".
  const isInsurance = lead.dealType !== "cash";
  // One table backs both cash bids and insurance contracts; split by kind.
  const allBids = await getCashBidsForLead(user.companyId, lead.id);
  const cashBids = allBids.filter((b) => b.kind === "cash");
  const insuranceBids = allBids.filter((b) => b.kind === "insurance");

  const claim = lead.claims[0];
  const measurement = lead.roofMeasurements[0];
  const canNote = can(user, "create", "Note");
  const canAssign = can(user, "assign", "Task");

  // Production (the deal's job container). Created on demand via "Start production".
  const canManageProd = can(user, "create", "Project") || can(user, "update", "Project");
  const canAssignCrew = can(user, "assign", "Crew") || can(user, "update", "Project");
  const project = lead.project
    ? await prisma.project.findUnique({
        where: { id: lead.project.id },
        include: {
          crewAssignments: { include: { crew: { include: { members: true } } } },
        },
      })
    : null;

  // Admin/super-admin: edit any field on the job directly.
  const editableJob = project
    ? {
        id: project.id,
        projectNumber: project.projectNumber,
        status: project.status,
        priority: project.priority,
        serviceType: project.serviceType,
        address: project.address,
        city: project.city,
        state: project.state,
        zip: project.zip,
        roofingType: project.roofingType,
        materialSelection: project.materialSelection,
        pitch: project.pitch,
        tearOffLayers: project.tearOffLayers,
        contractValue: project.contractValue,
        supplementCents: project.supplementCents,
        deductibleCents: project.deductibleCents,
        depreciationCents: project.depreciationCents,
        repGetsSupplement: project.repGetsSupplement,
        repGetsDepreciation: project.repGetsDepreciation,
        companyProvidedLead: project.companyProvidedLead,
        scheduledStart: project.scheduledStart?.toISOString() ?? null,
        scheduledEnd: project.scheduledEnd?.toISOString() ?? null,
        installDate: project.installDate?.toISOString() ?? null,
        adjusterMeetingAt: project.adjusterMeetingAt?.toISOString() ?? null,
        completedAt: project.completedAt?.toISOString() ?? null,
        notes: project.notes,
      }
    : null;

  // Who can be tagged on a follow-up for THIS deal. Rules:
  //  • Management / office roles (owner, admin, sales manager, accounting, marketing): always.
  //  • The deal's OWN assigned rep: yes — but never another sales rep (can't tag Sahir on a Sunny deal).
  //  • Installers: only the installer(s) on the crew assigned to this job (once tagged), not every installer.
  //  • Canvassers: never (follow-ups don't go to canvassers).
  const ALWAYS_TAGGABLE = new Set(["super_admin", "admin", "manager", "accounting", "marketing"]);
  const dealRepId = lead.assignedRep?.id ?? null;
  const assignedInstallerUserIds = new Set(
    (project?.crewAssignments ?? [])
      .flatMap((a) => a.crew.members)
      .map((m) => m.userId)
      .filter((uid): uid is string => Boolean(uid))
  );
  const taskAssignees = canAssign
    ? (
        await prisma.user.findMany({
          where: { companyId: user.companyId, role: { in: STAFF_ROLES }, status: "active" },
          orderBy: { firstName: "asc" },
          select: { id: true, firstName: true, lastName: true, role: true },
        })
      ).filter((u) => {
        if (ALWAYS_TAGGABLE.has(u.role)) return true;
        if (u.role === "sales_rep") return u.id === dealRepId;
        if (u.role === "installer") return assignedInstallerUserIds.has(u.id);
        return false; // canvasser (and any other) — not taggable on follow-ups
      })
    : [];
  const photoChecklists = project ? await getProjectPhotoChecklists(user.companyId, project.id) : [];
  const crews =
    project && canAssignCrew
      ? await prisma.crew.findMany({ where: { companyId: user.companyId, active: true }, select: { id: true, name: true } })
      : [];
  const qcItems = (project?.qcChecklist as unknown as { label: string; done: boolean }[]) ?? [];

  // Deal financials (cost lines + margin split) — only for commission-capable roles.
  const dealFinancials = project && can(user, "read", "Commission")
    ? await getDealFinancials(user.companyId, project.id)
    : null;
  // Commissions/payroll only unlock once the deal reaches "Depreciation Requested".
  const commissionEligible = dealFinancials
    ? await isStageCommissionEligible(user.companyId, lead.stageId ?? null)
    : false;
  // Per-job commission payout breakdown (all recipients + total owed).
  const payout = project && can(user, "read", "Commission")
    ? await getProjectPayout(user.companyId, project.id)
    : null;

  // Customizable outcomes for the "Run appointment" picker. Keyed off the
  // DEAL's vertical, not the active workspace, so the picker always matches
  // the record being viewed.
  const appointmentDispositions = await getAppointmentDispositions(user.companyId, lead.vertical);
  const inspectionOutcomes = await getInspectionOutcomes(user.companyId, lead.vertical);
  const welcomeCallTemplates = can(user, "create", "Document") ? await getActiveWelcomeCallTemplates(user.companyId) : [];

  // Solar operations: the blocker/follow-up model and the re-roof crossover.
  // Roofing deals never render this — their stages are all internally owned.
  const isSolar = lead.vertical === "solar";
  const linkedDeal = isSolar || lead.linkedDealId
    ? await getLinkedDealSummary(user.companyId, lead.linkedDealId)
    : null;

  const roofReport = await getRoofReport(user.companyId, lead.id);
  const roofAddress = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ");

  // Scope of Work — job profitability calculator. Available once the deal reaches
  // "Scope Received" (by pipeline stage or claim status), gated by the Scope resource.
  const scopeReady =
    isScopeReady(lead.claimStatus) ||
    stageAtOrAfterScope(lead.pipeline?.stages ?? [], lead.stage?.id ?? null);
  // Scope of Work is an insurance-claim concept — hidden entirely for cash deals.
  const showScope = isInsurance && scopeReady && can(user, "read", "Scope");
  const scopeData = showScope ? await getScopeForLead(user, lead.id) : null;
  const scopeTemplate =
    showScope && canSeeScopeCosts(user.role) ? await listScopeTemplate(user.companyId, lead.vertical) : [];
  const claimLineCount = claim?.lineItems.length ?? 0;

  // Notes split by placement: general notes go to the Overview; outcome-tagged
  // notes are immutable logs shown under their outcome in the Summary panel.
  const serializeNote = (n: (typeof lead.noteEntries)[number]) => ({
    id: n.id,
    body: n.body,
    author: n.author ? `${n.author.firstName} ${n.author.lastName}` : "System",
    createdAt: n.createdAt.toISOString(),
  });
  const generalNotes = lead.noteEntries.filter((n) => !n.context);
  const appointmentNotes = lead.noteEntries.filter((n) => n.context === "appointment_outcome").map(serializeNote);
  const inspectionNotes = lead.noteEntries.filter((n) => n.context === "inspection_outcome").map(serializeNote);

  // Estimated property value (from canvassing AVM) — shown as a range with source.
  const pd = lead.propertyData as {
    value?: number; low?: number; high?: number; confidence?: string; matched?: boolean;
    source?: string; asOfDate?: string; lastSalePrice?: number; lastSaleDate?: string;
  } | null;
  const propertyValueLine =
    pd && pd.matched && pd.value != null
      ? `${pd.low != null && pd.high != null ? `${fmt.money(pd.low)}–${fmt.money(pd.high)}` : fmt.money(pd.value)}` +
        ` · est.${pd.source ? ` · ${pd.source}` : ""}${pd.confidence ? ` · ${pd.confidence} confidence` : ""}`
      : lead.propertyValue != null
        ? `${fmt.money(lead.propertyValue)}${lead.propertyValueSource ? ` · est. · ${lead.propertyValueSource}` : ""}`
        : null;
  const lastSaleLine =
    pd?.lastSalePrice != null
      ? `${fmt.money(pd.lastSalePrice)}${pd.lastSaleDate ? ` · ${pd.lastSaleDate.slice(0, 4)}` : ""}`
      : null;

  // The deal page is split into tabs to keep it scannable. Financials only shows
  // for commission-capable roles with a job.
  const showFinancials = !!(project && (payout || dealFinancials));
  const dealTabs = [
    { id: "overview", label: "Overview" },
    ...(showScope ? [{ id: "scope", label: "Scope of Work" }] : []),
    { id: "production", label: "Production" },
    ...(showFinancials ? [{ id: "financials", label: "Financials" }] : []),
    { id: "documents", label: "Documents" },
  ];

  return (
    <div className="space-y-6">
      <Link
        href="/portal/leads"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to appointments
      </Link>

      <PageHeader
        title={`${lead.firstName} ${lead.lastName}`}
        description={lead.source ? `Source: ${lead.source.name}` : undefined}
        action={
          <div className="flex items-center gap-2">
            {lead.stage && (
              <span
                className="rounded-full px-3 py-1 text-xs font-medium"
                style={{ backgroundColor: `${lead.stage.color}22`, color: lead.stage.color }}
              >
                {lead.stage.name}
              </span>
            )}
            {(can(user, "create", "Proposal") || can(user, "update", "Proposal")) && (
              <BuildPresentationButton leadId={lead.id} />
            )}
            {(can(user, "create", "Proposal") || can(user, "update", "Proposal")) && (
              <>
                <InsuranceContractButton
                  leadId={lead.id}
                  bids={insuranceBids}
                  prefill={{
                    carrier: claim?.carrier ?? "",
                    claimNumber: claim?.claimNumber ?? "",
                    deductibleDollars: claim?.deductible ? String(claim.deductible / 100) : "",
                  }}
                />
                <CashBidButton leadId={lead.id} bids={cashBids} />
              </>
            )}
            {editableJob && isAdmin(user.role) && <EditJobDialog job={editableJob} />}
            {can(user, "create", "Document") && (
              <SendWelcomeCallButton leadId={lead.id} templates={welcomeCallTemplates} />
            )}
            {can(user, "update", "Lead") && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/portal/leads/${lead.id}/edit`}>
                  <Pencil className="size-4" /> Edit
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DealTabs tabs={dealTabs}>
            {/* ── Overview ── */}
            <div data-deal-tab="overview" className="space-y-6">
          {isSolar && (
            <SolarOpsCard
              leadId={lead.id}
              stage={
                lead.stage
                  ? {
                      name: lead.stage.name,
                      stageType: lead.stage.stageType,
                      ownerRole: lead.stage.ownerRole,
                      targetDays: lead.stage.targetDays,
                      followUpDays: lead.stage.followUpDays,
                      isActionRequired: lead.stage.isActionRequired,
                    }
                  : null
              }
              stageChangedAt={lead.stageChangedAt ? lead.stageChangedAt.toISOString() : null}
              createdAt={lead.createdAt.toISOString()}
              blockedBy={lead.blockedBy}
              blockerNote={lead.blockerNote}
              lastTouchAt={lead.lastTouchAt ? lead.lastTouchAt.toISOString() : null}
              needsReroof={lead.needsReroof}
              needsMpu={lead.needsMpu}
              linkedDeal={linkedDeal}
              canEdit={can(user, "update", "Lead")}
            />
          )}

          {/* Contact */}
          <Card title="Contact">
            <div className="grid gap-4 sm:grid-cols-2">
              <Detail icon={Phone} label="Phone" value={lead.phone ?? "—"} />
              <Detail icon={Mail} label="Email" value={lead.email ?? "—"} />
              <Detail
                icon={MapPin}
                label="Address"
                value={[lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ") || "—"}
                full
              />
            </div>
            {lead.notes && (
              <p className="mt-4 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                {lead.notes}
              </p>
            )}
          </Card>

          {/* Notes */}
          <Card title="Notes & Activity">
            {canNote && <NoteForm leadId={lead.id} />}
            <ul className="mt-4 space-y-3">
              {generalNotes.length === 0 && (
                <li className="text-sm text-muted-foreground">No notes yet.</li>
              )}
              {generalNotes.map((n) => (
                <li key={n.id} className="rounded-lg border border-border bg-background p-3">
                  <p className="text-sm">{n.body}</p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {n.author ? `${n.author.firstName} ${n.author.lastName}` : "System"} ·{" "}
                    {fmt.date(n.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
          {/* Claim — insurance deals only. Roof info / line items / supplements
              live in Scope of Work; only claim tracking + amounts remain here.
              Cash deals show a plain cash card instead (no insurance fields). */}
          {!isInsurance ? (
            <Card title="Cash Deal" icon={ShieldCheck}>
              <p className="text-sm text-muted-foreground">
                This is a <strong>cash deal</strong> — the customer pays out of pocket or finances it; there&rsquo;s no
                insurance claim, deductible, or depreciation. Set the price in the proposal (<strong>Build Presentation</strong>).
              </p>
            </Card>
          ) : claim ? (
            <ClaimInfoCard
              leadId={lead.id}
              canEdit={can(user, "update", "Claim")}
              claimPrice={lead.claimPrice}
              canEditClaimPrice={can(user, "update", "Lead")}
              claim={{
                carrier: claim.carrier,
                claimNumber: claim.claimNumber,
                lossDate: claim.lossDate ? claim.lossDate.toISOString() : null,
                policyNumber: claim.policyNumber,
                adjusterName: claim.adjusterName,
                adjusterPhone: claim.adjusterPhone,
                adjusterEmail: claim.adjusterEmail,
                adjusterMeetingAt: claim.adjusterMeetingAt ? claim.adjusterMeetingAt.toISOString() : null,
                deductible: claim.deductible,
                rcv: claim.rcv,
                acv: claim.acv,
                depreciation: claim.depreciation,
              }}
            />
          ) : (
            <Card title="Claim Information" icon={ShieldCheck}>
              <p className="text-sm text-muted-foreground">
                No insurance claim opened yet. Use <strong>Open claim</strong> in the Summary to start the claim worksheet.
              </p>
            </Card>
          )}
            </div>

            {/* ── Scope of Work (job profitability) ── */}
            {showScope && (
              <div data-deal-tab="scope" className="space-y-6">
                <Card title="Scope of Work" icon={Calculator}>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Cost the job: enter what insurance pays vs. our cost per line and see the profit and margin.
                  </p>
                  <ScopeOfWorkPanel
                    leadId={lead.id}
                    scope={scopeData}
                    canEdit={can(user, "update", "Scope")}
                    canSeeCosts={canSeeScopeCosts(user.role)}
                    hasClaimLines={claimLineCount > 0}
                    hasTemplate={scopeTemplate.length > 0}
                  />
                </Card>
              </div>
            )}

            {/* ── Production ── */}
            <div data-deal-tab="production" className="space-y-6">
          {/* Production (job): crew, QC, daily reports, site & install photos */}
          <Card title="Production" icon={Hammer}>
            {can(user, "update", "Lead") && (
              <div className="mb-6 flex items-center justify-between gap-2 border-b border-border pb-4">
                <div>
                  <p className="text-sm font-medium">Aerial roof measurements</p>
                  <p className="text-xs text-muted-foreground">Trace the roof to estimate squares for the scope.</p>
                </div>
                <RoofReportButton
                  leadId={lead.id}
                  address={roofAddress || `${lead.firstName} ${lead.lastName}`}
                  initialFacets={roofReport?.facets ?? []}
                  initialWaste={roofReport?.wastePct ?? 12}
                  hasReport={!!roofReport}
                />
              </div>
            )}
            {!project ? (
              canManageProd ? (
                <StartProductionButton leadId={lead.id} />
              ) : (
                <p className="text-sm text-muted-foreground">This deal isn&rsquo;t in production yet.</p>
              )
            ) : (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">Job {project.projectNumber}</span>
                  <ProjectStatusControl projectId={project.id} status={project.status} />
                </div>

                <Section icon={CalendarClock} label="Schedule">
                  <ProjectSchedule
                    projectId={project.id}
                    installDate={project.installDate ? project.installDate.toISOString() : null}
                    canManage={canManageProd}
                  />
                </Section>

                <Section icon={Camera} label="Site & Install Photos">
                  <ProjectPhotos projectId={project.id} checklists={photoChecklists} />
                </Section>

                <Section icon={Users} label="Crew">
                  {canAssignCrew ? (
                    <CrewAssigner
                      projectId={project.id}
                      crews={crews}
                      assignments={project.crewAssignments.map((a) => ({
                        id: a.id,
                        crewName: a.crew.name,
                        members: a.crew.members.length,
                      }))}
                    />
                  ) : project.crewAssignments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No crew assigned.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {project.crewAssignments.map((a) => (
                        <li key={a.id}>{a.crew.name} · {a.crew.members.length} members</li>
                      ))}
                    </ul>
                  )}
                </Section>

                <Section icon={ClipboardCheck} label="QC Checklist">
                  <QcChecklistEditor projectId={project.id} items={qcItems} />
                </Section>
              </div>
            )}
          </Card>
            </div>

            {/* ── Financials ── */}
            {showFinancials && (
            <div data-deal-tab="financials" className="space-y-6">
          {/* Commission payout breakdown — every recipient on this job + total owed */}
          {project && payout && (
            <Card title="Commission Payout" icon={DollarSign}>
              <ProjectPayoutCard payout={payout} canManage={can(user, "approve", "Commission")} />
            </Card>
          )}

          {/* Deal financials — costs + margin split (commission roles only) */}
          {project && dealFinancials && (
            <Card title="Deal Financials" icon={DollarSign}>
              <DealFinancialsCard
                financials={dealFinancials}
                projectId={project.id}
                canManage={can(user, "update", "Commission")}
                commissionEligible={commissionEligible}
                gateLabel={COMMISSION_GATE_LABEL}
              />
            </Card>
          )}
            </div>
            )}

            {/* ── Documents & files ── */}
            <div data-deal-tab="documents" className="space-y-6">
          {/* One place for everything: e-signature documents + all file/photo
              attachments. Survey/Install photo checklists are the header buttons. */}
          <FilesSection
            title="Documents & Files"
            files={lead.files
              .filter(
                (f) =>
                  !PHOTO_GROUP_KEYS.includes(f.category as PhotoGroup) &&
                  !CALL_GROUP_KEYS.includes(f.category as CallGroup)
              )
              .map((f) => ({
                id: f.id,
                name: f.name,
                kind: f.kind,
                mimeType: f.mimeType,
                uploadedBy: f.uploadedBy ? `${f.uploadedBy.firstName} ${f.uploadedBy.lastName}` : null,
              }))}
            leadId={lead.id}
            canUpload={can(user, "create", "File")}
            canDelete={can(user, "create", "File")}
            headerActions={
              <DealPhotos
                leadId={lead.id}
                projectId={project?.id ?? null}
                checklists={photoChecklists}
                photos={lead.files
                  .filter((f) => f.kind === "photo" && PHOTO_GROUP_KEYS.includes(f.category as PhotoGroup))
                  .map((f) => ({ id: f.id, name: f.name, group: f.category as PhotoGroup }) satisfies GroupPhoto)}
                canUpload={can(user, "create", "File")}
                canDelete={can(user, "create", "File")}
              />
            }
          >
            {/* E-signature documents, folded into the same card. */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Documents
              </p>
              {lead.documentPackages.length === 0 ? (
                <p className="text-sm text-muted-foreground">No documents yet.</p>
              ) : (
                <ul className="space-y-2">
                  {lead.documentPackages.map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/portal/documents/${d.id}`}
                        className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm hover:border-gold/40"
                      >
                        <span className="font-medium">{d.title}</span>
                        <span className="text-xs capitalize text-muted-foreground">{d.status.replace(/_/g, " ")}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Dedicated Welcome Call / QC Call recording slots. */}
            <DealCallRecordings
              leadId={lead.id}
              recordings={lead.files
                .filter((f) => CALL_GROUP_KEYS.includes(f.category as CallGroup))
                .map((f) => ({ id: f.id, name: f.name, group: f.category as CallGroup }) satisfies CallRecording)}
              canUpload={can(user, "create", "File")}
              canDelete={can(user, "create", "File")}
            />
          </FilesSection>
            </div>
          </DealTabs>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card title="Summary">
            <div className="space-y-3">
              <Detail label="Project Type" value={serviceTypeLabel(lead.serviceType)} />
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deal Type</span>
                <DealTypeToggle leadId={lead.id} value={isInsurance ? "insurance" : "cash"} canEdit={can(user, "update", "Lead")} />
              </div>
              {propertyValueLine && <Detail label="Property Value" value={propertyValueLine} />}
              {lastSaleLine && <Detail label="Last Sale" value={lastSaleLine} />}
              <Detail
                label="Assigned Rep"
                value={
                  lead.assignedRep
                    ? `${lead.assignedRep.firstName} ${lead.assignedRep.lastName}`
                    : "Unassigned"
                }
              />
              {isInsurance && <Detail label="Claim Status" value={lead.claimStatus.replace(/_/g, " ")} />}
              <Detail
                label="Appointment Date"
                value={lead.appointmentAt ? fmt.dateTime(lead.appointmentAt) : "Not scheduled"}
              />
              <Detail label="Created" value={fmt.date(lead.createdAt)} />
            </div>

            {/* Appointment run + open claim — consolidated into the Summary card */}
            <DealActionsPanel
              leadId={lead.id}
              disposition={lead.appointmentDisposition}
              appointmentNote={lead.appointmentNote}
              appointmentNotes={appointmentNotes}
              dispositions={appointmentDispositions}
              inspectionOutcome={lead.inspectionOutcome}
              inspectionNote={lead.inspectionNote}
              inspectionNotes={inspectionNotes}
              inspectionOutcomes={inspectionOutcomes}
              claim={
                claim
                  ? {
                      carrier: claim.carrier,
                      claimNumber: claim.claimNumber,
                      policyNumber: claim.policyNumber,
                      adjusterName: claim.adjusterName,
                      adjusterPhone: claim.adjusterPhone,
                      adjusterEmail: claim.adjusterEmail,
                      lossDate: claim.lossDate ? claim.lossDate.toISOString() : null,
                      deductible: claim.deductible,
                      rcv: claim.rcv,
                      acv: claim.acv,
                      depreciation: claim.depreciation,
                    }
                  : null
              }
              canEditLead={can(user, "update", "Lead")}
              canEditClaim={can(user, "update", "Claim")}
            />
          </Card>

          {/* Follow-ups on the side, next to the summary */}
          <Card title="Follow-ups & Tasks" icon={ListTodo}>
            <LeadTasks
              leadId={lead.id}
              tasks={lead.tasks.map((t) => ({
                id: t.id,
                title: t.title,
                status: t.status,
                dueAt: t.dueAt ? t.dueAt.toISOString() : null,
                assignee: t.assignee ? `${t.assignee.firstName} ${t.assignee.lastName}` : null,
              }))}
              assignees={taskAssignees.map((a) => ({ id: a.id, name: `${a.firstName} ${a.lastName}` }))}
              canCreate={can(user, "create", "Task")}
              canManage={can(user, "update", "Task")}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="size-4 text-gold" /> {label}
      </h3>
      {children}
    </div>
  );
}

function Card({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
        {Icon && <Icon className="size-4 text-gold" />}
        <h2 className="font-semibold">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Detail({
  icon: Icon,
  label,
  value,
  full,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </div>
      <div className="mt-1 font-medium capitalize">{value}</div>
    </div>
  );
}
