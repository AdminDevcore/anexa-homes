"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { putObject } from "@/server/storage";
import { resolveLayoutAsset } from "./layout-asset";
import { getSolarSettings } from "./settings";
import { readSolarReadiness } from "./readiness";
import { buildProposalSnapshot, type SnapshotEquipment } from "@/lib/solar-proposal";
import { canGenerate } from "@/lib/solar-validation";

const fail = (error: string) => ({ ok: false as const, error });

type EquipRow = { manufacturer: string | null; model: string; ratingW: number | null } | null;

function label(e: EquipRow) {
  if (!e) return null;
  return `${e.manufacturer ? `${e.manufacturer} ` : ""}${e.model}${e.ratingW ? ` · ${e.ratingW}W` : ""}`;
}

function equip(e: EquipRow, qty: number): SnapshotEquipment | null {
  if (!e) return null;
  return { manufacturer: e.manufacturer, model: e.model, ratingW: e.ratingW, qty };
}

/**
 * Generate the next version of a customer-facing proposal.
 *
 * Built entirely from the VALIDATED, server-stored design and finance rows —
 * nothing is taken from client input, so the guard rails cannot be bypassed by
 * posting different numbers. Generation is refused outright while any blocking
 * validation issue stands.
 *
 * Regenerating supersedes the previous version rather than editing it: what a
 * customer was shown, and when, has to survive.
 */
export async function generateSolarProposalAction(leadId: string) {
  const user = await requireUser();
  if (!can(user, "create", "Proposal")) return fail("Not allowed.");

  const [lead, design, finance, assumptions, company] = await Promise.all([
    prisma.lead.findFirst({
      where: { companyId: user.companyId, id: leadId },
      select: {
        id: true, vertical: true, firstName: true, lastName: true,
        address: true, city: true, state: true, zip: true,
        assignedRep: { select: { firstName: true, lastName: true, phone: true, email: true } },
      },
    }),
    prisma.solarDesign.findUnique({
      where: { leadId },
      include: {
        module: { select: { manufacturer: true, model: true, ratingW: true } },
        inverter: { select: { manufacturer: true, model: true, ratingW: true } },
        battery: { select: { manufacturer: true, model: true, ratingW: true } },
      },
    }),
    prisma.solarFinance.findUnique({ where: { leadId } }),
    getSolarSettings(user.companyId),
    prisma.company.findUnique({
      where: { id: user.companyId },
      select: {
        name: true, phone: true, email: true,
        address: true, city: true, state: true, zip: true,
        settings: { select: { logoUrl: true } },
      },
    }),
  ]);

  if (!lead) return fail("Deal not found.");
  if (lead.vertical !== "solar") return fail("This is not a solar deal.");
  if (!design || !finance) return fail("Complete the system design and financing first.");

  // An accepted proposal is the record of what the customer agreed to.
  // Regenerating over it would rewrite that record.
  const accepted = await prisma.solarProposal.findFirst({
    where: { companyId: user.companyId, leadId, signedAt: { not: null } },
    select: { version: true },
  });
  if (accepted) {
    return fail(
      `Proposal v${accepted.version} has already been accepted by the customer and cannot be replaced.`
    );
  }

  // The gate. Identical rules to the builder's readiness check — literally the
  // same function — so a proposal can never be generated around the UI.
  const readiness = await readSolarReadiness(user.companyId, leadId);
  if (!readiness.ok) return fail(readiness.error);
  if (!canGenerate(readiness.issues)) {
    return { ok: false as const, error: "Fix the blocking issues before generating.", issues: readiness.issues };
  }

  const approvedCredit =
    finance.product === "loan"
      ? await prisma.creditApplication.findFirst({
          where: { companyId: user.companyId, leadId, status: { in: ["approved", "conditional"] } },
          orderBy: { decidedAt: "desc" },
          select: { lender: true },
        })
      : null;

  // The partner this deal is on, and the rate-sheet row it was quoted from.
  // Read at generation and FROZEN into the snapshot: rate sheets change every
  // quarter, and a document that looked its own terms up later would silently
  // re-quote a customer who has already been shown a number.
  const dealLender =
    finance.product === "loan" && design.lenderId
      ? await prisma.solarLender.findFirst({
          where: { companyId: user.companyId, id: design.lenderId },
          select: { name: true, applyUrl: true },
        })
      : null;

  const quotedProduct =
    finance.product === "loan" && finance.lenderProductId
      ? await prisma.solarLenderProduct.findFirst({
          where: { companyId: user.companyId, id: finance.lenderProductId },
          select: {
            factorWithPaydownMicros: true, factorWithoutPaydownMicros: true,
            paydownPct: true, paydownMonths: true,
          },
        })
      : null;

  const latest = await prisma.solarProposal.findFirst({
    where: { companyId: user.companyId, leadId },
    orderBy: { version: "desc" },
    select: { id: true, version: true },
  });
  const version = (latest?.version ?? 0) + 1;

  // The layout drawing — included ONLY if the file row AND the bytes behind it
  // are both really there. A FileAsset whose object has since gone (a bucket
  // lifecycle rule, a database restored without its storage) would otherwise be
  // frozen into the snapshot and render as a broken image in front of a
  // customer. Verified now, and verified again at render.
  const layoutAsset = await resolveLayoutAsset(user.companyId, leadId, design.layoutImageFileId);
  const layout = layoutAsset
    ? {
        fileId: layoutAsset.id,
        provider: design.designProvider,
        externalRef: design.designExternalRef,
        // Preliminary unless somebody accountable has marked it final.
        preliminary: !design.layoutApproved,
      }
    : null;

  const companyAddress = company
    ? [company.address, [company.city, company.state].filter(Boolean).join(", "), company.zip]
        .filter(Boolean)
        .join(" · ") || null
    : null;

  const snapshot = buildProposalSnapshot({
    reference: `SP-${leadId.slice(0, 8).toUpperCase()}-V${version}`,
    generatedById: user.userId,
    customer: {
      name: `${lead.firstName} ${lead.lastName}`.trim(),
      address: [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", "),
    },
    company: {
      name: company?.name ?? "",
      phone: company?.phone ?? null,
      email: company?.email ?? null,
      logoUrl: company?.settings?.logoUrl ?? null,
      address: companyAddress,
    },
    representative: lead.assignedRep
      ? {
          name: `${lead.assignedRep.firstName} ${lead.assignedRep.lastName}`.trim(),
          phone: lead.assignedRep.phone ?? null,
          email: lead.assignedRep.email ?? null,
        }
      : null,
    design: {
      systemSizeKwDc: design.systemSizeKwDc,
      year1ProductionKwh: design.year1ProductionKwh,
      offsetPct: design.offsetPct,
      annualUsageKwh: design.annualUsageKwh ?? 0,
      moduleLabel: label(design.module),
      moduleQty: design.moduleQty,
      inverterLabel: label(design.inverter),
      batteryLabel: label(design.battery),
      mountType: design.mountType,
      utilityProvider: design.utilityProvider,
      // Company-level now: the programme is set by the utility, not by the
      // house, so it is one value per company rather than one per deal.
      netMeteringProgram: assumptions.netMeteringProgram,
      avgMonthlyBillCents: design.avgMonthlyBillCents,
      utilityRateMills: design.utilityRateMills,
      module: equip(design.module, design.moduleQty),
      inverter: equip(design.inverter, 1),
      battery: equip(design.battery, design.batteryQty || (design.battery ? 1 : 0)),
    },
    layout,
    finance: {
      product: finance.product,
      grossPpwCents: finance.grossPpwCents,
      dealerFeePct: finance.dealerFeePct,
      adderTotalCents: finance.adderTotalCents,
      rateMillsPerKwh: finance.rateMillsPerKwh,
      monthlyPaymentCents: finance.monthlyPaymentCents,
      escalatorPct: finance.escalatorPct,
      termYears: finance.termYears,
      aprPct: finance.aprPct,
      // These three arrived together with the loan payment row on the customer
      // proposal, which is the condition the previous note here set: the
      // snapshot is what the customer was SHOWN, frozen, so a figure goes in
      // only once the layout renders it. The proposal now shows a monthly for a
      // loan — the lender's approved figure when one exists, otherwise the
      // product's terms amortised — and these are what it is computed from.
      loanMonthlyPaymentCents: finance.loanMonthlyPaymentCents,
      loanTermMonths: finance.loanTermMonths,
      downPaymentCents: finance.downPaymentCents,
    },
    // The lender chosen on the design wins over whatever a credit application
    // recorded: the design is the current answer, the application is history.
    lender: dealLender?.name ?? approvedCredit?.lender ?? null,
    loanFactors: quotedProduct,
    lenderApplyUrl: dealLender?.applyUrl ?? null,
    assumptions,
    now: new Date(),
  });

  const proposal = await prisma.solarProposal.create({
    data: {
      companyId: user.companyId,
      leadId,
      version,
      status: "generated",
      // NO public token. Generating is internal; a token is minted only when the
      // proposal is actually sent. See the note on SolarProposal.publicToken.
      publicToken: null,
      snapshot: snapshot as never,
      createdById: user.userId,
      events: {
        create: {
          type: "generated",
          actorId: user.userId,
          actorName: user.fullName,
          detail: `v${version} · ${finance.product}`,
        },
      },
    },
    select: { id: true, version: true, publicToken: true },
  });

  // Supersede rather than delete: the old version stays readable.
  if (latest) {
    await prisma.solarProposal.update({
      where: { id: latest.id },
      data: {
        supersededAt: new Date(),
        events: { create: { type: "superseded", actorId: user.userId, actorName: user.fullName, detail: `replaced by v${proposal.version}` } },
      },
    });
  }

  await prisma.activityLog.create({
    data: {
      companyId: user.companyId,
      type: "system",
      message: `${user.fullName} generated solar proposal v${version}`,
      leadId,
      actorId: user.userId,
    },
  });

  revalidatePath(`/portal/leads/${leadId}`);
  return { ok: true as const, ...proposal, warnings: readiness.issues };
}

/**
 * Record that the proposal was sent, and mint its public link.
 *
 * THIS is where a proposal acquires a public surface — not generation. The
 * token is created here, once, and never rotated afterwards: a customer may be
 * holding that URL, and re-issuing it would break a live document.
 *
 * Nothing is emailed or texted from here. This records that a send happened and
 * activates the link; wiring an actual delivery channel is a separate piece of
 * work behind its own review.
 */
export async function markProposalSentAction(proposalId: string) {
  const user = await requireUser();
  if (!can(user, "update", "Proposal")) return fail("Not allowed.");
  const p = await prisma.solarProposal.findFirst({
    where: { companyId: user.companyId, id: proposalId },
    select: { id: true, leadId: true, version: true, publicToken: true, supersededAt: true, signedAt: true },
  });
  if (!p) return fail("Proposal not found.");
  if (p.supersededAt) return fail("This version has been superseded. Send the current one.");

  // 24 random bytes from the CSPRNG — the same source the rest of the app uses
  // for share tokens. Kept if one already exists so a re-send does not
  // invalidate a link the customer already has.
  const publicToken = p.publicToken ?? randomBytes(24).toString("base64url");

  await prisma.solarProposal.update({
    where: { id: p.id },
    data: {
      status: "sent",
      sentAt: new Date(),
      publicToken,
      events: {
        create: {
          type: "sent",
          actorId: user.userId,
          actorName: user.fullName,
          detail: p.publicToken ? "re-sent (existing link kept)" : "public link activated",
        },
      },
    },
  });
  await prisma.activityLog.create({
    data: {
      companyId: user.companyId,
      type: "system",
      message: `${user.fullName} marked solar proposal v${p.version} as sent`,
      leadId: p.leadId,
      actorId: user.userId,
    },
  });
  revalidatePath(`/portal/leads/${p.leadId}`);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Panel layout image — the interim workflow
// ---------------------------------------------------------------------------

/**
 * Anexa does not draw roofs yet. Until it does, the panel layout is produced in
 * an external design tool, exported as an image, and attached here.
 *
 * Images only, and only the three formats we can re-encode. A PDF plan set is a
 * different artifact with a different home (`planSetFileId`); accepting one here
 * would put a document the proposal cannot render into the slot the proposal
 * renders. Nothing executable is accepted at all.
 */
const LAYOUT_ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const LAYOUT_MAX_BYTES = 15 * 1024 * 1024;

export async function uploadPanelLayoutAction(formData: FormData) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");

  const leadId = (formData.get("leadId") as string) || "";
  const provider = ((formData.get("designProvider") as string) || "").trim() || null;
  const externalRef = ((formData.get("designExternalRef") as string) || "").trim() || null;
  const file = formData.get("file");

  if (!(file instanceof File)) return fail("No file provided.");
  if (!LAYOUT_ALLOWED.has(file.type)) {
    return fail("The layout must be a JPG, PNG or WebP image.");
  }
  if (file.size > LAYOUT_MAX_BYTES) {
    return fail(`That image is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is 15MB.`);
  }

  // Ownership: the deal must be this company's, and solar.
  const lead = await prisma.lead.findFirst({
    where: { companyId: user.companyId, id: leadId },
    select: { id: true, vertical: true },
  });
  if (!lead) return fail("Deal not found.");
  if (lead.vertical !== "solar") return fail("This is not a solar deal.");

  const design = await prisma.solarDesign.findUnique({
    where: { leadId },
    select: { id: true },
  });
  if (!design) return fail("Save the system design before attaching a layout.");

  // Re-encode rather than trusting the upload: a file claiming image/png that
  // sharp cannot decode is not an image, and this is what proves it.
  let buffer: Buffer;
  try {
    buffer = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
  } catch {
    return fail("That file could not be read as an image.");
  }

  const key = `companies/${user.companyId}/solar-layouts/${nanoid()}.jpg`;
  await putObject(key, buffer);

  const asset = await prisma.fileAsset.create({
    data: {
      companyId: user.companyId,
      kind: "photo",
      name: file.name,
      storageKey: key,
      mimeType: "image/jpeg",
      size: buffer.length,
      category: "solar_layout",
      leadId,
      uploadedById: user.userId,
    },
    select: { id: true },
  });

  await prisma.solarDesign.update({
    where: { leadId },
    data: {
      layoutImageFileId: asset.id,
      layoutImageUploadedById: user.userId,
      layoutImageUploadedAt: new Date(),
      designProvider: provider,
      designExternalRef: externalRef,
      // A REPLACEMENT drawing is not the approved one. Carrying the old
      // approval across would let a new layout inherit "final" status from a
      // decision nobody made about it.
      layoutApproved: false,
      layoutApprovedById: null,
      layoutApprovedAt: null,
    },
  });

  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
  revalidatePath(`/portal/leads/${leadId}`);
  return { ok: true as const, fileId: asset.id };
}

/**
 * Mark the attached layout final, or send it back to preliminary.
 *
 * A drawing stays PRELIMINARY until somebody accountable says otherwise — the
 * proposal carries the "may change at your site survey" caveat until then. The
 * failure mode of getting this backwards is telling a homeowner a layout is
 * final when nobody has checked it, so the default is the cautious one and
 * clearing the caveat is a deliberate act with a name attached to it.
 *
 * Gated on Settings rather than Lead: approving a design is an authority call,
 * not part of ordinary deal editing.
 */
export async function setLayoutApprovalAction(leadId: string, approved: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) {
    return fail("Only a manager or admin can mark a layout final.");
  }

  const lead = await prisma.lead.findFirst({
    where: { companyId: user.companyId, id: leadId },
    select: { id: true, vertical: true },
  });
  if (!lead) return fail("Deal not found.");
  if (lead.vertical !== "solar") return fail("This is not a solar deal.");

  const design = await prisma.solarDesign.findUnique({
    where: { leadId },
    select: { layoutImageFileId: true },
  });
  if (!design?.layoutImageFileId) return fail("There is no layout to approve.");
  if (approved) {
    // Approving a drawing whose bytes have gone would put "Final design" on a
    // proposal with no image in it.
    const asset = await resolveLayoutAsset(user.companyId, leadId, design.layoutImageFileId);
    if (!asset) return fail("The panel-layout image is unavailable. Upload or replace it before sending.");
  }

  await prisma.solarDesign.updateMany({
    where: { leadId, companyId: user.companyId },
    data: {
      layoutApproved: approved,
      layoutApprovedById: approved ? user.userId : null,
      layoutApprovedAt: approved ? new Date() : null,
    },
  });

  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
  return { ok: true as const };
}

/** Detach the layout. The FileAsset stays — removing it from the draft is not a delete. */
export async function removePanelLayoutAction(leadId: string) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");

  const lead = await prisma.lead.findFirst({
    where: { companyId: user.companyId, id: leadId },
    select: { id: true, vertical: true },
  });
  if (!lead) return fail("Deal not found.");
  if (lead.vertical !== "solar") return fail("This is not a solar deal.");

  await prisma.solarDesign.updateMany({
    where: { leadId, companyId: user.companyId },
    data: {
      layoutImageFileId: null,
      layoutImageUploadedById: null,
      layoutImageUploadedAt: null,
    },
  });

  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
  return { ok: true as const };
}
