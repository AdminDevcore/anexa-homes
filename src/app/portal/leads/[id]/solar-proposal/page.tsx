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
import { parseLayoutBlocks, MODULE_FALLBACK_MM } from "@/lib/solar-layout";
import { listSolarProviders } from "@/server/modules/solar/providers";

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
        logoUpdatedAt: true,
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
      },
    }),
  ]);

  // The panel the design is sized from, for the designer's live kW figure and
  // for true-scale panels. A catalogue entry with no dimensions falls back to a
  // standard 60-cell module rather than drawing nothing.
  const sizingModule = await resolveSizingModule(user.companyId, design?.moduleId ?? null);

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

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <Link
        href={`/portal/leads/${id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to deal
      </Link>
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold">Build Proposal</h1>
        <p className="text-sm text-muted-foreground">
          {`${lead.firstName} ${lead.lastName}`.trim()}
          {address ? ` · ${address}` : ""}
        </p>
      </div>

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
        targetNetPpwCents={settings?.targetNetPpwCents ?? null}
        systemSizeKwDc={design?.systemSizeKwDc ?? 0}
        year1ProductionKwh={design?.year1ProductionKwh ?? 0}
        annualDegradationPct={settings.annualDegradationPct}
        layoutAvailable={layoutAvailable}
        canApproveLayout={can(user, "update", "Settings")}
        lat={lead.lat}
        moduleRatingW={sizingModule?.ratingW ?? null}
        moduleMm={{
          widthMm: sizingModule?.widthMm ?? MODULE_FALLBACK_MM.widthMm,
          heightMm: sizingModule?.heightMm ?? MODULE_FALLBACK_MM.heightMm,
        }}
        initialBlocks={parseLayoutBlocks(design?.layoutBlocks)}
        assumptions={{
          kwhPerKwYear: settings.kwhPerKwYear,
          derateFactor: settings.derateFactor,
        }}
        customer={{
          firstName: lead.firstName,
          lastName: lead.lastName,
          coOwnerName: lead.coOwnerName,
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
        }))}
      />
    </div>
  );
}
