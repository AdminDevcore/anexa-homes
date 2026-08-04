import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ListTodo,
  Hammer,
  Camera,
  Users,
  ClipboardCheck,
  DollarSign,
  Calculator,
  Zap,
  Satellite,
  Landmark,
  MessageSquare,
  Sun,
  FolderOpen,
  FileSignature,
} from "lucide-react";
import { requireUser, getSessionUser } from "@/server/auth/session";
import { getLeadDetail, getLeadFormOptions } from "@/server/modules/leads/queries";
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
import {
  SolarSystemMoneyPanel,
  SolarDocumentFolders,
  SolarActivityFeed,
  SolarQuickActions,
  SolarDeferredPanels,
} from "@/components/portal/solar-cockpit";
import { DealProgressBar, DealStageActions } from "@/components/portal/deal-stage-bar";
import { SOLAR_FOLDER_KEYS } from "@/lib/solar-folders";
import { pricePurchase } from "@/lib/solar-money";
import { getLinkedDealSummary } from "@/server/modules/vertical/crossover-queries";
import { SolarDesignPanel, SolarFinancePanel, SolarProposalGate } from "@/components/portal/solar-panels";
import { getSolarSettings } from "@/server/modules/solar/settings";
import { BuildPresentationButton } from "@/components/portal/build-presentation-button";
import { CashBidButton } from "@/components/portal/cash-bid-panel";
import { InsuranceContractButton } from "@/components/portal/insurance-contract-panel";
import { getCashBidsForLead } from "@/server/modules/cashbid/queries";
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
import { SolarProductToggle } from "@/components/portal/solar-product-toggle";
import { PropertyView } from "@/components/portal/property-view";
import { DealSummaryCards, type SummaryCard } from "@/components/portal/deal-summary-cards";
import { DealSummaryPanel } from "@/components/portal/deal-summary-panel";
import { HomeownerCard } from "@/components/portal/homeowner-card";
import { FinancingTermsPanel } from "@/components/portal/solar/financing-terms";
import { Card, Section } from "@/components/portal/deal-ui";
import { DealSlides, type DealSlideDef } from "@/components/portal/deal-slides";
import { getScopeForLead, listScopeTemplate } from "@/server/modules/scope/queries";
import { isScopeReady, stageAtOrAfterScope, canSeeScopeCosts } from "@/server/modules/scope/policies";
import { ScopeOfWorkPanel } from "@/components/portal/scope-of-work-panel";
import {
  ProjectStatusControl,
  QcChecklistEditor,
  CrewAssigner,
} from "@/components/portal/project-workflows";
import { currentFormatters } from "@/lib/format-server";
import { serviceTypeLabel, serviceTypeOptions } from "@/lib/service-types";
import { utcToZonedWallClock } from "@/lib/tz";
import { daysInStage } from "@/lib/stage-status";

/**
 * Roofing books an "appointment"; solar works a "deal". The title follows the
 * vertical rather than imposing roofing's vocabulary on both.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return { title: "Deal" };
  const lead = await prisma.lead.findFirst({
    where: { companyId: user.companyId, id },
    select: { vertical: true },
  });
  return { title: lead?.vertical === "solar" ? "Deal" : "Appointment" };
}

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
  // Solar has no adjuster, no claim and no insurance scope. Those concepts are
  // HIDDEN here, never deleted — Claim holds live roofing money.
  const isSolarDeal = lead.vertical === "solar";
  const isInsurance = !isSolarDeal && lead.dealType !== "cash";
  // One table backs both cash bids and insurance contracts; split by kind.
  const allBids = await getCashBidsForLead(user.companyId, lead.id);
  const cashBids = allBids.filter((b) => b.kind === "cash");
  const insuranceBids = allBids.filter((b) => b.kind === "insurance");

  const claim = lead.claims[0];
  const canNote = can(user, "create", "Note");
  const canAssign = can(user, "assign", "Task");
  // Lead sources and staff, for the sidebar cards' inline editors. Fetched here
  // rather than inside them because those are client components and this is the
  // only place with a session to scope the query by.
  const formOptions = await getLeadFormOptions(user.companyId, lead.vertical);
  // Appointments are stored as instants but entered as wall-clock times, so the
  // Summary card's datetime input has to be seeded in the company's zone.
  const companyTz =
    (await prisma.company.findUnique({ where: { id: user.companyId }, select: { timezone: true } }))
      ?.timezone || "America/Chicago";

  // Production (the deal's job container). Created on demand via "Start production".
  const canManageProd = can(user, "create", "Project") || can(user, "update", "Project");
  const canAssignCrew = can(user, "assign", "Crew") || can(user, "update", "Project");
  const project = lead.project
    ? await prisma.project.findUnique({
        where: { id: lead.project.id },
        include: {
          crewAssignments: { include: { crew: { include: { members: true } } } },
          // The relation already existed; it was simply never fetched, so the
          // project manager's name could not be shown anywhere on the deal.
          manager: { select: { firstName: true, lastName: true } },
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

  // Solar operations: the blocker/follow-up model and the re-roof crossover.
  // Roofing deals never render this — their stages are all internally owned.
  const [solarDesign, solarFinance, solarSettings, solarEquipment, solarProposals, creditApps] = isSolarDeal
    ? await Promise.all([
        prisma.solarDesign.findUnique({
          where: { leadId: lead.id },
          include: {
            module: { select: { manufacturer: true, model: true, ratingW: true } },
            inverter: { select: { manufacturer: true, model: true } },
            battery: { select: { manufacturer: true, model: true } },
          },
        }),
        prisma.solarFinance.findUnique({ where: { leadId: lead.id } }),
        getSolarSettings(user.companyId),
        prisma.solarEquipment.findMany({
          where: { companyId: user.companyId, isActive: true },
          orderBy: [{ kind: "asc" }, { rank: "asc" }, { model: "asc" }],
          select: { id: true, kind: true, manufacturer: true, model: true, ratingW: true },
        }),
        prisma.solarProposal.findMany({
          where: { companyId: user.companyId, leadId: lead.id },
          orderBy: { version: "desc" },
          select: {
            id: true, version: true, status: true, publicToken: true, supersededAt: true,
            sentAt: true, viewedAt: true, signedAt: true, createdAt: true,
          },
        }),
        // A deal can be shopped to several lenders (declined by one, approved by
        // the next), so this is a LIST. The one that matters is picked below.
        prisma.creditApplication.findMany({
          where: { companyId: user.companyId, leadId: lead.id },
          orderBy: { createdAt: "desc" },
        }),
      ])
    : [null, null, null, [], [], []];
  const equipOptions = (kind: string) =>
    solarEquipment
      .filter((e) => e.kind === kind)
      .map((e) => ({
        id: e.id,
        label: `${e.manufacturer ? `${e.manufacturer} ` : ""}${e.model}${e.ratingW ? ` · ${e.ratingW}W` : ""}`,
        ratingW: e.ratingW,
      }));
  const linkedDeal = isSolarDeal || lead.linkedDealId
    ? await getLinkedDealSummary(user.companyId, lead.linkedDealId)
    : null;

  const [solarMilestones, solarFeed] = isSolarDeal
    ? await Promise.all([
        prisma.solarMilestone.findMany({
          where: { companyId: user.companyId, leadId: lead.id },
          orderBy: [{ payee: "asc" }, { sequence: "asc" }],
        }),
        prisma.dealFeedPost.findMany({
          where: { companyId: user.companyId, leadId: lead.id },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { author: { select: { firstName: true, lastName: true } } },
        }),
      ])
    : [[], []];

  // The pricing breakdown is DERIVED from the design + finance rows — no new
  // figures are entered anywhere, so it can never disagree with the proposal.
  const solarMoney = (() => {
    if (!isSolarDeal || !solarDesign) return null;
    const watts = Math.round(solarDesign.systemSizeKwDc * 1000);
    const fin = solarFinance;
    const breakdown = fin && (fin.product === "cash" || fin.product === "loan")
      ? pricePurchase({
          product: fin.product,
          systemSizeKwDc: solarDesign.systemSizeKwDc,
          grossPpwCents: fin.grossPpwCents,
          dealerFeePct: fin.dealerFeePct,
          adderTotalCents: fin.adderTotalCents,
        })
      : null;
    return {
      sizeKwDc: solarDesign.systemSizeKwDc,
      year1ProductionKwh: solarDesign.year1ProductionKwh,
      offsetPct: solarDesign.offsetPct,
      moduleLabel: solarDesign.module
        ? `${solarDesign.module.manufacturer ? `${solarDesign.module.manufacturer} ` : ""}${solarDesign.module.model}`
        : null,
      moduleQty: solarDesign.moduleQty,
      inverterLabel: solarDesign.inverter?.model ?? null,
      batteryLabel: solarDesign.battery?.model ?? null,
      product: fin?.product ?? null,
      systemWatts: watts,
      basePpwCents: fin?.grossPpwCents ?? 0,
      adderPpwCents: watts > 0 ? Math.round((fin?.adderTotalCents ?? 0) / watts) : 0,
      dealerFeeCents: breakdown?.dealerFeeCents ?? 0,
      dealerFeePpwCents: watts > 0 ? Math.round((breakdown?.dealerFeeCents ?? 0) / watts) : 0,
      finalPpwCents: Math.round(breakdown?.netPpwCents ?? 0),
      contractPriceCents: fin?.contractPriceCents ?? 0,
    };
  })();

  // Which lender is actually funding this deal. A deal shopped to four lenders
  // has four rows, and the newest is often a decline that arrived after the
  // approval — so rank by decision quality first and fall back to recency,
  // rather than showing whichever application was created last.
  const CREDIT_RANK = ["approved", "conditional", "submitted", "not_submitted", "declined", "expired"];
  const creditApp =
    CREDIT_RANK.map((s) => creditApps.find((a) => a.status === s)).find(Boolean) ??
    creditApps[0] ??
    null;

  // Lender terms + product terms, merged. Both halves already existed in the
  // schema with no UI: CreditApplication was written by the lender webhook and
  // never read, and SolarFinance.aprPct / loanTermMonths were saved and never
  // rendered. The credit application wins where they overlap — it is the
  // lender's own decision, not our record of it.
  const financingTerms = isSolarDeal
    ? {
        product: solarFinance?.product ?? null,
        lender: creditApp?.lender ?? null,
        creditStatus: creditApp?.status ?? null,
        amountFinancedCents: creditApp?.amountCents || null,
        aprPct: creditApp?.aprPct ?? solarFinance?.aprPct ?? null,
        termMonths: creditApp?.termMonths ?? solarFinance?.loanTermMonths ?? null,
        dealerFeePct: creditApp?.dealerFeePct ?? solarFinance?.dealerFeePct ?? null,
        stipulations: Array.isArray(creditApp?.stipulations)
          ? (creditApp.stipulations as unknown[]).filter((s): s is string => typeof s === "string")
          : [],
        downPaymentCents: solarFinance?.downPaymentCents ?? null,
        loanMonthlyPaymentCents: solarFinance?.loanMonthlyPaymentCents ?? null,
        monthlyPaymentCents: solarFinance?.monthlyPaymentCents ?? null,
        escalatorPct: solarFinance?.escalatorPct ?? null,
        rateMillsPerKwh: solarFinance?.rateMillsPerKwh ?? null,
      }
    : null;

  // The at-a-glance row under the customer name. Cards with no value are
  // dropped rather than rendered empty — see DealSummaryCards.
  //
  // Stage is the one card BOTH verticals carry; after that the two businesses
  // are judged on different things, so the lists diverge rather than being
  // forced into one shape.
  // The deal's own pipeline, trimmed to what the client components need. Shared
  // by the header actions and the progress bar so the two can never disagree
  // about which stage is next or which one means dead.
  const stageLite = (lead.pipeline?.stages ?? []).map((st) => ({
    id: st.id,
    name: st.name,
    position: st.position,
    color: st.color,
    isLost: st.isLost,
  }));

  const summaryCards: SummaryCard[] = [];
  {
    const stageIndex = lead.pipeline
      ? lead.pipeline.stages.findIndex((s) => s.id === lead.stage?.id)
      : -1;
    // The shared helper, not an inline Date.now(): the purity lint rule bans
    // calling an impure function during render, and this is the same figure the
    // pipeline board and the SLA alert job already compute.
    const inStage = daysInStage(lead.stageChangedAt, lead.createdAt);
    // Progress counts the stages a deal moves THROUGH. Cancelled lives in the
    // pipeline but is a dead end, and counting it made a 21-stage roofing job
    // read "step 4 of 22". A cancelled deal gets no step at all.
    const liveStages = (lead.pipeline?.stages ?? []).filter((s) => !s.isLost);
    const showStep = stageIndex >= 0 && !lead.stage?.isLost;
    if (lead.stage) {
      summaryCards.push({
        label: "Current stage",
        value: lead.stage.name,
        hint: [
          showStep ? `Step ${stageIndex + 1} of ${liveStages.length}` : null,
          `${inStage}d in stage`,
        ]
          .filter(Boolean)
          .join(" · "),
        accent: lead.stage.color,
      });
    }
  }
  if (!isSolarDeal) {
    const claimStatus = lead.claimStatus.replace(/_/g, " ");
    summaryCards.push({
      label: "Deal type",
      value: isInsurance ? "Insurance" : "Cash",
      hint: isInsurance
        ? `Claim ${claimStatus}`
        : "Out of pocket / financed",
    });
    if (claim?.carrier) {
      summaryCards.push({
        label: "Carrier",
        value: claim.carrier,
        hint: claim.claimNumber ? `Claim ${claim.claimNumber}` : undefined,
      });
    }
    if (lead.assignedRep) {
      summaryCards.push({
        label: "Assigned rep",
        value: `${lead.assignedRep.firstName} ${lead.assignedRep.lastName}`,
      });
    }
    // `claimPrice` is the CONTRACT price set from the scope — the real number.
    // Deliberately not `lead.value`, the rep's estimate: that was removed from
    // this page on purpose and must not come back as a headline figure.
    if (lead.claimPrice) {
      summaryCards.push({ label: "Contract value", value: fmt.money(lead.claimPrice) });
    }
  }
  if (isSolarDeal) {
    if (creditApp?.lender) {
      const status = creditApp.status.replace(/_/g, " ");
      summaryCards.push({
        label: "Financier",
        value: creditApp.lender,
        hint: status.charAt(0).toUpperCase() + status.slice(1),
      });
    }
    if (solarDesign && solarDesign.systemSizeKwDc > 0) {
      summaryCards.push({
        label: "System size",
        value: `${solarDesign.systemSizeKwDc.toFixed(2)} kW`,
        hint: solarDesign.moduleQty > 0 ? `${solarDesign.moduleQty} panels` : undefined,
      });
    }
    if (project?.manager) {
      summaryCards.push({
        label: "Project manager",
        value: `${project.manager.firstName} ${project.manager.lastName}`,
      });
    }
    if (lead.assignedRep) {
      summaryCards.push({
        label: "Sales rep",
        value: `${lead.assignedRep.firstName} ${lead.assignedRep.lastName}`,
      });
    }
  }

  const solarFolderCounts = isSolarDeal
    ? Object.fromEntries(
        SOLAR_FOLDER_KEYS.map((k) => [k, lead.files.filter((f) => f.category === k).length])
      )
    : {};


  // Scope of Work — job profitability calculator. Available once the deal reaches
  // "Scope Received" (by pipeline stage or claim status), gated by the Scope resource.
  const scopeReady =
    isScopeReady(lead.claimStatus) ||
    stageAtOrAfterScope(lead.pipeline?.stages ?? [], lead.stage?.id ?? null);
  // Scope of Work is an insurance-claim concept — hidden entirely for cash deals.
  const showScope = !isSolarDeal && isInsurance && scopeReady && can(user, "read", "Scope");
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

  // The deal page is ONE page: every section is rendered in a single column and
  // reached by scrolling. There is no tab bar — nothing on a deal is hidden
  // behind a click. Financials only shows for commission-capable roles with a job.
  const showFinancials = !!(project && (payout || dealFinancials));

  // The one switcher on the page. Financials is omitted entirely rather than
  // shown empty: it is gated on `can(read, Commission)` AND an existing job, so
  // a sales rep sees two slides, not three with a locked one.
  const dealSlides: DealSlideDef[] = [
    { id: "claim", label: "Claim Info" },
    { id: "field", label: "Field Production" },
    ...(showFinancials ? [{ id: "financials", label: "Deal Financials" }] : []),
  ];

  return (
    <div className="space-y-6">
      <Link
        href="/portal/leads"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {isSolarDeal ? "Back to deals" : "Back to appointments"}
      </Link>

      <PageHeader
        title={`${lead.firstName} ${lead.lastName}`}
        description={lead.source ? `Source: ${lead.source.name}` : undefined}
        action={
          // Actions ON the record: move it, kill it. Move and Cancel used to
          // live down in the progress bar, which is a readout — you look there
          // to see how far along a job is, not to operate on it. The three
          // roofing contract tools moved to the Documents tab, beside the
          // documents they produce.
          //
          // No Edit button here. A blanket "Edit" that threw you onto a separate
          // form for the whole lead is the wrong shape for the work: a rep fixes
          // ONE wrong phone number, and every card now carries its own Edit that
          // opens exactly the fields it shows. "Edit Job" moved to the Field
          // Production slide, next to the job number it edits.
          <div className="flex flex-wrap items-center gap-2">
            {lead.pipeline && (
              <DealStageActions
                leadId={lead.id}
                stages={stageLite}
                currentStageId={lead.stage?.id ?? null}
                canEdit={can(user, "update", "Lead")}
              />
            )}
          </div>
        }
      />

      {/* One calm row of secondary actions, replacing the five full-width tiles
          that used to open the Overview in their own card. */}
      {isSolarDeal && (
        <SolarQuickActions
          leadId={lead.id}
          proposalToken={solarProposals[0]?.publicToken ?? null}
          canEdit={can(user, "update", "Lead")}
          homeownerInvited={!!lead.customerUserId}
        />
      )}

      <DealSummaryCards
        cards={summaryCards}
        accent={isSolarDeal ? "var(--solar)" : "var(--gold)"}
      />

      {/* Both verticals get the real progress bar off their own pipeline's
          stages. Roofing used to get a single status chip in the header, which
          said where the deal was but never how far along that made it. */}
      {lead.pipeline && (
        <DealProgressBar
          leadId={lead.id}
          stages={stageLite}
          currentStageId={lead.stage?.id ?? null}
          canEdit={can(user, "update", "Lead")}
          daysInStage={daysInStage(lead.stageChangedAt, lead.createdAt)}
        />
      )}

      {/* `items-start` is load-bearing: a grid item stretches to the row's
          height by default, and a full-height sidebar can never stick. */}
      {/* The sidebar is a fixed 22rem rail rather than a fraction of the grid:
          it only ever holds labels and short values, so letting it grow with
          the viewport just stretched whitespace and squeezed the map, tables
          and photo grids in the main column. `minmax(0,1fr)` + `min-w-0` keep
          wide children (satellite map, scope tables) from blowing the track
          out instead of scrolling inside it. */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
            {/* ── Overview ── */}
            <section id="overview" className="scroll-mt-24 space-y-6">
          {/* The property leads the Overview on both verticals — solar sells a
              roof it has to fit an array onto, roofing sells the roof itself. */}
          <Card
            title="Property"
            icon={Satellite}
            tone={isSolarDeal ? "solar" : "brand"}
            description={
              isSolarDeal
                ? "Panel layout still needs a design provider — imagery only for now"
                : "Aerial imagery. Trace and measure the roof in Production."
            }
          >
            <PropertyView
              leadId={lead.id}
              address={[lead.address, [lead.city, lead.state].filter(Boolean).join(", "), lead.zip]
                .filter(Boolean)
                .join(" · ")}
              geoStamp={lead.geocodedAt?.toISOString() ?? null}
            />
          </Card>

          {/* System, pricing, payment schedule AND the lender's terms in one
              card. These were two separate concerns on two separate surfaces,
              which is why nobody could answer "what did they get approved for"
              without leaving the page. */}
          {isSolarDeal && (
            <Card title="System & financing" icon={Zap} tone="solar">
              <div className="space-y-6">
                <SolarSystemMoneyPanel
                  leadId={lead.id}
                  canEdit={can(user, "update", "Lead")}
                  money={solarMoney}
                  milestones={solarMilestones.map((m) => ({
                  id: m.id, payee: m.payee, sequence: m.sequence, label: m.label,
                  amountCents: m.amountCents, trigger: m.trigger,
                  expectedAt: m.expectedAt?.toISOString() ?? null,
                  paidAt: m.paidAt?.toISOString() ?? null,
                }))}
                />
                {financingTerms && (
                  <div className="border-t border-border pt-5">
                    <Section icon={Landmark} label="Financing & lender" tone="solar">
                      <FinancingTermsPanel terms={financingTerms} />
                    </Section>
                  </div>
                )}
              </div>
            </Card>
          )}

          {isSolarDeal && (
            <Card title="Activity" icon={MessageSquare} tone="solar">
              <SolarActivityFeed
                leadId={lead.id}
                canPost={can(user, "read", "Lead")}
                posts={solarFeed.map((f) => ({
                  id: f.id,
                  channel: f.channel,
                  body: f.body,
                  author: f.author ? `${f.author.firstName} ${f.author.lastName}`.trim() : "System",
                  createdAt: f.createdAt.toISOString(),
                }))}
              />
            </Card>
          )}

          {isSolarDeal && <SolarDeferredPanels />}

          {isSolarDeal && (
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

          {/* Notes — roofing only. On solar the channelled Activity feed above
              replaces this: same job, but with an audience on every post. */}
          {!isSolarDeal && (
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
          )}
          {/* Claim · Field production · Financials — three readings of the same
              job, one at a time. See DealSlides for why this is the one place on
              an otherwise single-scroll page that hides content behind a click. */}
          {!isSolarDeal && (
            <DealSlides slides={dealSlides}>
              {/* ── Claim info ── */}
              <div data-deal-slide="claim">
                {!isInsurance ? (
                  <p className="text-sm text-muted-foreground">
                    This is a <strong>cash deal</strong> — the customer pays out of pocket or finances it; there&rsquo;s no
                    insurance claim, deductible, or depreciation. Set the price in the proposal (<strong>Build Presentation</strong>).
                  </p>
                ) : claim ? (
                  <ClaimInfoCard
                    bare
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
                  <p className="text-sm text-muted-foreground">
                    No insurance claim opened yet. Use <strong>Open claim</strong> in the Summary to start the claim worksheet.
                  </p>
                )}
              </div>

              {/* ── Field production: what the crew photographs and checks off ── */}
              <div data-deal-slide="field" className="space-y-6">
                {!project ? (
                  canManageProd ? (
                    <StartProductionButton leadId={lead.id} />
                  ) : (
                    <p className="text-sm text-muted-foreground">This deal isn&rsquo;t in production yet.</p>
                  )
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">Job {project.projectNumber}</span>
                      <div className="flex items-center gap-2">
                        {editableJob && isAdmin(user.role) && <EditJobDialog job={editableJob} />}
                        <ProjectStatusControl projectId={project.id} status={project.status} />
                      </div>
                    </div>

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
                  </>
                )}
              </div>

              {/* ── Deal financials (+ the payout breakdown) ── */}
              {showFinancials && (
                <div data-deal-slide="financials" className="space-y-6">
                  {project && dealFinancials && (
                    <DealFinancialsCard
                      financials={dealFinancials}
                      projectId={project.id}
                      canManage={can(user, "update", "Commission")}
                      commissionEligible={commissionEligible}
                      gateLabel={COMMISSION_GATE_LABEL}
                    />
                  )}
                  {project && payout && (
                    <Section icon={DollarSign} label="Commission Payout">
                      <ProjectPayoutCard payout={payout} canManage={can(user, "approve", "Commission")} />
                    </Section>
                  )}
                </div>
              )}
            </DealSlides>
          )}
            </section>

            {/* ── Scope of Work (job profitability) ── */}
            {showScope && (
              <section id="scope" className="scroll-mt-24 space-y-6">
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
              </section>
            )}

            {/* ── Proposal (solar): design → financing → generate, in order ── */}
            {isSolarDeal && (
              <section id="proposal" className="scroll-mt-24 space-y-6">
                <Card title="1 · System Design" icon={Hammer} tone="solar">
                  <SolarDesignPanel
                    leadId={lead.id}
                    design={solarDesign}
                    modules={equipOptions("module")}
                    inverters={equipOptions("inverter")}
                    batteries={equipOptions("battery")}
                    canEdit={can(user, "update", "Lead")}
                  />
                </Card>

                <Card title="2 · Financing" icon={Landmark} tone="solar">
                  <SolarFinancePanel
                    leadId={lead.id}
                    finance={solarFinance}
                    itcDisclaimer={solarSettings?.incentiveDisclaimer ?? ""}
                    federalItcPct={solarSettings?.federalItcPct ?? null}
                    canEdit={can(user, "update", "Lead")}
                  />
                </Card>

                <Card title="3 · Generate & send" icon={Sun} tone="solar">
                  <SolarProposalGate
                    leadId={lead.id}
                    canEdit={can(user, "create", "Proposal")}
                    versions={solarProposals.map((v) => ({
                      id: v.id,
                      version: v.version,
                      status: v.status,
                      publicToken: v.publicToken,
                      supersededAt: v.supersededAt?.toISOString() ?? null,
                      sentAt: v.sentAt?.toISOString() ?? null,
                      viewedAt: v.viewedAt?.toISOString() ?? null,
                      signedAt: v.signedAt?.toISOString() ?? null,
                      createdAt: v.createdAt.toISOString(),
                    }))}
                  />
                </Card>
              </section>
            )}

            {/* ── Operations (solar only) ──
                Roofing's equivalent is the "Field production" slide above; a
                roofing deal must not render this section twice. */}
            {isSolarDeal && (
            <section id="production" className="scroll-mt-24 space-y-6">
              <Card title="Operations" icon={Hammer} tone="solar">
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
                      <div className="flex items-center gap-2">
                        {editableJob && isAdmin(user.role) && <EditJobDialog job={editableJob} />}
                        <ProjectStatusControl projectId={project.id} status={project.status} />
                      </div>
                    </div>

                    <Section icon={Camera} label="Site & Install Photos" tone="solar">
                      <ProjectPhotos projectId={project.id} checklists={photoChecklists} />
                    </Section>

                    <Section icon={Users} label="Crew" tone="solar">
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

                    <Section icon={ClipboardCheck} label="QC Checklist" tone="solar">
                      <QcChecklistEditor projectId={project.id} items={qcItems} />
                    </Section>
                  </div>
                )}
              </Card>
            </section>
            )}


            {/* ── Financials ──
                Solar only. A roofing deal reads its financials inside the
                Claim Info / Field Production / Deal Financials switcher above;
                rendering them here too put the same two cards on the page
                twice. Solar has no switcher, so this stays its only home. */}
            {showFinancials && isSolarDeal && (
            <section id="financials" className="scroll-mt-24 space-y-6">
          {/* Commission payout breakdown — every recipient on this job + total owed */}
          {project && payout && (
            <Card title="Commission Payout" icon={DollarSign} tone={isSolarDeal ? "solar" : "brand"}>
              <ProjectPayoutCard payout={payout} canManage={can(user, "approve", "Commission")} />
            </Card>
          )}

          {/* Deal financials — costs + margin split (commission roles only) */}
          {project && dealFinancials && (
            <Card title="Deal Financials" icon={DollarSign} tone={isSolarDeal ? "solar" : "brand"}>
              <DealFinancialsCard
                financials={dealFinancials}
                projectId={project.id}
                canManage={can(user, "update", "Commission")}
                commissionEligible={commissionEligible}
                gateLabel={COMMISSION_GATE_LABEL}
              />
            </Card>
          )}
            </section>
            )}

            {/* ── Documents & files ── */}
            <section id="documents" className="scroll-mt-24 space-y-6">
          {/* The roofing contract tools, moved out of the page header.
              Build Presentation, Insurance Contract and Simple Cash Bid all
              produce a customer-facing document, so they belong beside the
              documents rather than as three same-weight buttons above a deal
              nobody has read yet. A solar deal closes through its own Proposal
              hub, and "Insurance Contract" is meaningless without an insurer —
              so none of them render there. */}
          {!isSolarDeal && (can(user, "create", "Proposal") || can(user, "update", "Proposal")) && (
            <Card
              title="Create a document"
              icon={FileSignature}
              description="Build a proposal, or send a contract for signature."
            >
              <div className="flex flex-wrap items-center gap-2">
                <BuildPresentationButton leadId={lead.id} />
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
              </div>
            </Card>
          )}

          {/* One place for everything: e-signature documents + all file/photo
              attachments. Survey/Install photo checklists are the header buttons. */}
          <FilesSection
            title={isSolarDeal ? "4 · Contracts & documents" : "Documents & Files"}
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
            {/* Wrapped in a fragment so FilesSection receives ONE child, not an
                array. These children cross a server→client boundary, where
                React can lose the static-children optimisation and start
                treating them as an unkeyed list. Cheap structural immunity. */}
            <>
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

            {/* Dedicated QC Call recording slot. */}
            <DealCallRecordings
              leadId={lead.id}
              recordings={lead.files
                .filter((f) => CALL_GROUP_KEYS.includes(f.category as CallGroup))
                .map((f) => ({ id: f.id, name: f.name, group: f.category as CallGroup }) satisfies CallRecording)}
              canUpload={can(user, "create", "File")}
              canDelete={can(user, "create", "File")}
            />
            </>
          </FilesSection>

          {/* The folder map, moved off the Overview to sit beside the files it
              describes. On the Overview it was a fourth stacked card competing
              with the system and the money; here it answers the question it was
              always meant to answer — "where does this document go?". */}
          {isSolarDeal && (
            <Card
              title="Document folders"
              icon={FolderOpen}
              tone="solar"
              description="What belongs where, and how much is filed"
            >
              <SolarDocumentFolders counts={solarFolderCounts} />
            </Card>
          )}
            </section>
        </div>

        {/* Sidebar — who this is and where the deal stands.
            On a phone the column order is reversed: with everything on one
            page, a sidebar rendered last would put the homeowner's phone
            number thousands of pixels below the fold. Identity first, work
            second.
            On a desktop it scrolls WITH the page. It used to be sticky with its
            own overflow-y-auto, which gave the page two independent scrollers:
            the wheel moved whichever column the cursor happened to be over, so
            the same gesture did two different things depending on the pointer.
            One page, one scroll. */}
        <div className="order-first space-y-6 lg:order-none">
          {/* Homeowner first: the person you are calling stays pinned beside the
              deal instead of scrolling away with it. This replaced roofing's
              "Contact" card in the Overview — same facts, with copy buttons on
              the values you actually use. */}
          {/* Renders its own card chrome: the Edit button sits in the header and
              toggles the fields in the body, which only works if one component
              owns both. */}
          <HomeownerCard
            leadId={lead.id}
            values={{
              firstName: lead.firstName,
              lastName: lead.lastName,
              coOwnerName: lead.coOwnerName,
              phone: lead.phone,
              email: lead.email,
              address: lead.address,
              city: lead.city,
              state: lead.state,
              zip: lead.zip,
              preferredLanguage: lead.preferredLanguage,
              sourceId: lead.sourceId,
              notes: lead.notes,
            }}
            sources={formOptions.sources}
            canEdit={can(user, "update", "Lead")}
            tone={isSolarDeal ? "solar" : "brand"}
          />

          {/* Owns its card chrome so the header's Edit button can drive the
              fields in the body. The three live controls below (deal type,
              install date, appointment actions) already write on click, so they
              pass through as slots and render the same in both modes. */}
          <DealSummaryPanel
            leadId={lead.id}
            isSolar={isSolarDeal}
            tone={isSolarDeal ? "solar" : "brand"}
            canEdit={can(user, "update", "Lead")}
            canAssign={can(user, "assign", "Lead")}
            values={{
              serviceType: lead.serviceType,
              // Company wall clock, NOT UTC — the save path reads it back in the
              // company's zone, so seeding from toISOString() would shift the
              // appointment by the offset on every untouched save.
              appointmentLocal: lead.appointmentAt
                ? utcToZonedWallClock(lead.appointmentAt, companyTz)
                : "",
              priority: lead.priority,
              valueCents: lead.value,
              assignedRepId: lead.assignedRepId,
            }}
            reps={formOptions.reps}
            serviceTypes={serviceTypeOptions(lead.serviceType)}
            display={{
              serviceTypeLabel: serviceTypeLabel(lead.serviceType),
              appointment: lead.appointmentAt ? fmt.dateTime(lead.appointmentAt) : "Not scheduled",
              value: fmt.money(lead.value),
              assignedRep: lead.assignedRep
                ? `${lead.assignedRep.firstName} ${lead.assignedRep.lastName}`
                : null,
              propertyValue: propertyValueLine,
              lastSale: lastSaleLine,
              claimStatus: isInsurance ? lead.claimStatus.replace(/_/g, " ") : null,
              created: fmt.date(lead.createdAt),
            }}
            dealTypeSlot={
              isSolarDeal ? (
                // On Solar a deal's type IS its financing product. There is no
                // insurer, so Insurance-vs-Cash is meaningless here.
                <SolarProductToggle
                  leadId={lead.id}
                  value={solarFinance?.product ?? null}
                  canEdit={can(user, "update", "Lead")}
                />
              ) : (
                <DealTypeToggle leadId={lead.id} value={isInsurance ? "insurance" : "cash"} canEdit={can(user, "update", "Lead")} />
              )
            }
            installDateSlot={
              /* The install date lives HERE, with the other key dates. ALWAYS
                 rendered: gating it on an existing job hid it on 13 of 16 real
                 deals, and an install date is exactly what you agree with a
                 homeowner before the job formally opens. Picking one creates
                 the job. */
              <ProjectSchedule
                bare
                leadId={lead.id}
                projectId={project?.id ?? null}
                installDate={project?.installDate ? project.installDate.toISOString() : null}
                canManage={canManageProd}
              />
            }
            actionsSlot={
            /* Appointment run + open claim — consolidated into the Summary card */
            <DealActionsPanel
              isSolar={isSolarDeal}
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
            }
          />

          {/* Follow-ups on the side, next to the summary */}
          <Card title="Follow-ups & Tasks" icon={ListTodo} tone={isSolarDeal ? "solar" : "brand"}>
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

