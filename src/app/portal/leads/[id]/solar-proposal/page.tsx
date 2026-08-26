import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { getSolarSettings } from "@/server/modules/solar/settings";
import { SolarProposalBuilder } from "@/components/portal/solar-proposal-builder";
import { lenderLogoUrl } from "@/lib/lender-mark";
import { resolveLayoutAsset } from "@/server/modules/solar/layout-asset";
import { resolveSizingModule } from "@/server/modules/solar/sizing";
import { parseLayoutBlocks } from "@/lib/solar-layout";
import { listSolarProviders } from "@/server/modules/solar/providers";
import { catalogueBasis, listDealAdders } from "@/server/modules/solar/adders";

export const dynamic = "force-dynamic";

export const metadata = { title: "Build Proposal" };

/**
 * Solar's proposal builder — the counterpart to roofing's `/presentation`.
 *
 * The system design, the financing product and its terms, and generation used
 * to be three cards sitting on the deal page itself. They are proposal INPUTS,
 * not deal chrome: the escalator a customer is quoted belongs with the quote,
 * and having the financing product settable from the Summary as well meant two
 * controls writing one field. They live here now, behind the same emphasized
 * "Build Proposal" button a roofing rep already knows.
 */
export default async function SolarProposalBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { id } = await params;
  const { step } = await searchParams;
  const user = await requireUser();
  if (!can(user, "create", "Proposal") && !can(user, "update", "Proposal")) {
    redirect(`/portal/leads/${id}`);
  }

  const lead = await prisma.lead.findFirst({
    where: { id, companyId: user.companyId },
    select: {
      id: true,
      vertical: true,
      firstName: true,
      lastName: true,
      coOwnerName: true,
      preferredLanguage: true,
      email: true,
      phone: true,
      address: true,
      city: true,
      state: true,
      zip: true,
      // The designer frames the roof on these. Null means no rooftop
      // coordinate yet, and it says so rather than drawing an empty canvas.
      lat: true,
      lng: true,
    },
  });
  if (!lead) notFound();

  // The two verticals close through different builders. A roofing deal that
  // reaches this URL — a stale link, a hand-typed path — belongs in its own
  // builder rather than staring at an empty solar design form.
  if (lead.vertical !== "solar") redirect(`/portal/leads/${id}/presentation`);

  // The design is read FIRST: it carries the lender this system is being built
  // for, which is what the Financing step seeds its picker from.
  const design = await prisma.solarDesign.findUnique({ where: { leadId: lead.id } });

  // Read before the batch: the rate-sheet query needs to know which product
  // this deal already quotes, so a retired one stays selectable rather than
  // silently falling back to "— none —".
  const finance0 = await prisma.solarFinance.findUnique({
    where: { leadId: lead.id },
    select: { lenderProductId: true },
  });

  const [finance, settings, lenders, lenderProducts, proposals] = await Promise.all([
    prisma.solarFinance.findUnique({ where: { leadId: lead.id } }),
    getSolarSettings(user.companyId),
    // Every lender, retired ones included: a deal that already names one has to
    // keep showing it, or the select falls back to "— none —" and the next save
    // strips a lender nobody meant to touch.
    prisma.solarLender.findMany({
      where: { companyId: user.companyId },
      orderBy: [{ isActive: "desc" }, { rank: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, isActive: true, portalUrl: true, creditInstructions: true,
        logoUpdatedAt: true, maxFinalPpwCents: true, minBasePpwCents: true,
        finalPpwMode: true,
      },
    }),
    // EVERY lender's rate sheet, not just the chosen one's: the Financing step
    // switches lender in the browser, and re-fetching a sheet per change would
    // put a spinner between a rep and the terms they are quoting. Sellable rows,
    // PLUS whatever this deal quotes even if it has since been retired.
    prisma.solarLenderProduct.findMany({
      where: {
        companyId: user.companyId,
        OR: [
          { isActive: true },
          ...(finance0?.lenderProductId ? [{ id: finance0.lenderProductId }] : []),
        ],
      },
      orderBy: [{ isActive: "desc" }, { product: "asc" }, { rank: "asc" }, { createdAt: "asc" }],
    }),
    prisma.solarProposal.findMany({
      where: { companyId: user.companyId, leadId: lead.id },
      orderBy: { version: "desc" },
      select: {
        id: true, version: true, status: true, publicToken: true, supersededAt: true,
        sentAt: true, viewedAt: true, signedAt: true, createdAt: true,
        showComparison: true,
      },
    }),
  ]);

  // The panel the design is sized from, for the designer's live kW figure and
  // for true-scale panels. A catalogue entry with no dimensions falls back to a
  // standard 60-cell module rather than drawing nothing.
  const sizingModule = await resolveSizingModule(user.companyId, design?.moduleId ?? null);

  // The adders this company sells, and the ones already on this deal. Sellable
  // rows only for the catalogue — a retired adder should stop being offered —
  // but the LINES are read whole, because a line already on a quote has to keep
  // showing whatever it was priced at.
  const [adderCatalogue, adderLines] = await Promise.all([
    prisma.solarEquipment.findMany({
      where: { companyId: user.companyId, kind: "adder", isActive: true },
      orderBy: [{ rank: "asc" }, { model: "asc" }],
      select: {
        id: true, manufacturer: true, model: true, description: true,
        adderBasis: true, priceCents: true, priceMillsPerWatt: true,
        isVeryCommon: true, consumptionAdjustable: true,
      },
    }),
    listDealAdders(user.companyId, lead.id),
  ]);

  // A provider a design already names stays in its own list even after being
  // retired — otherwise the select falls back to "not set" and the next save
  // blanks a value nobody meant to touch.
  const [utilities, retailers] = await Promise.all([
    listSolarProviders(user.companyId, "utility", design?.utilityProvider),
    listSolarProviders(user.companyId, "retail", design?.electricProvider),
  ]);

  // The layout is only shown as present when the file row AND its bytes both
  // resolve. A dangling reference gets the rep a warning, never a broken image.
  const layoutAvailable = !!(await resolveLayoutAsset(
    user.companyId,
    lead.id,
    design?.layoutImageFileId
  ));

  const address = [lead.address, [lead.city, lead.state].filter(Boolean).join(", "), lead.zip]
    .filter(Boolean)
    .join(" · ");

  const name = `${lead.firstName} ${lead.lastName}`.trim();

  return (
    // FULL WIDTH ON PURPOSE. This screen used to sit in a 1152px column
    // inside the shell's own padding, which on a laptop left two empty bands
    // down the sides while the comparison and the shelf of programmes — the
    // two things that are worth more the wider they get — scrolled sideways
    // inside them. The shell already pads; this adds nothing on top of it.
    <div className="w-full">
      <Link
        href={`/portal/leads/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to deal
      </Link>

      {/* Who this quote is for, once, at the top — the five steps below all
          scroll and the name is the one thing that must not. The address is a
          line of its own rather than trailing the name behind a middot: on a
          long street name the two ran together into one unreadable string. */}
      <header className="mt-3 mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-border pb-5">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-solar">Solar proposal</p>
          <h1 className="font-display text-2xl font-bold">{name || "Build Proposal"}</h1>
          {address && <p className="mt-0.5 text-sm text-muted-foreground">{address}</p>}
        </div>
        {design?.systemSizeKwDc ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-display text-lg font-semibold tabular-nums text-foreground">
              {design.systemSizeKwDc.toFixed(2)} kW
            </span>{" "}
            designed
          </p>
        ) : null}
      </header>

      <SolarProposalBuilder
        leadId={lead.id}
        initialStep={
          step === "energy" || step === "design" || step === "financing" || step === "generate"
            ? step
            : "customer"
        }
        canEditDeal={can(user, "update", "Lead")}
        canCreateProposal={can(user, "create", "Proposal")}
        design={
          design && {
            ...design,
            layoutImageUploadedAt: design.layoutImageUploadedAt?.toISOString() ?? null,
          }
        }
        finance={finance}
        lenders={lenders.map((l) => ({
          id: l.id,
          name: l.name,
          isActive: l.isActive,
          portalUrl: l.portalUrl,
          creditInstructions: l.creditInstructions,
          logoUrl: lenderLogoUrl(l.id, l.logoUpdatedAt),
          maxFinalPpwCents: l.maxFinalPpwCents,
          finalPpwMode: l.finalPpwMode,
          minBasePpwCents: l.minBasePpwCents,
        }))}
        lenderId={design?.lenderId ?? null}
        lenderProducts={lenderProducts.map((p) => ({
          id: p.id,
          lenderId: p.lenderId,
          product: p.product,
          name: p.name,
          aprPct: p.aprPct,
          termMonths: p.termMonths,
          dealerFeePct: p.dealerFeePct,
          leaseRateCentsPerKwMonth: p.leaseRateCentsPerKwMonth,
          rateMillsPerKwh: p.rateMillsPerKwh,
          escalatorPct: p.escalatorPct,
          termYears: p.termYears,
          factorWithPaydownMicros: p.factorWithPaydownMicros,
          factorWithoutPaydownMicros: p.factorWithoutPaydownMicros,
          paydownPct: p.paydownPct,
          paydownMonths: p.paydownMonths,
          isActive: p.isActive,
        }))}
        // What a deal nobody has priced yet opens on. The company's net
        // target when it has set one — that is already "what we keep per watt
        // before the lender's cut", which is exactly what the base price is —
        // and otherwise the plain default sticker, which on a company with no
        // target is the same figure by another name.
        defaultBasePpwCents={settings?.targetNetPpwCents ?? settings?.defaultGrossPpwCents ?? null}
        minPpwCents={settings.minPpwCents}
        maxPpwCents={settings.maxPpwCents}
        adderCatalogue={adderCatalogue.map((a) => ({
          id: a.id,
          label: [a.manufacturer, a.model].filter(Boolean).join(" ") || a.model,
          description: a.description,
          basis: catalogueBasis(a),
          priceCents: a.priceCents,
          priceMillsPerWatt: a.priceMillsPerWatt,
          isVeryCommon: a.isVeryCommon,
          consumptionAdjustable: a.consumptionAdjustable,
        }))}
        adderLines={adderLines}
        systemSizeKwDc={design?.systemSizeKwDc ?? 0}
        year1ProductionKwh={design?.year1ProductionKwh ?? 0}
        annualDegradationPct={settings.annualDegradationPct}
        layoutAvailable={layoutAvailable}
        canApproveLayout={can(user, "update", "Settings")}
        lat={lead.lat}
        moduleRatingW={sizingModule?.ratingW ?? null}
        initialBlocks={parseLayoutBlocks(design?.layoutBlocks)}
        assumptions={{
          kwhPerKwYear: settings.kwhPerKwYear,
          derateFactor: settings.derateFactor,
        }}
        customer={{
          firstName: lead.firstName,
          lastName: lead.lastName,
          coOwnerName: lead.coOwnerName,
          preferredLanguage: lead.preferredLanguage,
          email: lead.email,
          phone: lead.phone,
          address: lead.address,
          city: lead.city,
          state: lead.state,
          zip: lead.zip,
        }}
        energy={
          design && {
            utilityProvider: design.utilityProvider,
            electricProvider: design.electricProvider,
            annualUsageKwh: design.annualUsageKwh,
            avgMonthlyBillCents: design.avgMonthlyBillCents,
            utilityRateMills: design.utilityRateMills,
            usageBasis: design.usageBasis,
          }
        }
        utilities={utilities}
        retailers={retailers}
        hasLayout={!!design?.layoutImageFileId}
        versions={proposals.map((v) => ({
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
    </div>
  );
}
