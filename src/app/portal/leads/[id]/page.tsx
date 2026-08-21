import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ListTodo,
  CalendarClock,
  Camera,
  Users,
  ClipboardCheck,
  DollarSign,
  Satellite,
  Landmark,
  Sun,
  FolderOpen,
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
import {
  getAppointmentDispositions,
  getInspectionOutcomes,
  getClaimStatuses,
} from "@/server/modules/settings/queries";
import { claimStatusLabel, claimStatusOptionsFor } from "@/lib/claim-status";
import { DealStageTimeline } from "@/components/portal/deal-stage-timeline";
import {
  SolarSystemInfo,
  type SystemSpecs,
  type SpecSource,
} from "@/components/portal/solar-system-info";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";
import { blockPanelCount, type LayoutBlock } from "@/lib/solar-layout";
import { lenderLogoUrl } from "@/lib/lender-mark";
import {
  SolarSystemMoneyPanel,
  SolarActivityFeed,
} from "@/components/portal/solar-cockpit";
import { DealProgressBar, DealStageActions } from "@/components/portal/deal-stage-bar";
import { pricePurchase } from "@/lib/solar-money";
import { leadStageTimeline } from "@/server/modules/pipeline/stage-history-queries";
import { PageHeader } from "@/components/portal/ui";
import { NoteForm } from "@/components/portal/note-form";
import { DealFolders } from "@/components/portal/deal-folders";
import { LeadTasks } from "@/components/portal/lead-tasks";
import { ProjectPhotos } from "@/components/portal/project-photos";
import { StartProductionButton } from "@/components/portal/start-production-button";
import { ProjectSchedule } from "@/components/portal/project-schedule";
import { DealActionsPanel } from "@/components/portal/deal-actions-panel";
import { ClaimInfoCard } from "@/components/portal/claim-info-card";
import { DealTypeToggle } from "@/components/portal/deal-type-toggle";
import { SolarProductChip } from "@/components/portal/solar/product-chip";
import { SolarProposalStrip } from "@/components/portal/solar/proposal-strip";
import { readSolarReadiness } from "@/server/modules/solar/readiness";
import { canGenerate } from "@/lib/solar-validation";
import { solarProposalState } from "@/lib/solar-proposal-state";
import { PropertyView } from "@/components/portal/property-view";
import { DealSummaryCards, type SummaryCard } from "@/components/portal/deal-summary-cards";
import { DealSummaryPanel } from "@/components/portal/deal-summary-panel";
import { ClaimStatusSelect } from "@/components/portal/claim-status-select";
import { HomeownerCard } from "@/components/portal/homeowner-card";
import { FinancingTermsPanel } from "@/components/portal/solar/financing-terms";
import { Card, Section } from "@/components/portal/deal-ui";
import { DealSlides, type DealSlideDef } from "@/components/portal/deal-slides";
import { getScopeForLead, listScopeTemplate } from "@/server/modules/scope/queries";
import { getEstimateForLead, getEstimateStarterData } from "@/server/modules/estimates/queries";
import { isScopeReady, stageAtOrAfterScope, canSeeScopeCosts } from "@/server/modules/scope/policies";
import { ScopeOfWorkPanel } from "@/components/portal/scope-of-work-panel";
import { EstimatePanel } from "@/components/portal/estimate-panel";
// CrewAssigner is roofing's, still. Solar names people on the install instead
// (InstallCrew); roofing keeps the crew picker it has today rather than being
// changed by a solar request.
import { QcChecklistEditor, CrewAssigner } from "@/components/portal/project-workflows";
import { InstallCrew } from "@/components/portal/install-crew";
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
          assignees: {
            orderBy: { createdAt: "asc" },
            include: { user: { select: { firstName: true, lastName: true } } },
          },
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
  const assignedInstallerUserIds = new Set([
    ...(project?.crewAssignments ?? [])
      .flatMap((a) => a.crew.members)
      .map((m) => m.userId)
      .filter((uid): uid is string => Boolean(uid)),
    // People named on the install directly. Without this an installer could
    // never be tagged on a follow-up, because the crew route that fed this set
    // has no rows anywhere — no crew has ever been created.
    ...(project?.assignees ?? []).map((a) => a.userId),
  ]);
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
  // Anyone active on the team can be put on an install. Deliberately not
  // filtered to `installer`: the office books a PM onto a tricky job and a
  // manager onto a first install, and a picker that hides them is a picker
  // people work around.
  const installTeam =
    project && canAssignCrew
      ? (
          await prisma.user.findMany({
            where: { companyId: user.companyId, role: { in: STAFF_ROLES }, status: "active" },
            orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
            select: { id: true, firstName: true, lastName: true, role: true },
          })
        ).map((u) => ({
          id: u.id,
          name: `${u.firstName} ${u.lastName}`.trim(),
          role: u.role.replace(/_/g, " "),
        }))
      : [];
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
  // The company's own claim-status vocabulary, widened to keep this deal's
  // current status pickable even if the office has since deleted it.
  const claimStatusOptions = claimStatusOptionsFor(
    lead.claimStatus,
    await getClaimStatuses(user.companyId, lead.vertical)
  );

  // Solar operations: the blocker/follow-up model and the re-roof crossover.
  // Roofing deals never render this — their stages are all internally owned.
  const [solarDesign, solarFinance, solarProposals, creditApps, latestProposal, solarLenders] =
    isSolarDeal
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
        prisma.solarProposal.findMany({
          where: { companyId: user.companyId, leadId: lead.id },
          orderBy: { version: "desc" },
          select: {
            id: true, version: true, status: true, publicToken: true, supersededAt: true,
            sentAt: true, viewedAt: true, signedAt: true, createdAt: true,
            showComparison: true,
          },
        }),
        // A deal can be shopped to several lenders (declined by one, approved by
        // the next), so this is a LIST. The one that matters is picked below.
        prisma.creditApplication.findMany({
          where: { companyId: user.companyId, leadId: lead.id },
          orderBy: { createdAt: "desc" },
        }),
        // The newest proposal WITH its frozen snapshot — what this customer was
        // last quoted. Fetched on its own rather than by widening the list
        // above: a snapshot carries a 25-year savings table, and pulling one per
        // version to read only the newest would be most of a page's payload
        // spent on documents nothing on this screen renders.
        prisma.solarProposal.findFirst({
          where: { companyId: user.companyId, leadId: lead.id },
          orderBy: { version: "desc" },
          select: { version: true, status: true, sentAt: true, createdAt: true, snapshot: true },
        }),
        prisma.solarLender.findMany({
          where: { companyId: user.companyId },
          orderBy: [{ isActive: "desc" }, { rank: "asc" }, { name: "asc" }],
          select: { id: true, name: true, isActive: true, logoUpdatedAt: true },
        }),
      ])
    : [null, null, [], [], null, []];

  /**
   * The interconnection half of the System info slide.
   *
   * Two fields, and deliberately only two. The equipment and the lender used to
   * be dropdowns here as well, narrowed to the chosen lender's approved-vendor
   * list — a second owner for fields the proposal had already frozen. They are
   * reported from the last proposal now and changed in the builder; see
   * `saveSolarBuildDetailsAction`.
   */
  const solarBuild = {
    hasDesign: !!solarDesign,
    utilityAccountNo: solarDesign?.utilityAccountNo ?? null,
    meterNo: solarDesign?.meterNo ?? null,
  };

  /**
   * The system as specifications, for the System info slide.
   *
   * READ OFF THE LAST PROPOSAL when there is one. The slide used to report the
   * live SolarDesign, which is the wrong document to answer "what is on this
   * job": the design keeps moving — a rep reopens the builder, redraws the roof,
   * abandons it half-finished — while the thing the customer holds, and signed,
   * is the frozen snapshot of a particular version. Reporting the design made
   * this card disagree with the homeowner's own copy, and made it possible to
   * read `0 × Silfab` on a deal that had been sold a 24-panel array.
   *
   * Falls back to the design only while no proposal exists at all, which is the
   * one moment the design IS the best account of the job.
   *
   * Two things stay on the design either way. The per-plane table comes from
   * `layoutBlocks`, because a snapshot freezes a PICTURE of the roof and not the
   * angles behind it; the site notes are ops' own working notes and were never
   * part of the quote. Both are labelled in the UI rather than passed off as
   * part of the frozen document.
   */
  const latestSnapshot = (latestProposal?.snapshot ?? null) as SolarProposalSnapshot | null;

  const solarSpecsSource: SpecSource = latestProposal
    ? {
        kind: "proposal",
        label: `Version ${latestProposal.version} · ${latestProposal.status} · ${fmt.date(
          latestProposal.sentAt ?? latestProposal.createdAt
        )}`,
      }
    : {
        kind: "design",
        label: solarDesign ? "no proposal generated yet" : "nothing designed yet",
      };

  const solarSpecs: SystemSpecs | null = (() => {
    if (!isSolarDeal || (!solarDesign && !latestSnapshot)) return null;

    // Empty blocks are dropped: an array with no panels is a leftover of
    // drawing, not a bank anybody is going to install.
    const blocks = (solarDesign?.layoutBlocks as unknown as LayoutBlock[]) ?? [];
    const arrays = blocks
      .map((b) => ({
        id: b.id,
        panels: blockPanelCount(b),
        azimuthDeg: b.azimuthDeg ?? null,
        tiltDeg: b.tiltDeg ?? null,
        shadePct: b.shadePct ?? null,
      }))
      .filter((a) => a.panels > 0);
    const notes = {
      setbackNotes: solarDesign?.setbackNotes ?? null,
      structuralNotes: solarDesign?.structuralNotes ?? null,
      electricalNotes: solarDesign?.electricalNotes ?? null,
    };
    const name = (e: { manufacturer: string | null; model: string } | null | undefined) =>
      e ? `${e.manufacturer ? `${e.manufacturer} ` : ""}${e.model}` : null;

    if (latestSnapshot) {
      const { system, financing } = latestSnapshot;
      // `energy` and the yield basis arrived with schemaVersion 2 and 3. Read
      // as possibly-absent rather than trusted, because the whole promise of a
      // snapshot is that a document generated under an older shape still
      // renders instead of throwing on a key nobody wrote that year.
      const energy = latestSnapshot.energy as SolarProposalSnapshot["energy"] | undefined;
      const assumptions = latestSnapshot.assumptions as
        | SolarProposalSnapshot["assumptions"]
        | undefined;
      return {
        // v1 snapshots have only the labels; v2 and later carry the catalogue
        // rows. Both render, because the whole point of a frozen document is
        // that it keeps working after the shape around it moved on.
        module: name(system.module) ?? system.moduleLabel,
        moduleQty: system.module?.qty ?? system.moduleQty,
        moduleRatingW: system.module?.ratingW ?? null,
        inverter: name(system.inverter) ?? system.inverterLabel,
        battery: name(system.battery) ?? system.batteryLabel,
        batteryQty: system.battery?.qty ?? (system.batteryLabel ? 1 : 0),
        lender: financing.lender,
        lenderLogoUrl: financing.lenderLogoUrl ?? null,
        sizeKwDc: system.sizeKwDc,
        // Never frozen on a proposal — a customer is quoted DC — so the row
        // shows DC alone rather than borrowing today's AC figure.
        sizeKwAc: 0,
        year1Kwh: system.year1ProductionKwh,
        offsetPct: system.offsetPct,
        mountType: system.mountType ?? "roof",
        tsrfPct: system.tsrfPct,
        yieldSource: assumptions?.yieldBasis?.source ?? null,
        yieldStation: assumptions?.yieldBasis?.station ?? null,
        annualUsageKwh: energy?.annualUsageKwh ?? null,
        rateMills: assumptions?.currentRateMillsPerKwh ?? null,
        ratePlan: energy?.ratePlan ?? null,
        netMeteringProgram: system.netMeteringProgram,
        arrays,
        ...notes,
      };
    }

    const design = solarDesign!;
    const designLender = design.lenderId
      ? (solarLenders.find((l) => l.id === design.lenderId) ?? null)
      : null;
    return {
      module: name(design.module),
      moduleQty: design.moduleQty,
      moduleRatingW: design.module?.ratingW ?? null,
      inverter: name(design.inverter),
      battery: name(design.battery),
      batteryQty: design.batteryQty,
      lender: designLender?.name ?? null,
      lenderLogoUrl: designLender
        ? lenderLogoUrl(designLender.id, designLender.logoUpdatedAt)
        : null,
      sizeKwDc: design.systemSizeKwDc,
      sizeKwAc: design.systemSizeKwAc,
      year1Kwh: design.year1ProductionKwh,
      offsetPct: design.offsetPct,
      mountType: design.mountType,
      tsrfPct: design.tsrfPct,
      yieldSource: design.yieldSource,
      yieldStation: design.yieldStation,
      annualUsageKwh: design.annualUsageKwh,
      rateMills: design.utilityRateMills,
      ratePlan: design.ratePlan,
      netMeteringProgram: design.netMeteringProgram,
      arrays,
      ...notes,
    };
  })();

  // Where the proposal stands, as one value. Derived rather than stored — see
  // src/lib/solar-proposal-state.ts for why a column would go stale.
  const solarReadiness = isSolarDeal
    ? await readSolarReadiness(user.companyId, lead.id)
    : null;
  const solarState = isSolarDeal
    ? solarProposalState({
        hasDesign: !!solarDesign,
        hasFinance: !!solarFinance,
        isReady: !!solarReadiness?.ok && canGenerate(solarReadiness.issues),
        latestProposal: solarProposals[0] ?? null,
      })
    : "not_started";
  const stageTimeline = isSolarDeal
    ? await leadStageTimeline({
        id: lead.id,
        createdAt: lead.createdAt,
        pipelineId: lead.pipelineId,
        stageId: lead.stageId,
        stageName: lead.stage?.name ?? null,
        stageChangedAt: lead.stageChangedAt,
      })
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
        // The credit application records the lender as free text, because that
        // is what the webhook sends. Matched back to a partner by name so it can
        // wear that partner's logo; unmatched, the name still gets a monogram.
        lenderLogoUrl: (() => {
          const named = creditApp?.lender?.trim().toLowerCase();
          if (!named) return null;
          const match = solarLenders.find((l) => l.name.trim().toLowerCase() === named);
          return match ? lenderLogoUrl(match.id, match.logoUpdatedAt) : null;
        })(),
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

  // The at-a-glance row under the customer name.
  //
  // Stage is the one card BOTH verticals carry; after that the two businesses
  // are judged on different things, so the lists diverge rather than being
  // forced into one shape.
  //
  // The two verticals also fill it differently, on purpose:
  //  • Roofing builds the row from whatever the deal knows — a card with no
  //    answer is left out.
  //  • Solar is a FIXED four — stage, system size, lender, sales rep — and
  //    every one of them is pushed whether or not it has an answer yet. A
  //    solar deal spends its whole early life with no size and no lender, and
  //    a header that grows a column each time one of them lands reads as
  //    half-built software. Undecided renders as a muted placeholder in its
  //    own slot; see DealSummaryCards.

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
    } else if (isSolarDeal) {
      // Slot one of solar's fixed four. A stageless deal is rare but real
      // (imported, or its pipeline stage was deleted) and it must not be the
      // thing that shifts the other three cards left.
      summaryCards.push({ label: "Current stage", value: null, hint: "Not in a pipeline" });
    }
  }
  if (!isSolarDeal) {
    summaryCards.push({
      label: "Deal type",
      value: isInsurance ? "Insurance" : "Cash",
      hint: isInsurance
        ? `Claim: ${claimStatusLabel(lead.claimStatus, claimStatusOptions)}`
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
    // Slots two, three and four. Every push is unconditional — see the note
    // above the row: the shape of this header does not depend on how far along
    // the deal is.
    const sizeKw = solarDesign?.systemSizeKwDc ?? 0;
    const moduleQty = solarDesign?.moduleQty ?? 0;
    summaryCards.push({
      label: "System size",
      value: sizeKw > 0 ? `${sizeKw.toFixed(2)} kW` : null,
      hint: sizeKw > 0 ? (moduleQty > 0 ? `${moduleQty} panels` : undefined) : "Not designed yet",
    });

    // Which lender is on this deal. A credit application wins when there is
    // one — that is a decision a lender actually made — and the lender chosen
    // on the design is only our intent until one comes back. `creditApp` is
    // already the best of however many applications exist (ranked above).
    const designLender = solarDesign?.lenderId
      ? (solarLenders.find((l) => l.id === solarDesign.lenderId)?.name ?? null)
      : null;
    // `lender` is a required column but the webhook can still write a blank
    // one, and a blank string here would render an empty tile that claims to
    // be filled in. Trim to null so it falls through to the design's choice.
    const creditLender = creditApp?.lender.trim() || null;
    const creditStatus = creditApp?.status.replace(/_/g, " ") ?? null;
    summaryCards.push({
      label: "Lender",
      value: creditLender ?? designLender,
      hint:
        creditLender && creditStatus
          ? creditStatus.charAt(0).toUpperCase() + creditStatus.slice(1)
          : designLender
            ? "No application yet"
            : "Not selected",
    });

    summaryCards.push({
      label: "Sales rep",
      value: lead.assignedRep
        ? `${lead.assignedRep.firstName} ${lead.assignedRep.lastName}`
        : null,
      hint: lead.assignedRep ? undefined : "Unassigned",
    });
    // The project manager is NOT a fifth card. It only exists once a job does,
    // so it would appear mid-deal and push the row from four tiles to five —
    // the same reflow the fixed four is here to stop. It reads next to the job
    // number in the Job panel instead, which is the thing it manages.
  }

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

  // Estimate — what we'd CHARGE for the job. Shares the Scope resource (the
  // roles that may price a job are the roles that may work a scope) but none of
  // its gates: no stage, no deal type. Cost/margin inside the panel is gated
  // separately by canSeeScopeCosts, so a rep quotes without seeing our margin.
  const showEstimate = !isSolarDeal && can(user, "read", "Scope");
  const [estimateData, estimateStarter] = showEstimate
    ? await Promise.all([getEstimateForLead(user, lead.id), getEstimateStarterData(user, lead.id)])
    : [null, null];

  // Notes split by placement: general notes go to the Overview; outcome-tagged
  // notes are immutable logs shown under their outcome in the Summary panel.
  const serializeNote = (n: (typeof lead.noteEntries)[number]) => ({
    id: n.id,
    body: n.body,
    author: n.author ? `${n.author.firstName} ${n.author.lastName}` : "System",
    createdAt: n.createdAt.toISOString(),
  });
  // Outcome-tagged notes are anchored under their outcome in the Summary panel.
  // EVERYTHING else belongs in Notes & Activity — including the customer's own
  // replies from the public proposal (context "proposal": change requests,
  // questions, and which way they chose to pay). Filtering on `!n.context`
  // dropped those on the floor: they were written to the database and shown to
  // nobody, which makes a buying signal worthless.
  const OUTCOME_NOTE_CONTEXTS = new Set(["appointment_outcome", "inspection_outcome"]);
  const generalNotes = lead.noteEntries.filter((n) => !n.context || !OUTCOME_NOTE_CONTEXTS.has(n.context));
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
    // Estimate sits before Scope because that is the order the work happens in:
    // we price the job, then the carrier's scope arrives (if one ever does).
    // Unlike Scope it has no stage gate and no deal-type gate — a cash deal has
    // nothing else that prices it, and an insurance deal needs a number long
    // before the carrier produces theirs.
    ...(showEstimate ? [{ id: "estimate", label: "Estimate" }] : []),
    // Scope sits next to the claim it is costed from, and is omitted entirely
    // rather than shown locked: it is gated on the Scope resource, on the deal
    // reaching Scope Received, and on this being an insurance deal at all.
    ...(showScope ? [{ id: "scope", label: "Scope of Work" }] : []),
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

      {/* No quick-action row here. Every pill it held duplicated a control that
          already lives with the thing it acts on — the design panel edits the
          design, the documents card uploads files, the proposal card is where a
          proposal is generated and viewed, and follow-ups are made in the
          activity feed further down. Homeowner invites are gone outright: this
          product has no customer-facing portal to invite anyone into. */}

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

          {/* The whole deal in one switcher, a slide at a time — the control
              roofing already uses for Claim / Estimate / Scope.

              These were four full-height cards stacked down one column. The
              money card alone runs a stat row, a pricing breakdown, two payment
              schedules and the lender's terms, so the feed began off-screen and
              the install work sat a section and a half below the ops chase that
              asks about it. Four tabs, and any of them is one click from the
              top of the deal.

              Two switchers before this, which only moved the problem: the
              second bar was itself below the fold of the first. One bar or
              none.

              System, pricing, payment schedule AND the lender's terms stay
              together in the first slide: they were two separate surfaces once,
              which is why nobody could answer "what did they get approved for"
              without leaving the page.

              `id="production"` rides on the switcher so a bookmarked
              …/leads/x#production still lands on the job. */}
          {isSolarDeal && (
            <DealSlides
              id="production"
              className="scroll-mt-24"
              slides={[
                { id: "system", label: "System & financing" },
                { id: "ops", label: "Operations", icon: "ops" },
                { id: "install", label: "Installation", icon: "install" },
                { id: "specs", label: "System info", icon: "specs" },
                // Activity is always last, on every deal that has one. The
                // first three are the job; the feed is what people said about
                // it, and a running commentary does not belong between two
                // halves of the work.
                { id: "activity", label: "Activity" },
              ]}
            >
              <div data-deal-slide="system" className="space-y-6">
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

            <div data-deal-slide="ops">
              {stageTimeline && <DealStageTimeline timeline={stageTimeline} />}
            </div>

            <div data-deal-slide="install">
                {/* The install date leads this slide and is rendered whether or
                    not a job exists yet — picking one CREATES the job. Gating it
                    on an existing job is what previously hid it on 13 of 16 real
                    deals, and it is exactly what you agree with a homeowner
                    before the job formally opens. It moved here from the Summary
                    sidebar so it sits with the work it schedules. */}
                <div className="mb-6">
                  <Section icon={CalendarClock} label="Install date" tone="solar">
                    <ProjectSchedule
                      bare
                      leadId={lead.id}
                      projectId={project?.id ?? null}
                      installDate={project?.installDate ? project.installDate.toISOString() : null}
                      canManage={canManageProd}
                    />
                  </Section>
                </div>

                {!project ? (
                  canManageProd ? (
                    <StartProductionButton leadId={lead.id} />
                  ) : (
                    <p className="text-sm text-muted-foreground">This deal isn&rsquo;t in production yet.</p>
                  )
                ) : (
                  <div className="space-y-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {/* The project manager reads here, beside the job it
                          manages, rather than as a fifth summary card. */}
                      <span className="text-sm text-muted-foreground">
                        Job {project.projectNumber}
                        {project.manager &&
                          ` · PM ${project.manager.firstName} ${project.manager.lastName}`}
                      </span>
                      {/* No production-status control. `Project.status` was a
                          second, hand-maintained status that duplicated the
                          pipeline — which already has In Production, QC
                          Inspection, Paid and Cancelled as stages. The deal's
                          stage is the only status now. */}
                      {editableJob && isAdmin(user.role) && <EditJobDialog job={editableJob} />}
                    </div>

                    <Section icon={Camera} label="Site & Install Photos" tone="solar">
                      <ProjectPhotos projectId={project.id} checklists={photoChecklists} />
                    </Section>

                    {/* People, not crews. `Crew`/`CrewMember` exist but nothing
                        in the app creates one, so the old picker hid itself on
                        every job and no install was ever staffed. */}
                    <Section icon={Users} label="Crew" tone="solar">
                      <InstallCrew
                        projectId={project.id}
                        team={installTeam}
                        assignees={project.assignees.map((a) => ({
                          id: a.id,
                          userId: a.userId,
                          name: `${a.user.firstName} ${a.user.lastName}`.trim(),
                          role: a.role,
                        }))}
                        canEdit={canAssignCrew}
                      />
                    </Section>

                    <Section icon={ClipboardCheck} label="QC Checklist" tone="solar">
                      <QcChecklistEditor projectId={project.id} items={qcItems} />
                    </Section>
                  </div>
                )}
            </div>

              <div data-deal-slide="specs">
                <SolarSystemInfo
                  leadId={lead.id}
                  specs={solarSpecs}
                  source={solarSpecsSource}
                  build={solarBuild}
                  canEdit={can(user, "update", "Lead")}
                />
              </div>

              <div data-deal-slide="activity">
                <SolarActivityFeed
                  leadId={lead.id}
                  canPost={can(user, "read", "Lead")}
                  posts={solarFeed.map((f) => ({
                    id: f.id,
                    body: f.body,
                    author: f.author ? `${f.author.firstName} ${f.author.lastName}`.trim() : "System",
                    createdAt: f.createdAt.toISOString(),
                  }))}
                />
              </div>
            </DealSlides>
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
                    {fmt.dateTime(n.createdAt)}
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
                    insurance claim, deductible, or depreciation. Set the price in the proposal (<strong>Build Proposal</strong>).
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
                    No insurance claim opened yet. Set <strong>Claim Status</strong> in the Summary — anything past
                    &ldquo;Not Filed&rdquo; opens the claim and unlocks this worksheet.
                  </p>
                )}
              </div>

              {/* ── Estimate: what we would charge, priced line by line ── */}
              {showEstimate && (
                <div data-deal-slide="estimate">
                  <EstimatePanel
                    leadId={lead.id}
                    estimate={estimateData}
                    catalog={estimateData?.catalog ?? estimateStarter?.catalog ?? []}
                    canEdit={can(user, "update", "Scope")}
                    dealType={isInsurance ? "insurance" : "cash"}
                    hasProject={!!project}
                  />
                </div>
              )}

              {/* ── Scope of work: the claim's line items, costed ── */}
              {showScope && (
                <div data-deal-slide="scope">
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
                </div>
              )}

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
                      {/* No production-status control. `Project.status` was a
                          second, hand-maintained status that duplicated the
                          pipeline — which already has In Production, QC
                          Inspection, Paid and Cancelled as stages. The deal's
                          stage is the only status now. */}
                      {editableJob && isAdmin(user.role) && <EditJobDialog job={editableJob} />}
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

            {/* Scope of Work is NOT a section of its own any more — it is a slide
                beside Claim Info, Field Production and Deal Financials above. It
                is another reading of the same job, and its 150-line catalog table
                was the single longest thing on the page. */}

            {/* ── Proposal (solar) ──
                Design, financing and generation moved into the builder at
                /solar-proposal — they are the proposal's inputs and belong with
                it. What a deal still has to answer is what was quoted and
                whether the customer opened it.

                Only once a proposal EXISTS. Before that this card said nothing
                the Summary's Build Proposal button doesn't already say, and two
                entry points to the same builder on one screen is one too many.
                A generated proposal is a different question — "what did we
                quote, did they open it" — and the version list below is the
                only place on the deal that answers it. */}
            {isSolarDeal && solarProposals.length > 0 && (
              <section id="proposal" className="scroll-mt-24">
                <Card title="Proposal" icon={Sun} tone="solar">
                  <SolarProposalStrip
                    leadId={lead.id}
                    state={solarState}
                    blockingCount={
                      solarReadiness?.ok
                        ? solarReadiness.issues.filter((i) => i.severity === "block").length
                        : 0
                    }
                    product={solarFinance?.product ?? null}
                    systemSizeKwDc={solarDesign?.systemSizeKwDc ?? null}
                    offsetPct={solarDesign?.offsetPct ?? null}
                    contractPriceCents={solarFinance?.contractPriceCents ?? null}
                    monthlyPaymentCents={solarFinance?.monthlyPaymentCents ?? null}
                    rateMillsPerKwh={solarFinance?.rateMillsPerKwh ?? null}
                    canBuild={can(user, "create", "Proposal") || can(user, "update", "Proposal")}
                    canEdit={can(user, "create", "Proposal")}
                    versions={solarProposals.map((v) => ({
                      id: v.id,
                      leadId: lead.id,
                      version: v.version,
                      status: v.status,
                      publicToken: v.publicToken,
                      supersededAt: v.supersededAt?.toISOString() ?? null,
                      sentAt: v.sentAt?.toISOString() ?? null,
                      viewedAt: v.viewedAt?.toISOString() ?? null,
                      signedAt: v.signedAt?.toISOString() ?? null,
                      createdAt: v.createdAt.toISOString(),
          showComparison: v.showComparison,
                    }))}
                  />
                </Card>
              </section>
            )}

            {/* No Commission Payout / Deal Financials on a solar deal.
                Both are roofing's money model wearing a solar tint: a profit
                pool built from contract value minus job cost, adjusted by
                Supplement, Deductible and "company-provided lead?", unlocking
                at the "Depreciation Requested" stage. A solar deal has no
                supplement, no deductible and no depreciation — it is paid by a
                financier against milestones, which is what the System &
                financing slide already shows as Commission milestones and
                Financier payments.

                Roofing keeps both, in its own Deal Financials slide. This
                section only ever rendered on solar (`showFinancials &&
                isSolarDeal`), so removing it cannot touch roofing. */}

            {/* ── Documents & files ── */}
            <section id="documents" className="scroll-mt-24 space-y-6">
          {/* One card, one level: every piece of paper on this job is in a
              folder. E-signature packages live in the Contract folder rather
              than in a list beside the grid — a proposal sent for signature and
              the signed PDF that comes back are the same thing to whoever is
              looking for them, and a second "Documents" heading above a set of
              document folders only ever raised the question of which was which. */}
          <Card
            title={isSolarDeal ? "4 · Contracts & documents" : "Documents & Files"}
            icon={FolderOpen}
            tone={isSolarDeal ? "solar" : "brand"}
            description="Signed paperwork, photos and every file on this job"
          >
            <DealFolders
              leadId={lead.id}
              projectId={project?.id ?? null}
              vertical={lead.vertical}
              checklists={photoChecklists}
              files={lead.files.map((f) => ({
                id: f.id,
                name: f.name,
                kind: f.kind,
                category: f.category,
              }))}
              packages={lead.documentPackages.map((d) => ({
                id: d.id,
                title: d.title,
                status: d.status,
                signedFileId: d.signedFileId,
                folderKey: d.folderKey,
              }))}
              canUpload={can(user, "create", "File")}
              canDelete={can(user, "create", "File")}
            />
          </Card>
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
              created: fmt.date(lead.createdAt),
            }}
            claimStatusSlot={
              // Insurance-only: a cash deal has no carrier, and solar has no
              // claim at all.
              isInsurance ? (
                <ClaimStatusSelect
                  leadId={lead.id}
                  value={lead.claimStatus}
                  options={claimStatusOptions}
                  canEdit={can(user, "update", "Lead")}
                  hasClaim={!!claim}
                />
              ) : null
            }
            dealTypeSlot={
              isSolarDeal ? (
                // On Solar a deal's type IS its financing product. There is no
                // insurer, so Insurance-vs-Cash is meaningless here. Stated
                // only — it is CHOSEN in the proposal builder, beside the term
                // and escalator it belongs with.
                <SolarProductChip value={solarFinance?.product ?? null} />
              ) : (
                <DealTypeToggle leadId={lead.id} value={isInsurance ? "insurance" : "cash"} canEdit={can(user, "update", "Lead")} />
              )
            }
            actionsSlot={
            /* The visit: appointment → inspection. The claim is not here — it
               opens from the Claim Status picker above. */
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
              canEditLead={can(user, "update", "Lead")}
              canCreateProposal={can(user, "create", "Proposal") || can(user, "update", "Proposal")}
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

