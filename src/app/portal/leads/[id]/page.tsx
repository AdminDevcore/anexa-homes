import { notFound } from "next/navigation";
import type { Role, Vertical } from "@prisma/client";
import { isActiveVertical } from "@/lib/vertical";
import { userVerticals } from "@/server/auth/vertical";
import Link from "next/link";
import {
  ArrowLeft,
  ListTodo,
  Camera,
  Hammer,
  Users,
  ClipboardCheck,
  DollarSign,
  FileSignature,
  Satellite,
  Sun,
  FolderOpen,
} from "lucide-react";
import { requireUser, getSessionUser } from "@/server/auth/session";
import { getLeadDetail, getLeadFormOptions } from "@/server/modules/leads/queries";
import { getDealFinancials, getProjectPayout } from "@/server/modules/costs/queries";
import { isStageCommissionEligible, commissionGateLabel } from "@/server/modules/payroll/eligibility";
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
  SolarOperations,
  type SystemSpecs,
  type SpecSource,
} from "@/components/portal/solar-operations";
import { hasCreditSwitch, type SolarProposalSnapshot } from "@/lib/solar-proposal";
import {
  blockPanelCount,
  panelCorners,
  parseLayoutBlocks,
  MODULE_FALLBACK_MM,
  type LayoutBlock,
} from "@/lib/solar-layout";
import { lenderLogoUrl } from "@/lib/lender-mark";
import { financingCard } from "@/lib/solar-deal-header";
import {
  formatSolarDealValue,
  snapshotPriceSource,
  solarDealValue,
} from "@/lib/solar-deal-value";
import {
  frozenPriceLadder,
  REPORTED_PROPOSAL_ORDER,
  resolveReportedSystem,
  systemDrift,
  type DesignSystem,
  type ReportedPriceLadder,
} from "@/lib/solar-system-of-record";
import {
  SolarSystemMoneyPanel,
  SolarActivityFeed,
} from "@/components/portal/solar-cockpit";
import { DealProgressBar, DealStageActions } from "@/components/portal/deal-stage-bar";
import { priceStoredPurchase, batteryChargeCents } from "@/lib/solar-money";
import { buildCreditLadder, type CreditLadder } from "@/lib/solar-credit-ladder";
import { resolveSignToday } from "@/lib/solar-sign-today";
import { getSolarSettings } from "@/server/modules/solar/settings";
import { leadStageTimeline } from "@/server/modules/pipeline/stage-history-queries";
import { PageHeader } from "@/components/portal/ui";
import { NoteForm } from "@/components/portal/note-form";
import { DealFolders } from "@/components/portal/deal-folders";
import { ALL_DROPBOX_KEYS } from "@/lib/deal-folders";
import { LeadTasks } from "@/components/portal/lead-tasks";
import { ProjectPhotos } from "@/components/portal/project-photos";
import { StartProductionButton } from "@/components/portal/start-production-button";
import { DealActionsPanel } from "@/components/portal/deal-actions-panel";
import { ClaimInfoCard } from "@/components/portal/claim-info-card";
import { DealTypeToggle } from "@/components/portal/deal-type-toggle";
import { SolarProductChip } from "@/components/portal/solar/product-chip";
import { SolarProposalStrip } from "@/components/portal/solar/proposal-strip";
import { readSolarReadiness } from "@/server/modules/solar/readiness";
import { estimatedSolarCommission } from "@/server/modules/payroll/solar-engine";
import { approverNames } from "@/server/modules/solar/proposal-approval";
import {
  readLenderAttempts,
  versionLenderBadge,
  NO_LENDER_ATTEMPTS,
} from "@/server/modules/solar/lender-submission-status";
import { canGenerate } from "@/lib/solar-validation";
import { solarProposalState } from "@/lib/solar-proposal-state";
import { PropertyView } from "@/components/portal/property-view";
import { DealSummaryCards, type SummaryCard } from "@/components/portal/deal-summary-cards";
import { DealSummaryPanel } from "@/components/portal/deal-summary-panel";
import { ClaimStatusSelect } from "@/components/portal/claim-status-select";
import { HomeownerCard } from "@/components/portal/homeowner-card";
import { Card, Section } from "@/components/portal/deal-ui";
import { FinalDocsPanel } from "@/components/portal/final-docs-panel";
import { finalPacketTemplates } from "@/server/modules/esign/final-docs";
import { resolveFinalDocs } from "@/lib/final-docs";
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
import { VisitCard } from "@/components/portal/visit-schedule";
import { currentFormatters } from "@/lib/format-server";
import { serviceTypeLabel, serviceTypeOptions } from "@/lib/service-types";
import { utcToZonedWallClock } from "@/lib/tz";
import { daysInStage } from "@/lib/stage-status";

/** Ground metres to the centimetre. See `propertyArray`. */
const round2 = (n: number) => Math.round(n * 100) / 100;

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

  // Write-only files are counted here and then withheld from the grid
  // entirely — nobody reads a contractor's bill from the job, whatever their
  // role. src/lib/contractor-invoice.ts has the reasoning.
  //
  // Stripped by ALL_DROPBOX_KEYS, not by this deal's own folder set: an
  // invoice submitted from a ROOFING job carries a key roofing's grid does not
  // know, and an unknown key falls into "Other" — which would list the very
  // document this feature exists to withhold. See the note on the constant.
  const dealDropboxCounts: Record<string, number> = {};
  for (const key of ALL_DROPBOX_KEYS) {
    dealDropboxCounts[key] = lead.files.filter((f) => f.category === key).length;
  }

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
            // role + verticals so the deal can say whether this person can even
            // open the workspace the visit lives in.
            include: {
              user: {
                select: { firstName: true, lastName: true, role: true, verticals: true },
              },
            },
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
        inspectionAt: project.inspectionAt?.toISOString() ?? null,
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
  // Fetched with or without a job. Before production there is nothing shot yet
  // and the slots come back empty — but their labels and example photos are
  // what the rep standing at the house needs to see, and the deal's Survey
  // folder now shows them there.
  const photoChecklists = await getProjectPhotoChecklists(user.companyId, project?.id ?? null);
  // The closeout packet, and where this deal's copy of it stands. Solar only —
  // roofing sends no packet, so it asks for nothing and renders nothing.
  const finalDocsTemplates = isSolarDeal ? await finalPacketTemplates(user.companyId) : [];
  // `documentPackages` arrives newest-first, which is the order resolveFinalDocs
  // reads: the answer to "did they sign?" is always about the copy that went
  // out last.
  const finalDocsState = resolveFinalDocs(
    lead.documentPackages.map((d) => ({
      id: d.id,
      templateId: d.templateId,
      status: d.status,
      signedFileId: d.signedFileId,
      sentAt: d.sentAt ? d.sentAt.toISOString() : null,
      completedAt: d.completedAt ? d.completedAt.toISOString() : null,
    })),
    finalDocsTemplates.map((t) => t.id),
  );
  // Anyone active on the team can be put on an install. Deliberately not
  // filtered to `installer`: the office books a PM onto a tricky job and a
  // manager onto a first install, and a picker that hides them is a picker
  // people work around.
  // Everyone staffable, each flagged with whether they can actually OPEN this
  // deal's workspace. Being named on a solar install means nothing to someone
  // granted roofing only: their calendar reads that workspace and the visit
  // never appears on it. The office is not blocked from assigning them —
  // sometimes the grant is the thing that is late — but it is told, at the
  // moment it matters, instead of finding out on the day.
  const staffableUsers =
    project && canAssignCrew
      ? await prisma.user.findMany({
          where: { companyId: user.companyId, role: { in: STAFF_ROLES }, status: "active" },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
          select: { id: true, firstName: true, lastName: true, role: true, verticals: true },
        })
      : [];
  // `others` is a retired enum value with no workspace to grant, so nobody is
  // warned about it — an unanswerable warning is worse than none.
  const lacksDealWorkspace = (u: { role: Role; verticals: Vertical[] }) =>
    isActiveVertical(lead.vertical) && !userVerticals(u).includes(lead.vertical);
  const noWorkspaceAccess = new Set(
    staffableUsers.filter(lacksDealWorkspace).map((u) => u.id)
  );
  const installTeam = staffableUsers.map((u) => ({
    id: u.id,
    name: `${u.firstName} ${u.lastName}`.trim(),
    role: u.role.replace(/_/g, " "),
    noAccess: noWorkspaceAccess.has(u.id),
  }));
  // The crew, split by the visit it is going out on. Two lists rather than one
  // because the install and the inspection are different days and, usually,
  // different people — and the calendar has to be able to tell them apart.
  const crewFor = (kind: "install" | "inspection") =>
    (project?.assignees ?? [])
      .filter((a) => a.kind === kind)
      .map((a) => ({
        id: a.id,
        userId: a.userId,
        name: `${a.user.firstName} ${a.user.lastName}`.trim(),
        role: a.role,
        noAccess: lacksDealWorkspace(a.user),
      }));
  const installCrew = crewFor("install");
  const inspectionCrew = crewFor("inspection");
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
  // Roofing only: a solar deal's visit ends at the appointment, so its panel
  // renders no inspection step and the list would be fetched to be thrown away.
  const inspectionOutcomes = isSolarDeal
    ? []
    : await getInspectionOutcomes(user.companyId, lead.vertical);
  // The company's own claim-status vocabulary, widened to keep this deal's
  // current status pickable even if the office has since deleted it.
  const claimStatusOptions = claimStatusOptionsFor(
    lead.claimStatus,
    await getClaimStatuses(user.companyId, lead.vertical)
  );

  // Solar operations: the blocker / follow-up model.
  // Roofing deals never render this — their stages are all internally owned.
  const [solarDesign, solarFinance, solarProposals, creditApps, reportedProposal, solarLenders] =
    isSolarDeal
    ? await Promise.all([
        prisma.solarDesign.findUnique({
          where: { leadId: lead.id },
          include: {
            // The millimetres are for the property card's array overlay: the
            // panels are drawn at their real size on the roof, and a module
            // with no dimensions falls back to a standard 60-cell one.
            module: {
              select: {
                manufacturer: true, model: true, ratingW: true, widthMm: true, heightMm: true,
              },
            },
            inverter: { select: { manufacturer: true, model: true } },
            // `priceCents` because the storage is money on this contract, not
            // only a name on the System slide — see `batteryChargeCents`.
            battery: { select: { manufacturer: true, model: true, priceCents: true } },
          },
        }),
        prisma.solarFinance.findUnique({ where: { leadId: lead.id } }),
        prisma.solarProposal.findMany({
          where: { companyId: user.companyId, leadId: lead.id },
          orderBy: { version: "desc" },
          select: {
            id: true, version: true, status: true, publicToken: true, supersededAt: true,
            sentAt: true, viewedAt: true, signedAt: true, signerName: true, createdAt: true,
            showComparison: true,
            approvedAt: true, approvedFileId: true, approvedParFileId: true, approvedById: true,
            // Only so a SIGNED version can offer the funder's submission
            // summary. Read from the frozen document rather than from the
            // deal's current lender: changing lenders afterwards must not make
            // the link appear against a version generated for somebody else.
            snapshot: true,
          },
        }),
        // A deal can be shopped to several lenders (declined by one, approved by
        // the next), so this is a LIST. The one that matters is picked below.
        prisma.creditApplication.findMany({
          where: { companyId: user.companyId, leadId: lead.id },
          orderBy: { createdAt: "desc" },
        }),
        /**
         * THE VERSION THIS DEAL IS REPORTED AT, with its frozen snapshot.
         *
         * THE APPROVED ONE, wherever a deal has one. Approval is the moment
         * somebody says "this is the one that sold" — and a customer signing
         * says it by itself — so a v14 a rep generated afterwards while pricing
         * a bigger array must not restate the deal underneath it. At most one
         * version can hold the mark: a partial unique index enforces it.
         *
         * The ordering itself lives in `solar-system-of-record.ts`, because
         * the stamp
         * on `Lead.value` has to ask this exact question too — and `nulls:
         * "last"` is doing the work in it. Postgres sorts NULLs FIRST on a DESC
         * order by default, so without it this asks for the approved version
         * and reliably returns an unapproved one.
         *
         * With nothing approved the newest answers, exactly as it always has.
         *
         * Fetched on its own rather than by widening the list above: a snapshot
         * carries a 25-year savings table, and pulling one per version to read
         * only this one would be most of a page's payload spent on documents
         * nothing on this screen renders.
         */
        prisma.solarProposal.findFirst({
          where: { companyId: user.companyId, leadId: lead.id },
          orderBy: REPORTED_PROPOSAL_ORDER,
          select: {
            version: true, status: true, sentAt: true, createdAt: true, snapshot: true,
            approvedAt: true,
          },
        }),
        prisma.solarLender.findMany({
          where: { companyId: user.companyId },
          orderBy: [{ isActive: "desc" }, { rank: "asc" }, { name: "asc" }],
          // `maxFinalPpwCents` is the partner's ceiling on the customer's price
          // per watt. Read here so this page prices the deal the way the
          // proposal builder does — see priceStoredPurchase.
          select: {
            id: true, name: true, isActive: true, logoUpdatedAt: true,
            maxFinalPpwCents: true, finalPpwMode: true,
            // The partner's own closing-credit rule. Read for the same reason
            // the ceiling above it is: the credit ladder on this page has to
            // be the one the builder and the document draw, and two of the
            // three rules put a figure on it that no column of the deal holds.
            signTodayMode: true, signTodayFixedCents: true, signTodayCapPpwCents: true,
          },
        }),
      ])
    : [null, null, [], [], null, []];

  /**
   * The company's own PROJECT fields, and what this job has in them.
   *
   * Settings has always let a company define these; until now nothing rendered
   * them, so every definition was a field that could be mapped into a document
   * template and never filled. They live on the Operations slide, in their own tab, with the rest
   * of what is true about the job.
   */
  const projectFieldDefs = isSolarDeal
    ? await prisma.customFieldDef.findMany({
        where: { companyId: user.companyId, entity: "project" },
        orderBy: { position: "asc" },
        select: { key: true, label: true, type: true, options: true, required: true },
      })
    : [];
  const projectFieldValues = ((lead.project?.customFields as Record<string, string>) ?? {});

  // Who approved the final proposal, for the badge on the version list. One row
  // at most — the database allows a single approved version per deal.
  const approverName = await approverNames(user.companyId, solarProposals);

  // Whether the finance partner has seen this deal, and at which price — a
  // question the deal page could not answer at all until submissions started
  // recording the document they spoke for. Only asked on a solar deal; the
  // query is skipped entirely on roofing.
  const lenderAttempts = isSolarDeal
    ? await readLenderAttempts(user.companyId, lead.id)
    : NO_LENDER_ATTEMPTS;

  /**
   * The Permitting and Interconnection tabs of the Operations slide.
   *
   * Everything here is recorded AFTER the sale, by whoever is walking the job
   * through the utility and the jurisdiction — which is why none of it is asked
   * for at lead intake, and why it lives on the design rather than on the lead.
   *
   * The equipment and the lender used to be dropdowns here as well, narrowed to
   * the chosen lender's approved-vendor list — a second owner for fields the
   * proposal had already frozen. They are reported from the last proposal now
   * and changed in the builder; see `saveSolarBuildDetailsAction`.
   */
  const solarBuild = {
    hasDesign: !!solarDesign,
    utilityAccountNo: solarDesign?.utilityAccountNo ?? null,
    meterNo: solarDesign?.meterNo ?? null,
    ahjName: solarDesign?.ahjName ?? null,
    ahjContactName: solarDesign?.ahjContactName ?? null,
    ahjContactInfo: solarDesign?.ahjContactInfo ?? null,
    permitNumber: solarDesign?.permitNumber ?? null,
    installerContact: solarDesign?.installerContact ?? null,
    installerTitle: solarDesign?.installerTitle ?? null,
    permitNotRequired: solarDesign?.permitNotRequired ?? false,
    ptoNotRequired: solarDesign?.ptoNotRequired ?? false,
    interconnectionNotRequired: solarDesign?.interconnectionNotRequired ?? false,
    otherUtilityStatus: solarDesign?.otherUtilityStatus ?? false,
    otherUtilityStatusDetail: solarDesign?.otherUtilityStatusDetail ?? null,
  };

  /**
   * The array, for the property card at the top of the deal.
   *
   * The card shows the bare roof until somebody has drawn on it, and the design
   * from then on — which is the order the work happens in, and the reason it is
   * not gated on a proposal existing: the drawing is made in the builder, and
   * from the moment it is saved this card is the fastest way to see it without
   * reopening the builder to look.
   *
   * Read off the LIVE design rather than the last proposal's snapshot, unlike
   * the Operations slide's Design tab. The two answer different questions: that one reports
   * what the customer was quoted and must not move under them, this one is the
   * roof as it stands, so a redraw shows here immediately.
   *
   * Ground metres, projected in the browser — the same geometry, from the same
   * module, that the customer's proposal draws.
   */
  const propertyArray = (() => {
    if (!isSolarDeal || !solarDesign || lead.lat == null || lead.lng == null) return null;
    const moduleMm = {
      widthMm: solarDesign.module?.widthMm ?? MODULE_FALLBACK_MM.widthMm,
      heightMm: solarDesign.module?.heightMm ?? MODULE_FALLBACK_MM.heightMm,
    };
    const panels = parseLayoutBlocks(solarDesign.layoutBlocks)
      .flatMap((b) => panelCorners(b, moduleMm))
      // Centimetres. The imagery is about three centimetres a pixel, so the
      // millimetres would be kilobytes of payload nobody can see.
      .map((quad) => quad.map((c) => ({ e: round2(c.e), n: round2(c.n) })));
    // An empty design is a design that was opened and not drawn. Nothing to show.
    if (panels.length === 0) return null;
    return { lat: lead.lat, panels, sizeKwDc: solarDesign.systemSizeKwDc };
  })();

  /**
   * The system as specifications, for the Operations slide's Design tab.
   *
   * READ OFF THE APPROVED PROPOSAL when there is one, and off the newest
   * otherwise. The slide used to report the live SolarDesign, which is the
   * wrong document to answer "what is on this job": the design keeps moving — a
   * rep reopens the builder, redraws the roof, abandons it half-finished —
   * while the thing the customer holds, and signed, is the frozen snapshot of a
   * particular version. Reporting the design made this card disagree with the
   * homeowner's own copy, and made it possible to read `0 × Silfab` on a deal
   * that had been sold a 24-panel array.
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
  const reportedSnapshot = (reportedProposal?.snapshot ?? null) as SolarProposalSnapshot | null;

  /**
   * WHICH SYSTEM THIS DEAL IS — resolved ONCE, for every card that reports it.
   *
   * This page used to answer that question twice. The Operations slide's Design tab and the
   * Deal Value card read the frozen proposal; the System & financing tiles read
   * the live design. Both rules were defensible on their own and together they
   * put two different systems on one screen: a deal signed at 25 panels / 11.00
   * kW / $60,500 showed 24 panels / 10.56 kW / $58,080 one tab away, with
   * nothing saying the two figures answered different questions. That is not a
   * rounding disagreement — it is the page reporting a system nobody sold.
   *
   * So every REPORTING surface now reads `reportedSystem`, and the rule lives
   * in one tested module rather than in two inline derivations that drifted
   * apart. See src/lib/solar-system-of-record.ts.
   *
   * The builder is deliberately not a caller, and neither is the property map:
   * those show the drawing as it stands, which is the point of them, and both
   * already say so on screen.
   */
  const designLenderRow = solarDesign?.lenderId
    ? (solarLenders.find((l) => l.id === solarDesign.lenderId) ?? null)
    : null;

  /**
   * The company's credit percentages, for the ladder below.
   *
   * Read here rather than passed in because they are STATUTE and they live in
   * Settings, not on the deal: the 30% is the same 30% for every job in the
   * company on the day it is quoted. What varies per deal is which of the three
   * a job actually earns, and that is on the finance row.
   */
  const solarSettings = isSolarDeal ? await getSolarSettings(user.companyId) : null;

  /**
   * What the deal would sign for at TODAY'S design, priced exactly the way the
   * builder prices it. Hoisted out of the money card because two things need
   * it now: that card's price ladder, and the drift report below.
   */
  const workingPrice =
    solarDesign && solarFinance && (solarFinance.product === "cash" || solarFinance.product === "loan")
      ? priceStoredPurchase({
          product: solarFinance.product,
          systemSizeKwDc: solarDesign.systemSizeKwDc,
          stickerPpwCents: solarFinance.grossPpwCents,
          dealerFeePct: solarFinance.dealerFeePct,
          adderTotalCents: solarFinance.adderTotalCents,
          onTopAdderTotalCents: solarFinance.onTopAdderTotalCents,
          // The storage rides on top of the rate, so it is on this ladder too.
          // Left out, this card would quote a deal $40,000 under the proposal
          // the household is holding.
          batteryPriceCents: batteryChargeCents({
            systemType: solarDesign.systemType,
            batteryQty: solarDesign.batteryQty,
            dealPerBatteryCents: solarFinance.stickerPricePerBatteryCents,
            cataloguePerBatteryCents: solarDesign.battery?.priceCents ?? null,
          }),
          maxFinalPpwCents: designLenderRow?.maxFinalPpwCents ?? null,
          finalPpwMode: designLenderRow?.finalPpwMode,
        })
      : null;

  /**
   * THE SECOND PRICE ON THIS DEAL: what is left of that once the household
   * claims the federal credits this job earns.
   *
   * It is not decoration under the contract. Since the credits started driving
   * the payment, the loan is written against what survives this ladder — so a
   * card showing only the contract shows a price that no payment quoted
   * anywhere on the deal, on the shelf or on the customer's own document
   * divides into.
   *
   * SAME CALL, SAME INPUTS as the builder's Credits & incentives card and as
   * generation itself: `buildCreditLadder` over the price this page has just
   * derived, the tick-boxes on the finance row and the percentages in Settings.
   * Anything else here would be a fourth derivation of a figure three surfaces
   * already agree on.
   *
   * Null on a lease, a PPA and on a deal claiming nothing — see the module: a
   * ladder with no rungs is not a ladder of zeroes, it is no ladder.
   */
  /** Which of the three THIS address and THIS equipment earn. One object, so
   *  the closing credit and the ladder it lands on read the same deal. */
  const solarCreditClaims = solarFinance
    ? {
        itc: solarFinance.claimItc,
        energyCommunity: solarFinance.claimEnergyCommunity,
        domesticContent: solarFinance.claimDomesticContent,
      }
    : null;

  const workingLadder: CreditLadder | null =
    workingPrice && solarFinance && solarSettings && solarCreditClaims
      ? buildCreditLadder({
          // The same figure on both sides, exactly as the builder passes it:
          // the deal page prices what the customer signs, so there is no
          // programme adjustment above it for an incentive rung to hand back.
          contractValueCents: workingPrice.breakdown.contractPriceCents,
          quotedPriceCents: workingPrice.breakdown.contractPriceCents,
          rates: solarSettings.creditRates,
          claims: solarCreditClaims,
          incentiveLabel: solarSettings.creditIncentiveLabel,
          signTodayCreditCents: resolveSignToday({
            rule: designLenderRow
              ? {
                  mode: designLenderRow.signTodayMode,
                  fixedCents: designLenderRow.signTodayFixedCents,
                  capPpwCents: designLenderRow.signTodayCapPpwCents,
                }
              : null,
            // THE SAME FOUR INPUTS the builder's card, the shelf and generation
            // pass — the array and the storage at sticker, and the credits this
            // job claims. A partner's cap is measured on what the household is
            // left holding, so a deal page that passed only the array would
            // print a closing credit the builder next door disagrees with.
            systemPriceCents: workingPrice.breakdown.baseStickerCents,
            batteryPriceCents: workingPrice.breakdown.batteryPriceCents,
            systemWatts: workingPrice.breakdown.systemWatts,
            creditRates: solarSettings.creditRates,
            creditClaims: solarCreditClaims,
            typedCents: solarFinance.signTodayCreditCents,
          }).cents,
        })
      : null;

  const equipLabel = (e: { manufacturer: string | null; model: string } | null | undefined) =>
    e ? `${e.manufacturer ? `${e.manufacturer} ` : ""}${e.model}` : null;

  const designSystem: DesignSystem | null = solarDesign
    ? {
        sizeKwDc: solarDesign.systemSizeKwDc,
        moduleQty: solarDesign.moduleQty,
        moduleRatingW: solarDesign.module?.ratingW ?? null,
        year1ProductionKwh: solarDesign.year1ProductionKwh,
        offsetPct: solarDesign.offsetPct,
        annualUsageKwh: solarDesign.annualUsageKwh,
        moduleLabel: equipLabel(solarDesign.module),
        inverterLabel: equipLabel(solarDesign.inverter),
        batteryLabel: equipLabel(solarDesign.battery),
        batteryQty: solarDesign.batteryQty,
        product: solarFinance?.product ?? null,
        contractPriceCents:
          workingPrice?.breakdown.contractPriceCents ?? solarFinance?.contractPriceCents ?? null,
        netAfterCreditsCents: workingLadder?.netCostCents ?? null,
        monthlyPaymentCents: solarFinance?.monthlyPaymentCents ?? null,
        rateMillsPerKwh: solarFinance?.rateMillsPerKwh ?? null,
      }
    : null;

  const reportedSystem = isSolarDeal
    ? resolveReportedSystem({
        proposal:
          reportedProposal && reportedSnapshot
            ? {
                version: reportedProposal.version,
                status: reportedProposal.status,
                at: (reportedProposal.sentAt ?? reportedProposal.createdAt).toISOString(),
                approved: !!reportedProposal.approvedAt,
                snapshot: reportedSnapshot,
              }
            : null,
        design: designSystem,
      })
    : null;

  /**
   * What has moved on the design since that proposal was frozen.
   *
   * Empty on a deal nobody has redrawn, which is most of them. When it is not
   * empty the cards SAY SO rather than quietly picking a side: a signed deal
   * whose drawing has changed is an operational fact somebody needs to act on
   * — either the proposal is reissued or the design is put back — and the one
   * outcome worse than showing two numbers is showing one and hiding the other.
   */
  const systemDriftRows = systemDrift(reportedSystem, designSystem);

  /**
   * How the reported document is NAMED, in one place.
   *
   * "· approved" is on it because the whole page now turns on that word: with a
   * version approved the tiles, the equipment, the price ladder and the deal's
   * value are all that version's, including where a newer one exists. A screen
   * that quietly prefers v13 over v14 and does not say which it took is the
   * defect this label exists to close.
   */
  const solarSpecsSource: SpecSource = reportedProposal
    ? {
        kind: "proposal",
        label: `Version ${reportedProposal.version} · ${reportedProposal.status}${
          reportedProposal.approvedAt ? " · approved" : ""
        } · ${fmt.date(reportedProposal.sentAt ?? reportedProposal.createdAt)}`,
      }
    : {
        kind: "design",
        label: solarDesign ? "no proposal generated yet" : "nothing designed yet",
      };

  const solarSpecs: SystemSpecs | null = (() => {
    if (!isSolarDeal || !reportedSystem) return null;

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
    /**
     * THE SIX FIGURES BOTH SLIDES SAY OUT LOUD, from the one resolver.
     *
     * Written once and spread into either branch below rather than derived
     * here: this slide and the System & financing slide print the same six
     * numbers, and the only way they can be guaranteed to agree is for them to
     * BE the same numbers. Everything after the spread is the half a snapshot
     * or a design carries and the other does not.
     */
    const reported = {
      module: reportedSystem.moduleLabel,
      moduleQty: reportedSystem.moduleQty,
      moduleRatingW: reportedSystem.moduleRatingW,
      inverter: reportedSystem.inverterLabel,
      battery: reportedSystem.batteryLabel,
      batteryQty: reportedSystem.batteryQty,
      sizeKwDc: reportedSystem.sizeKwDc,
      year1Kwh: reportedSystem.year1ProductionKwh,
      offsetPct: reportedSystem.offsetPct,
      annualUsageKwh: reportedSystem.annualUsageKwh,
      arrays,
      ...notes,
    };

    if (reportedSnapshot) {
      const { system, financing } = reportedSnapshot;
      // `energy` and the yield basis arrived with schemaVersion 2 and 3. Read
      // as possibly-absent rather than trusted, because the whole promise of a
      // snapshot is that a document generated under an older shape still
      // renders instead of throwing on a key nobody wrote that year.
      const energy = reportedSnapshot.energy as SolarProposalSnapshot["energy"] | undefined;
      const assumptions = reportedSnapshot.assumptions as
        | SolarProposalSnapshot["assumptions"]
        | undefined;
      return {
        ...reported,
        lender: financing.lender,
        lenderLogoUrl: financing.lenderLogoUrl ?? null,
        // Never frozen on a proposal — a customer is quoted DC — so the row
        // shows DC alone rather than borrowing today's AC figure.
        sizeKwAc: 0,
        mountType: system.mountType ?? "roof",
        tsrfPct: system.tsrfPct,
        yieldSource: assumptions?.yieldBasis?.source ?? null,
        yieldStation: assumptions?.yieldBasis?.station ?? null,
        rateMills: assumptions?.currentRateMillsPerKwh ?? null,
        ratePlan: energy?.ratePlan ?? null,
        netMeteringProgram: system.netMeteringProgram,
      };
    }

    const design = solarDesign!;
    const designLender = design.lenderId
      ? (solarLenders.find((l) => l.id === design.lenderId) ?? null)
      : null;
    return {
      ...reported,
      lender: designLender?.name ?? null,
      lenderLogoUrl: designLender
        ? lenderLogoUrl(designLender.id, designLender.logoUpdatedAt)
        : null,
      sizeKwAc: design.systemSizeKwAc,
      mountType: design.mountType,
      tsrfPct: design.tsrfPct,
      yieldSource: design.yieldSource,
      yieldStation: design.yieldStation,
      rateMills: design.utilityRateMills,
      ratePlan: design.ratePlan,
      netMeteringProgram: design.netMeteringProgram,
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

  // One row: the rep's commission, which pays in full on M1 funding. The table
  // still holds whatever four-slot schedules were written before that changed,
  // and the deal simply stops asking about them.
  const [solarCommission, solarFeed] = isSolarDeal
    ? await Promise.all([
        prisma.solarMilestone.findFirst({
          where: { companyId: user.companyId, leadId: lead.id, payee: "rep", sequence: 1 },
        }),
        prisma.dealFeedPost.findMany({
          where: { companyId: user.companyId, leadId: lead.id },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { author: { select: { firstName: true, lastName: true } } },
        }),
      ])
    : [null, []];

  /**
   * What the pay engine says this deal is worth to its rep, beside the figure
   * somebody typed.
   *
   * WHO MAY SEE IT. `can(read, Commission)` is granted to reps and managers as
   * well as the finance roles, but the row policy behind it narrows a rep to
   * `userId: user.userId` — a rep may see HIS OWN pay, not a colleague's. The
   * boolean cannot express that on its own, so the ownership half is spelled
   * out here: a sales rep gets the estimate only on a deal assigned to him.
   *
   * The estimate is not computed at all when the viewer may not see it, so the
   * figure never crosses the network to a browser that must not have it.
   */
  const mayReadThisRepsPay =
    isSolarDeal &&
    can(user, "read", "Commission") &&
    (user.role !== "sales_rep" || lead.assignedRepId === user.userId);
  const solarCommissionEstimate = mayReadThisRepsPay
    ? await estimatedSolarCommission(prisma, user.companyId, lead.id)
    : null;

  /**
   * THE PAYROLL LINE ITSELF — what this deal actually generated, not what the
   * deal page guesses it is worth.
   *
   * The card had two figures on it and neither was the real one. A typed amount
   * is somebody's note; the engine estimate is a live derivation that keeps
   * moving. The number a rep is actually owed is a `Commission` row, it is
   * approved by a human on the Commissions page, and it settles in a payroll
   * run — and none of that reached this screen, so a deal could read "$4,200
   * estimated" for months after payroll had approved $3,900 and paid it.
   *
   * Matched the way the solar engine writes it: the rep's OWN line on this job
   * (`overrideId: null` — a manager's override is not this rep's pay) and never
   * a voided one, which is a line somebody deliberately killed. Newest first,
   * because a corrected line supersedes the one it replaced.
   *
   * Read under the same permission as the estimate, plus the rep-ownership
   * narrowing spelled out again: `userId` is the recipient of the money, and a
   * sales rep may only ever be shown his own.
   */
  const solarPayrollLine =
    mayReadThisRepsPay && project
      ? await prisma.commission.findFirst({
          where: {
            companyId: user.companyId,
            projectId: project.id,
            overrideId: null,
            status: { not: "void" },
            ...(user.role === "sales_rep" ? { userId: user.userId } : {}),
          },
          orderBy: { createdAt: "desc" },
          select: {
            amount: true,
            status: true,
            approvedAt: true,
            paidAt: true,
            label: true,
            // Which run settled it. `paid: true` rather than the newest item:
            // an unpaid line can sit in a draft run, and naming that run beside
            // a "Paid" chip would say money moved when it has not.
            payrollItems: {
              where: { paid: true },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { payrollRun: { select: { label: true } } },
            },
          },
        })
      : null;

  /**
   * THE PRICE LADDER COMES OFF THE DOCUMENT THIS DEAL IS REPORTED AT.
   *
   * It used to be the one thing on the money card that did not. The tiles above
   * it reported the approved proposal while these rungs re-derived themselves
   * from today's design and today's rate sheet, so a deal whose builder had
   * been reopened showed the customer's contract in the tile and a different
   * contract three rows underneath it — the same two-owners-for-one-truth
   * defect `resolveReportedSystem` exists to stop, on the same card.
   *
   * What the snapshot froze is the CUSTOMER's ladder, not the internal one:
   * `basePriceCents` and `adderTotalCents` are at STICKER, the dealer fee
   * already inside them. That is the right ladder for this screen — the fee
   * itself is deliberately not shown here any more, and at sticker the rungs
   * add up to the contract above them to the cent, which the internal ones
   * never did. What no longer appears on an already-proposed deal is the
   * rep's pre-fee base rate; it was never on the household's document, and rep
   * pay is answered by the Rep commission block beside this one.
   *
   * `workingLadder` below stays exactly as it was, and still answers on a deal
   * that has never produced a document — the one case where today's design IS
   * the deal.
   */
  const solarMoney = (() => {
    if (!isSolarDeal || !reportedSystem) return null;
    const fin = solarFinance;
    // The partner this deal is financed through, and what it will fund. Read
    // off the LENDER, never the programme row — the ceiling belongs to the
    // bank, not to one of its rate-sheet lines. Hoisted above with the working
    // price, which is the only thing that needed it.
    const dealLender = designLenderRow;
    const priced = workingPrice;

    /**
     * THE LADDER, off whichever document this deal is being reported at.
     *
     * A frozen one wherever there is a proposal — that is the whole change:
     * these rungs are READ, not re-derived, so approving version 13 and then
     * generating version 14 leaves this card quoting 13 in every row rather
     * than in some of them.
     *
     * Null on a lease and a PPA, which are sold as a monthly and a rate per
     * kWh and have no per-watt ladder under them at all. The card omits the
     * block rather than printing a run of "$0.00/W" rungs, which is what it
     * used to do on every one of them.
     */
    const ladder: ReportedPriceLadder | null = (() => {
      if (reportedSystem.source.kind === "proposal" && reportedSnapshot) {
        return frozenPriceLadder(reportedSnapshot.financing, reportedSystem.sizeKwDc);
      }
      const b = priced?.breakdown;
      if (!b) return null;
      const watts = b.systemWatts;
      const ppw = (cents: number) => (watts > 0 ? Math.round(cents / watts) : null);
      return {
        source: "design" as const,
        // The PRE-FEE base, which is what the builder's own Base rung shows and
        // what the rep typed. `fin.grossPpwCents` is the sticker and does not
        // belong here — reading it on this rung was showing a rep a base of
        // $3.50 under a "final" of $2.87, which is a ladder pointing down.
        base: { totalCents: b.basePriceCents, ppwCents: Math.round(b.basePpwCents) },
        // BOTH halves: the rung says what the extra work on this job costs, and
        // a roof financed on top of the partner's price is extra work like any
        // other — it is only the pricing rule that differs. `breakdown` sums
        // them for exactly this reason.
        adders: { totalCents: b.adderTotalCents, ppwCents: ppw(b.adderTotalCents) },
        // THE STORAGE, ON ITS OWN RUNG, because gross is base + adders +
        // BATTERY. Left off, a deal with $120,000 of Powerwalls on it shows
        // $1.93/W of base under an $11.33/W final and nothing in between to
        // explain the other $9.40.
        batteryPriceCents: b.batteryPriceCents,
        batteryQty: solarDesign?.batteryQty ?? 0,
        final: { totalCents: b.contractPriceCents, ppwCents: Math.round(b.finalPpwCents) },
        systemWatts: watts,
        credits: workingLadder,
      };
    })();

    return {
      /**
       * WHAT THIS DEAL IS, for the four tiles and the equipment rows.
       *
       * The same object the Operations slide's Design tab reports and the same one the
       * Deal Value card prices off, so the three cannot disagree. It is the
       * approved proposal wherever there is one — see `reportedSystem`.
       */
      reported: {
        // THE SAME TWO STRINGS the Operations slide's Design tab puts in its badge, not a
        // second rendering of the same idea: one place decides how a version is
        // named, so the two slides cannot label the same document differently.
        sourceKind: solarSpecsSource.kind,
        sourceLabel: solarSpecsSource.label,
        sizeKwDc: reportedSystem.sizeKwDc,
        year1ProductionKwh: reportedSystem.year1ProductionKwh,
        offsetPct: reportedSystem.offsetPct,
        moduleLabel: reportedSystem.moduleLabel,
        moduleQty: reportedSystem.moduleQty,
        inverterLabel: reportedSystem.inverterLabel,
        batteryLabel: reportedSystem.batteryLabel,
        batteryQty: reportedSystem.batteryQty,
        /**
         * WHAT THIS SYSTEM COSTS THE HOUSEHOLD — the price after their federal
         * credits wherever the document works one out, and the contract only
         * where it does not.
         *
         * The tile led with the contract and carried the net underneath, which
         * had the emphasis backwards: the credits drive the payment, the
         * customer's own document leads with the net, and the figure a rep
         * reads off the top of a deal has to be the one the household was
         * actually asked for.
         *
         * Priced through the same function as the Deal Value card and the
         * stamped `Lead.value`, so a lease reads "$215/mo" and a PPA
         * "$0.145/kWh" instead of the "$0" that a tile hard-wired to a contract
         * price printed on both — and so the pipeline cannot total a different
         * number than the deal shows.
         */
        priceLabel: formatSolarDealValue(
          solarDealValue({
            product: reportedSystem.product,
            contractPriceCents: reportedSystem.contractPriceCents,
            netAfterCreditsCents: reportedSystem.netAfterCreditsCents,
            monthlyPaymentCents: reportedSystem.monthlyPaymentCents,
            rateMillsPerKwh: reportedSystem.rateMillsPerKwh,
          }),
          fmt.money
        ),
        /**
         * THE CONTRACT, underneath it — what is signed, submitted to the funder
         * and paid commission on.
         *
         * Kept, and kept small: the two are different questions and the deal
         * has to be able to answer either. Null where there is nothing to
         * distinguish — a deal claiming no credits quotes one price, and a tile
         * printing it twice is a tile inventing a distinction.
         */
        contractLabel:
          reportedSystem.netAfterCreditsCents != null &&
          reportedSystem.contractPriceCents != null
            ? fmt.money(reportedSystem.contractPriceCents)
            : null,
      },
      /** Empty unless the drawing has moved since that version was frozen. */
      drift: systemDriftRows,
      product: fin?.product ?? null,
      /**
       * The ladder above, flattened for the browser — one shape whichever
       * document produced it, so the card draws it one way.
       */
      ladder: ladder
        ? {
            source: ladder.source,
            base: ladder.base,
            adders: ladder.adders,
            batteryPriceCents: ladder.batteryPriceCents,
            batteryQty: ladder.batteryQty,
            final: ladder.final,
            systemWatts: ladder.systemWatts,
            credits: ladder.credits
              ? {
                  lines: ladder.credits.credits.map((c) => ({
                    key: c.key,
                    label: c.label,
                    pct: c.pct,
                    amountCents: c.amountCents,
                  })),
                  // Zero on every ordinary deal, and shown only where it is
                  // not: a frozen ladder from the months a partner programme
                  // was modelled carries one, and without the rung those
                  // documents' rows do not subtract to their own bottom line.
                  incentiveCents: ladder.credits.incentiveCents,
                  incentiveLabel: ladder.credits.incentiveLabel,
                  signTodayCents: ladder.credits.signTodayCents,
                  signTodayLabel: ladder.credits.signTodayLabel,
                  netCostCents: ladder.credits.netCostCents,
                  // Null on a storage-only job, which has no installed watts
                  // for a rate to be per — a $/W derived from a battery count
                  // is a figure somebody would eventually quote out loud.
                  netPpwCents:
                    ladder.systemWatts > 0
                      ? Math.round(ladder.credits.netCostCents / ladder.systemWatts)
                      : null,
                }
              : null,
          }
        : null,
      /**
       * The partner's ceiling, and whether it is what is holding this price.
       *
       * Said out loud on a ladder priced from the DESIGN, because that is the
       * one case where the rungs stop being arithmetic a reader can follow: the
       * base is solved BACKWARDS out of the ceiling, so $3.00 typed in the
       * builder comes back as $1.93 here and the line looks like a bug unless
       * the screen names the reason. A frozen ladder needs no such notice — its
       * rungs are at sticker and add up to the contract on their own.
       */
      maxFinalPpwCents: dealLender?.maxFinalPpwCents ?? null,
      finalPpwMode: dealLender?.finalPpwMode ?? "cap",
      cappedByLender: priced?.cap.capped ?? false,
      lenderName: dealLender?.name ?? null,
    };
  })();

  /**
   * DEAL VALUE, on a solar deal.
   *
   * `Lead.value` is a typed-in field and nothing on a solar deal types into it,
   * so the Summary card reported $0 on deals that had been quoted, sent and
   * signed. The figure is derived instead — see src/lib/solar-deal-value.ts for
   * why a lease and a PPA are not a "value" of the same kind.
   *
   * READ OFF THE LAST PROPOSAL, exactly like the Operations slide's Design tab: what this
   * customer was last quoted, frozen, rather than a live design a rep may be
   * halfway through redrawing. The live price is the fallback only while no
   * proposal exists at all — that being the one moment the working figure IS
   * the best account of the deal, and it is labelled as such rather than passed
   * off as something a customer has seen.
   */
  const solarValue = isSolarDeal
    ? (() => {
        // The same reading of the document that gets stamped onto `Lead.value`
        // at generation, so this card and every list that totals the column
        // cannot quote two different numbers for one deal.
        const quoted = reportedSnapshot
          ? solarDealValue(snapshotPriceSource(reportedSnapshot.financing))
          : ({ kind: "none" } as const);
        if (quoted.kind !== "none" && reportedProposal) {
          return {
            value: formatSolarDealValue(quoted, fmt.money),
            // Named, because the figure moved: a card that quietly halved would
            // read as a pricing error to anyone who knew the old number.
            hint: reportedSnapshot?.financing.creditLadder
              ? `After credits · Proposal v${reportedProposal.version}`
              : `Proposal v${reportedProposal.version}`,
          };
        }
        const working = solarDealValue({
          product: solarFinance?.product ?? null,
          // Reached only where no proposal exists at all, so the ladder here is
          // the working one by construction — see `solarMoney.ladder`.
          contractPriceCents: solarMoney?.ladder?.final.totalCents ?? null,
          netAfterCreditsCents: workingLadder?.netCostCents ?? null,
          monthlyPaymentCents: solarFinance?.monthlyPaymentCents ?? null,
          rateMillsPerKwh: solarFinance?.rateMillsPerKwh ?? null,
        });
        return working.kind !== "none"
          ? { value: formatSolarDealValue(working, fmt.money), hint: "Priced — no proposal yet" }
          : { value: "—", hint: "Not priced yet" };
      })()
    : null;

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
  //  • Solar is a FIXED four — stage, system size, financing, sales rep — and
  //    every one of them is pushed whether or not it has an answer yet. A
  //    solar deal spends its whole early life with no size and no financing,
  //    and a header that grows a column each time one of them lands reads as
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

    // HOW THIS DEAL IS PAID FOR — not merely who is lending. `creditApp` is
    // already the best of however many applications exist (ranked above); the
    // four-way logic and the reason this stopped being a "Lender" card live in
    // financingCard.
    summaryCards.push(
      financingCard({
        product: solarFinance?.product ?? null,
        creditLender: creditApp?.lender ?? null,
        creditStatus: creditApp?.status.replace(/_/g, " ") ?? null,
        designLender: solarDesign?.lenderId
          ? (solarLenders.find((l) => l.id === solarDesign.lenderId)?.name ?? null)
          : null,
      })
    );

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
              !isSolarDeal
                ? "Aerial imagery. Trace and measure the roof in Production."
                : propertyArray
                  ? "The array as drawn, on this roof. The same picture the customer's proposal shows."
                  : solarDesign?.layoutImageFileId
                    ? "The layout attached to this design. Imagery of the roof is a click away."
                    : "Aerial imagery. Draw the array in the proposal builder and it appears here."
            }
          >
            <PropertyView
              leadId={lead.id}
              address={[lead.address, [lead.city, lead.state].filter(Boolean).join(", "), lead.zip]
                .filter(Boolean)
                .join(" · ")}
              geoStamp={lead.geocodedAt?.toISOString() ?? null}
              array={propertyArray}
              layoutImageId={solarDesign?.layoutImageFileId ?? null}
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
              foldable
              slides={[
                { id: "system", label: "System & financing" },
                { id: "timeline", label: "Timeline", icon: "timeline" },
                // Design, permitting and interconnection are TABS inside
                // Operations, in the order a job goes through them — and that
                // order ends where Installation begins. This slide was "System
                // info", a name that said none of the three.
                { id: "ops", label: "Operations", icon: "ops" },
                { id: "install", label: "Installation", icon: "install" },
                // Activity is always last, on every deal that has one. The
                // slides before it are the job; the feed is what people said about
                // it, and a running commentary does not belong between two
                // halves of the work.
                { id: "activity", label: "Activity" },
              ]}
            >
              {/* The lender's terms are INSIDE this panel now, as its second
                  column, rather than a section ruled off underneath it. Stacked,
                  the slide ran close to two screens and the credit decision sat
                  below every price derived from it. */}
              <div data-deal-slide="system">
                <SolarSystemMoneyPanel
                  leadId={lead.id}
                  canEdit={can(user, "update", "Lead")}
                  money={solarMoney}
                  financing={financingTerms}
                  commission={
                    solarCommission
                      ? {
                          amountCents: solarCommission.amountCents,
                          trigger: solarCommission.trigger,
                          expectedAt: solarCommission.expectedAt?.toISOString() ?? null,
                          paidAt: solarCommission.paidAt?.toISOString() ?? null,
                        }
                      : null
                  }
                  estimate={solarCommissionEstimate}
                  payroll={
                    solarPayrollLine
                      ? {
                          amountCents: solarPayrollLine.amount,
                          status: solarPayrollLine.status,
                          label: solarPayrollLine.label,
                          approvedAt: solarPayrollLine.approvedAt?.toISOString() ?? null,
                          paidAt: solarPayrollLine.paidAt?.toISOString() ?? null,
                          runLabel:
                            solarPayrollLine.payrollItems[0]?.payrollRun.label ?? null,
                        }
                      : null
                  }
                />
              </div>

            <div data-deal-slide="timeline">
              {stageTimeline && <DealStageTimeline timeline={stageTimeline} />}
            </div>

              <div data-deal-slide="ops">
                <SolarOperations
                  leadId={lead.id}
                  specs={solarSpecs}
                  source={solarSpecsSource}
                  build={solarBuild}
                  canEdit={can(user, "update", "Lead")}
                  projectFields={projectFieldDefs.map((f) => ({
                    key: f.key,
                    label: f.label,
                    type: f.type,
                    options: (f.options as string[]) ?? [],
                    required: f.required,
                  }))}
                  projectValues={projectFieldValues}
                  hasProject={!!lead.project}
                />
              </div>

            <div data-deal-slide="install" className="space-y-5">
                {/* The job's own line, at the top of the slide it belongs to.
                    It used to sit loose between the dates and the photos, which
                    is where a caption goes, not the identifier everyone quotes
                    down the phone. */}
                {project && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                    {/* The project manager reads here, beside the job it
                        manages, rather than as a fifth summary card. */}
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <Hammer className="size-4 shrink-0 text-solar" />
                      <span className="font-medium">Job {project.projectNumber}</span>
                      {project.manager && (
                        <span className="truncate text-muted-foreground">
                          · PM {project.manager.firstName} {project.manager.lastName}
                        </span>
                      )}
                    </span>
                    {/* No production-status control. `Project.status` was a
                        second, hand-maintained status that duplicated the
                        pipeline — which already has In Production, QC
                        Inspection, Paid and Cancelled as stages. The deal's
                        stage is the only status now. */}
                    {editableJob && isAdmin(user.role) && <EditJobDialog job={editableJob} showInspection={isSolarDeal} />}
                  </div>
                )}

                {/* The two scheduled dates lead this slide and are rendered
                    whether or not a job exists yet — picking either CREATES the
                    job. Gating them on an existing job is what previously hid
                    the install date on 13 of 16 real deals, and they are exactly
                    what you agree with a homeowner (and the AHJ) before the job
                    formally opens. Both show on the calendar alongside the
                    appointment.

                    Two cards across, not two stacked sections. The pair is the
                    same three fields twice, and stacked — each date boxed, each
                    crew boxed inside that, each person boxed inside THAT — they
                    ran the best part of a screen before the job itself came
                    into view. The inspection still reads as following the
                    install: it now says so, in the line under its date. */}
                <div className="grid gap-3 lg:grid-cols-2">
                  <VisitCard
                    kind="install"
                    leadId={lead.id}
                    projectId={project?.id ?? null}
                    date={project?.installDate ? project.installDate.toISOString() : null}
                    canManage={canManageProd}
                    team={installTeam}
                    assignees={installCrew}
                    canAssign={canAssignCrew}
                  />
                  <VisitCard
                    kind="inspection"
                    leadId={lead.id}
                    projectId={project?.id ?? null}
                    date={project?.inspectionAt ? project.inspectionAt.toISOString() : null}
                    installDate={project?.installDate ? project.installDate.toISOString() : null}
                    canManage={canManageProd}
                    team={installTeam}
                    assignees={inspectionCrew}
                    canAssign={canAssignCrew}
                  />
                </div>

                {!project ? (
                  canManageProd ? (
                    <StartProductionButton leadId={lead.id} />
                  ) : (
                    <p className="text-sm text-muted-foreground">This deal isn&rsquo;t in production yet.</p>
                  )
                ) : (
                  <>
                    <Section icon={Camera} label="Site & Install Photos" tone="solar">
                      <ProjectPhotos projectId={project.id} checklists={photoChecklists} compact />
                    </Section>

                    <Section icon={ClipboardCheck} label="QC Checklist" tone="solar">
                      <QcChecklistEditor projectId={project.id} items={qcItems} />
                    </Section>

                    {/* The last thing the job does: the paperwork the homeowner
                        signs once the system is in. It sits with the install
                        rather than in the documents grid because the person who
                        sends it is the person who has just finished the
                        install — and the answer he is waiting on is whether it
                        came back signed. */}
                    <Section icon={FileSignature} label="Final documents" tone="solar">
                      <FinalDocsPanel
                        leadId={lead.id}
                        templates={finalDocsTemplates}
                        state={finalDocsState}
                        customerEmail={lead.email}
                        canSend={can(user, "create", "Document")}
                      />
                    </Section>
                  </>
                )}
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
                      {editableJob && isAdmin(user.role) && <EditJobDialog job={editableJob} showInspection={isSolarDeal} />}
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
                      gateLabel={commissionGateLabel(lead.vertical)}
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
                <Card title="Proposal" icon={Sun} tone="solar" foldKey="proposal">
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
                    // TODAY'S DERIVED price, held to the partner's ceiling —
                    // this panel is the builder's own half of the page and
                    // every figure beside it (the size, the offset) is the
                    // working design, so the price beside them has to be too.
                    // The stored column is only as capped as the lender was on
                    // the day it was saved, and a headline sitting a whole cap
                    // away from the design on the same panel is worse than
                    // either figure alone.
                    contractPriceCents={
                      workingPrice?.breakdown.contractPriceCents ??
                      solarFinance?.contractPriceCents ??
                      null
                    }
                    monthlyPaymentCents={solarFinance?.monthlyPaymentCents ?? null}
                    rateMillsPerKwh={solarFinance?.rateMillsPerKwh ?? null}
                    canBuild={can(user, "create", "Proposal") || can(user, "update", "Proposal")}
                    canEdit={can(user, "create", "Proposal")}
                    canApprove={can(user, "update", "Settings")}
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
          signerName: v.signerName,
                      createdAt: v.createdAt.toISOString(),
                      showComparison: v.showComparison,
                      approvedAt: v.approvedAt?.toISOString() ?? null,
                      approvedByName: (v.approvedById && approverName.get(v.approvedById)) || null,
                      approvedFileId: v.approvedFileId,
                      approvedParFileId: v.approvedParFileId,
                      // Whether this document has two readings to file — the
                      // option it opens on carries a credits-applied scenario,
                      // and it is not the battery-only deck, which has no
                      // switch and reads its deal one way. Off the SNAPSHOT:
                      // the row is about a document that already exists.
                      // Mirrors `copiesFor`.
                      hasCreditSwitch: hasCreditSwitch(v.snapshot),
                      lender: versionLenderBadge(lenderAttempts, v.id),
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
                financier, and what the rep makes on it is the one figure the
                System & financing slide already shows as Rep commission.

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
            // Solar only: roofing's Documents & Files card renders as it did.
            foldKey={isSolarDeal ? "documents" : undefined}
          >
            <DealFolders
              leadId={lead.id}
              projectId={project?.id ?? null}
              vertical={lead.vertical}
              checklists={photoChecklists}
              files={lead.files
                // Letter-slot files never cross to the browser — see
                // src/lib/contractor-invoice.ts. Filtering in the component
                // would still have shipped the ids, and an id is a URL.
                .filter((f) => !ALL_DROPBOX_KEYS.has(f.category ?? ""))
                .map((f) => ({
                  id: f.id,
                  name: f.name,
                  kind: f.kind,
                  category: f.category,
                }))}
              dropboxCounts={dealDropboxCounts}
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
              coOwnerEmail: lead.coOwnerEmail,
              coOwnerPhone: lead.coOwnerPhone,
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
              // Solar's value is derived from what the customer was quoted;
              // roofing's is the number somebody typed into this very card.
              value: solarValue ? solarValue.value : fmt.money(lead.value),
              valueHint: solarValue?.hint ?? null,
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

