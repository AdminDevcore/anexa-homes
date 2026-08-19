import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { getSolarSettings } from "@/server/modules/solar/settings";
import { SolarProposalBuilder } from "@/components/portal/solar-proposal-builder";
import { resolveLayoutAsset } from "@/server/modules/solar/layout-asset";

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
      address: true,
      city: true,
      state: true,
      zip: true,
    },
  });
  if (!lead) notFound();

  // The two verticals close through different builders. A roofing deal that
  // reaches this URL — a stale link, a hand-typed path — belongs in its own
  // builder rather than staring at an empty solar design form.
  if (lead.vertical !== "solar") redirect(`/portal/leads/${id}/presentation`);

  // The design is read FIRST because the catalogue query depends on it — see
  // the `OR` below.
  const design = await prisma.solarDesign.findUnique({ where: { leadId: lead.id } });

  const [finance, settings, equipment, lenders, proposals] = await Promise.all([
    prisma.solarFinance.findUnique({ where: { leadId: lead.id } }),
    getSolarSettings(user.companyId),
    prisma.solarEquipment.findMany({
      // Sellable items, PLUS whatever this design already chose even if it has
      // since been retired.
      //
      // Filtering to isActive alone looks right and quietly destroys data: a
      // retired module would drop out of the dropdown, the select would fall
      // back to "— none —", and the next save would write moduleId: null onto a
      // deal that had a perfectly good module. The rep would see the equipment
      // vanish from a deal they never edited. Last year's AVL has to stop being
      // SELLABLE without becoming unrenderable.
      where: {
        companyId: user.companyId,
        OR: [
          { isActive: true },
          { id: { in: [design?.moduleId, design?.inverterId, design?.batteryId].filter((x): x is string => !!x) } },
        ],
      },
      orderBy: [{ kind: "asc" }, { rank: "asc" }, { model: "asc" }],
      select: {
        id: true, kind: true, manufacturer: true, model: true, ratingW: true, isActive: true,
        lenderApprovals: { select: { lenderId: true } },
      },
    }),
    prisma.solarLender.findMany({
      where: {
        companyId: user.companyId,
        OR: [{ isActive: true }, ...(design?.lenderId ? [{ id: design.lenderId }] : [])],
      },
      orderBy: [{ isActive: "desc" }, { rank: "asc" }, { name: "asc" }],
      select: { id: true, name: true, isActive: true },
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

  /**
   * What a rep may pick for one component.
   *
   * When a lender is chosen, the list narrows to that lender's approved-vendor
   * list — STRICTLY, so an item nobody has tagged for this lender does not
   * appear and cannot be quoted into a submission that would bounce.
   *
   * The one exception is whatever this design has ALREADY chosen. Dropping a
   * selected item out of its own dropdown is how a save quietly writes null
   * over a deal's equipment; the same reasoning as a retired item, and the same
   * fix. It is labelled so the mismatch is visible rather than assumed fine.
   */
  const lenderId = design?.lenderId ?? null;
  const chosen = new Set([design?.moduleId, design?.inverterId, design?.batteryId].filter(Boolean));
  const approvedFor = (e: { id: string; lenderApprovals: { lenderId: string }[] }) =>
    !lenderId || e.lenderApprovals.some((a) => a.lenderId === lenderId);

  /** How many items this lender filter is holding back, per kind. */
  const hiddenByLender = (kind: string) =>
    equipment.filter((e) => e.kind === kind && e.isActive && !approvedFor(e) && !chosen.has(e.id)).length;

  const equipOptions = (kind: string) =>
    equipment
      .filter((e) => e.kind === kind)
      .filter((e) => approvedFor(e) || chosen.has(e.id))
      .map((e) => ({
        id: e.id,
        // A retired item that is only here because this design uses it says so,
        // rather than sitting in the list looking like something still sold.
        label:
          `${e.manufacturer ? `${e.manufacturer} ` : ""}${e.model}` +
          `${e.ratingW ? ` · ${e.ratingW}W` : ""}${e.isActive ? "" : " · retired"}` +
          `${approvedFor(e) ? "" : " · not on this lender's list"}`,
        ratingW: e.ratingW,
      }));

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
        initialStep={step === "financing" || step === "generate" ? step : "design"}
        canEditDeal={can(user, "update", "Lead")}
        canCreateProposal={can(user, "create", "Proposal")}
        design={
          design && {
            ...design,
            layoutImageUploadedAt: design.layoutImageUploadedAt?.toISOString() ?? null,
            lenderId: design.lenderId,
          }
        }
        finance={finance}
        itcDisclaimer={settings?.incentiveDisclaimer ?? ""}
        federalItcPct={settings?.federalItcPct ?? null}
        modules={equipOptions("module")}
        inverters={equipOptions("inverter")}
        batteries={equipOptions("battery")}
        lenders={lenders}
        hiddenByLender={{
          module: hiddenByLender("module"),
          inverter: hiddenByLender("inverter"),
          battery: hiddenByLender("battery"),
        }}
        layoutAvailable={layoutAvailable}
        canApproveLayout={can(user, "update", "Settings")}
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
