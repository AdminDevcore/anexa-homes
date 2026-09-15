import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { leadAccessible } from "@/server/rbac/lead-access";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { resolveLayoutAsset } from "@/server/modules/solar/layout-asset";
import { SolarProposalView } from "@/components/proposal/solar-proposal-view";
import type { RepContext } from "@/components/proposal/rep-bar";
import { lenderProductLabel } from "@/lib/solar-lender-product";
import { adderAmountCents, catalogueBasis } from "@/lib/solar-adders";
import { brandingForRecord } from "@/server/branding/resolve";
import { certificateFor } from "@/server/modules/solar/proposal-signature";
import { readProposalQualifyOffer } from "@/server/modules/solar/proposal-qualify";
import { withCustomerContact, type SolarProposalSnapshot } from "@/lib/solar-proposal";
import { mayStartApplication } from "@/lib/solar-proposal-state";

export const dynamic = "force-dynamic";
export const metadata = { title: "Proposal preview" };

/** Height of the portal shell's own sticky header, which sits above this page. */
const PORTAL_HEADER_PX = 64;

/**
 * The generated proposal, exactly as the customer would see it — read from
 * INSIDE the portal.
 *
 * Deliberately not "open the public link in a new tab":
 *
 *  1. Hitting /proposal/[token] records a customer VIEW and stamps viewedAt.
 *     A rep checking their own work would show up in the audit trail as the
 *     homeowner opening it, which corrupts the one signal that says whether
 *     the customer actually read the thing.
 *  2. It puts the share token in browser history, screenshots and support
 *     tickets. The token IS the authorization; an internal review should not
 *     need to handle it.
 *
 * Acceptance is disabled here regardless — see `previewMode`.
 */
export default async function SolarProposalPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params;
  const { v } = await searchParams;
  const user = await requireUser();
  if (!can(user, "read", "Proposal")) redirect(`/portal/leads/${id}`);

  // The layout above 404s an out-of-scope deal, but a layout is a backstop:
  // Next renders page segments independently. The page proves it for itself.
  if (!(await leadAccessible(user, id))) notFound();

  const proposal = await prisma.solarProposal.findFirst({
    where: {
      companyId: user.companyId,
      leadId: id,
      ...(v ? { version: Number(v) } : {}),
    },
    orderBy: { version: "desc" },
    select: {
      id: true, version: true, snapshot: true, signedAt: true, supersededAt: true,
      // The third column `mayStartApplication` reads — an admin naming the
      // version this deal sold makes the same claim a signature does.
      approvedAt: true,
      createdAt: true, showComparison: true, showPaymentOptions: true,
      leadId: true, companyId: true,
      // `email`/`phone` complete the cover's address block on documents frozen
      // before it existed — see `withCustomerContact`.
      lead: { select: { vertical: true, email: true, phone: true } },
    },
  });
  if (!proposal) notFound();

  const snapshot = withCustomerContact(
    proposal.snapshot as unknown as SolarProposalSnapshot,
    proposal.lead,
  );

  // The snapshot stores the layout's FILE ID, not a URL, so the preview serves
  // it through the authenticated portal route — no share token is involved, and
  // none appears in this page's HTML.
  //
  // Resolved rather than assumed: if the drawing has since been deleted, or its
  // bytes are gone, the section is omitted and the rep is told, instead of a
  // broken image sitting in a document about to go to a customer.
  const layoutAsset = snapshot.layout
    ? await resolveLayoutAsset(user.companyId, id, snapshot.layout.fileId)
    : null;
  const layoutImageUrl = layoutAsset ? `/portal/files/${layoutAsset.id}` : null;
  const layoutMissing = !!snapshot.layout && !layoutAsset;

  // The document is branded by the DEAL, not by the workspace the reviewer
  // happens to be sitting in — so a roofing admin previewing a solar proposal
  // sees the solar brand's accent, exactly as the customer will.
  const branding = await brandingForRecord(user.companyId, "solar");

  /**
   * The rep's controls, assembled here and handed to the document.
   *
   * Gated on `update Proposal` AND on the version being the CURRENT one: a
   * superseded document is a record, and re-pricing from one would generate a
   * new version off terms two revisions old. A viewer without the permission,
   * or somebody reading an old version, gets the read-only preview exactly as
   * before.
   */
  const canAdjust =
    can(user, "update", "Proposal") &&
    can(user, "update", "Lead") &&
    !proposal.supersededAt &&
    !proposal.signedAt &&
    !v;

  const rep = canAdjust ? await repContext(user.companyId, id, proposal) : null;

  /**
   * WHETHER QUALIFY IS LIVE ON THIS PAGE.
   *
   * A deliberately different gate from `canAdjust` above, because the two
   * controls refuse for different reasons. Re-pricing writes a new version, so
   * it stands down on a signed document and on any version but the current
   * one. Submitting writes nothing here — it asks a lender to open a credit
   * file at the price this document already quotes — so a SIGNED document is
   * the most normal thing to submit from, not the least, and reading an old
   * version is fine as long as it is still the price the deal is written at.
   *
   * A REPLACED version is the one that must refuse — but "replaced" is not
   * `supersededAt`, and reading it that way is what made the sentence above
   * false in practice. A signature pins the customer's live link to the version
   * they signed, so generating a v14 marks that signed v13 superseded and this
   * gate went out on precisely the document it says is the most normal thing to
   * submit from. `mayStartApplication` asks the question this comment was
   * already describing, and `qualifyOnProposalAsRep` refuses on the same
   * function, so a live button that always errors stays impossible.
   *
   * Same permission pair as the adjust bar: somebody who may not change what
   * this deal is priced at may not put that price in front of an underwriter.
   */
  const canQualify =
    can(user, "update", "Proposal") && can(user, "update", "Lead") && mayStartApplication(proposal);

  return (
    <div className="min-h-screen bg-[#f6f3ee]">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 pt-6 print:hidden sm:px-6">
        <Link
          href={`/portal/leads/${id}/solar-proposal`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to builder
        </Link>
        <span className="text-xs text-muted-foreground">
          v{proposal.version} · generated {proposal.createdAt.toLocaleDateString()}
        </span>
      </div>

      {/*
        The way back to every number on this page.

        A proposal here is a FROZEN snapshot, not a live document — which is
        what makes "you were quoted this" answerable months later, and also what
        means a figure cannot be corrected in place. So the honest affordance is
        not an edit box on the document: it is the shortest route to the screen
        that owns each number, and a plain sentence saying that changing one
        makes the next version rather than rewriting this one.
      */}
      <div className="mx-auto mt-4 flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-6 text-xs print:hidden sm:px-6">
        <span className="text-muted-foreground">Change a figure:</span>
        {(
          [
            ["usage", `/portal/leads/${id}/solar-proposal?step=energy`],
            ["the array", `/portal/leads/${id}/solar-proposal/design`],
            ["the price", `/portal/leads/${id}/solar-proposal?step=financing`],
          ] as const
        ).map(([label, href]) => (
          <Link key={label} href={href} className="underline underline-offset-2 hover:text-foreground">
            {label}
          </Link>
        ))}
        <span className="text-muted-foreground">
          — this version keeps what it was quoted at; the change goes into the next one.
        </span>
      </div>

      {/* Internal only — the customer's copy simply omits the section. This is
          the rep's cue to fix it BEFORE the proposal goes anywhere. */}
      {layoutMissing && (
        <div className="mx-auto mb-6 max-w-5xl px-4 print:hidden sm:px-6">
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              The panel-layout image is unavailable. Upload or replace it before sending.{" "}
              <Link
                href={`/portal/leads/${id}/solar-proposal?step=design`}
                className="font-medium underline underline-offset-2"
              >
                Open system design →
              </Link>
            </span>
          </div>
        </div>
      )}

      <SolarProposalView
        snapshot={snapshot}
        showComparison={proposal.showComparison}
        showPaymentOptions={proposal.showPaymentOptions}
        rep={rep}
        // No token is handed to the preview: acceptance is disabled, so there is
        // nothing for one to authorize, and it stays out of the page source.
        token=""
        alreadySigned={!!proposal.signedAt}
        // So a rep checking their own work sees the executed document, not the
        // signing form — and printing from here produces the same certificate
        // the customer's copy carries.
        certificate={await certificateFor(proposal.id)}
        superseded={!!proposal.supersededAt}
        previewMode
        layoutImageUrl={layoutImageUrl}
        accentColor={branding.accentColor}
        // THE ONE THING THIS PREVIEW SHOWS THAT THE CUSTOMER'S COPY DOES NOT.
        // The "rep" audience carries the blockers behind a Qualify button that
        // cannot yet start an application — a missing phone number, an
        // unbranded panel. This page is authenticated; the customer's is not,
        // and is handed the ready case or nothing at all.
        qualifyOffer={await readProposalQualifyOffer(
          {
            id: proposal.id,
            leadId: proposal.leadId,
            companyId: proposal.companyId,
            supersededAt: proposal.supersededAt,
            signedAt: proposal.signedAt,
            approvedAt: proposal.approvedAt,
            lead: proposal.lead,
          },
          "rep",
        )}
        // AND THE DOOR IT PRESSES. Without this the button on this page is the
        // dead grey one it was: the customer's copy carries a share token and
        // this page deliberately does not, so the token route has nothing to
        // act with. This is the same submission behind a session instead.
        repQualify={canQualify ? { proposalId: proposal.id } : null}
        // The portal shell's header is already pinned at the top of the
        // viewport. Without this the document's own nav pins to y=0 as well and
        // the two bars paint over each other.
        chromeOffset={PORTAL_HEADER_PX}
      />
    </div>
  );
}

/**
 * Everything the adjust bar needs, read once on the server.
 *
 * Read from the DEAL, not from the snapshot: the bar edits what the next
 * version will be built from, and the snapshot is a record of the last one. A
 * price per watt taken off the frozen document would be the figure that was
 * quoted rather than the figure currently on the row, and the two diverge the
 * moment anybody touches the builder.
 */
async function repContext(
  companyId: string,
  leadId: string,
  proposal: { id: string; version: number; showComparison: boolean; showPaymentOptions: boolean }
): Promise<RepContext | null> {
  const [design, finance] = await Promise.all([
    prisma.solarDesign.findUnique({
      where: { leadId },
      select: {
        lenderId: true, systemSizeKwDc: true,
        avgMonthlyBillCents: true, annualUsageKwh: true,
      },
    }),
    prisma.solarFinance.findUnique({
      where: { leadId },
      select: { product: true, grossPpwCents: true, lenderProductId: true },
    }),
  ]);
  if (!design || !finance) return null;

  const [programmes, adders, onDeal] = await Promise.all([
    prisma.solarLenderProduct.findMany({
      where: {
        companyId,
        isActive: true,
        product: finance.product,
        lender: { isActive: true },
        // Only the lender the SYSTEM is designed for: another partner's
        // programme means another approved-vendor list, and the equipment on
        // this design may not be on it. Changing lender is a builder decision.
        ...(design.lenderId ? { lenderId: design.lenderId } : {}),
      },
      orderBy: [{ rank: "asc" }],
      select: {
        id: true, name: true, product: true, aprPct: true, termMonths: true,
        dealerFeePct: true, leaseRateCentsPerKwMonth: true, rateMillsPerKwh: true,
        escalatorPct: true, termYears: true,
        lender: { select: { name: true } },
      },
    }),
    prisma.solarEquipment.findMany({
      where: { companyId, kind: "adder", isActive: true },
      orderBy: [{ rank: "asc" }, { model: "asc" }],
      select: {
        id: true, manufacturer: true, model: true,
        adderBasis: true, priceCents: true, priceMillsPerWatt: true,
      },
    }),
    prisma.solarDealAdder.findMany({
      where: { companyId, leadId, equipmentId: { not: null } },
      select: { equipmentId: true },
    }),
  ]);

  const watts = Math.round(design.systemSizeKwDc * 1000);

  return {
    proposalId: proposal.id,
    version: proposal.version,
    programmes: programmes.map((p) => ({
      id: p.id,
      label: lenderProductLabel(p),
      lender: p.lender.name,
    })),
    adders: adders.map((a) => ({
      id: a.id,
      label: [a.manufacturer, a.model].filter(Boolean).join(" "),
      // Priced against THIS system, so a per-watt adder reads as the money it
      // would actually add rather than as a rate the rep has to multiply.
      price: `$${(
        adderAmountCents(
          {
            id: a.id,
            label: [a.manufacturer, a.model].filter(Boolean).join(" "),
            // The stored basis, not a guess from which column is filled: a
            // per-foot rate priced as a flat amount reads as the whole job,
            // and a discount reads as a charge.
            basis: catalogueBasis(a),
            flatCents: a.priceCents,
            millsPerWatt: a.priceMillsPerWatt,
            qty: 1,
          },
          watts
        ) / 100
      ).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
    })),
    selectedAdderIds: onDeal.map((l) => l.equipmentId!),
    grossPpwCents: finance.grossPpwCents,
    lenderProductId: finance.lenderProductId,
    avgMonthlyBillCents: design.avgMonthlyBillCents,
    annualUsageKwh: design.annualUsageKwh,
    showComparison: proposal.showComparison,
    showPaymentOptions: proposal.showPaymentOptions,
    designHref: `/portal/leads/${leadId}/solar-proposal/design`,
    isPurchase: finance.product === "cash" || finance.product === "loan",
  };
}
