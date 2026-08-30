"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { putObject } from "@/server/storage";
import { LAYOUT_CATEGORY, pruneSupersededLayouts, resolveLayoutAsset } from "./layout-asset";
import { generateProposalVersion } from "./proposal-generate";
import { approveProposalVersion, unapproveProposalVersion } from "./proposal-approval";
import type { ValidationIssue } from "@/lib/solar-validation";
import { sendEmail, sendSms } from "@/server/modules/notifications/delivery";

const fail = (error: string) => ({ ok: false as const, error });

/**
 * Generate the next version of a customer-facing proposal.
 *
 * The work itself lives in ./proposal-generate, which is NOT a "use server"
 * module — see the note there. This is the endpoint: authenticate, check the
 * permission, hand over.
 */
export async function generateSolarProposalAction(leadId: string): Promise<
  | { ok: false; error: string; issues?: ValidationIssue[] }
  | { ok: true; id: string; version: number; publicToken: string | null; warnings: ValidationIssue[] }
> {
  const user = await requireUser();
  if (!can(user, "create", "Proposal")) return fail("Not allowed.");
  const res = await generateProposalVersion(user, leadId);
  // The snapshot is several hundred kilobytes and the caller here only reloads
  // the page. Ordinary generation does not need it crossing the wire.
  if (!res.ok) return res;
  // The snapshot is several hundred kilobytes and this caller only reloads the
  // page afterwards. Ordinary generation does not need it crossing the wire —
  // the live re-price, which re-renders the document in place, does.
  return {
    ok: true as const,
    id: res.id,
    version: res.version,
    publicToken: res.publicToken,
    warnings: res.warnings,
  };
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

/**
 * Send the proposal to the customer, by email, by text, or both.
 *
 * This replaced a checkbox called "Mark sent". A rep pasted the link into their
 * own mail client, came back and ticked a box, and the deal's `sentAt` recorded
 * the tick rather than the send — so "sent three days ago, still not viewed"
 * could equally mean nobody ever actually sent it.
 *
 * WHAT GOES OUT IS THE LINK, NOT AN ATTACHMENT, and that is a deliberate
 * difference from the tools that mail a PDF. The link is the live document: it
 * records when the homeowner opened it, it cannot be forwarded around in a
 * stale version months later, and the customer can still print it to PDF from
 * the page. A PDF in an inbox is a snapshot of a snapshot with none of that.
 *
 * The token is minted HERE, on the first real send — an unsent proposal has no
 * public surface at all. A re-send keeps the existing link so the copy the
 * customer already has never dies.
 */
export async function sendSolarProposalAction(input: {
  proposalId: string;
  email: boolean;
  sms: boolean;
  /** The rep's own words. Blank falls back to the standard line. */
  note?: string;
}) {
  const user = await requireUser();
  if (!can(user, "update", "Proposal")) return fail("Not allowed.");
  if (!input.email && !input.sms) return fail("Pick email, text, or both.");

  const p = await prisma.solarProposal.findFirst({
    where: { companyId: user.companyId, id: input.proposalId },
    select: {
      id: true, leadId: true, version: true, publicToken: true,
      supersededAt: true, signedAt: true,
      lead: { select: { firstName: true, email: true, phone: true } },
      company: { select: { name: true } },
    },
  });
  if (!p) return fail("Proposal not found.");
  if (p.supersededAt) return fail("This version has been superseded. Send the current one.");

  const to = { email: p.lead.email?.trim() || null, phone: p.lead.phone?.trim() || null };
  if (input.email && !to.email) return fail("This customer has no email address on the deal.");
  if (input.sms && !to.phone) return fail("This customer has no phone number on the deal.");

  const publicToken = p.publicToken ?? randomBytes(24).toString("base64url");
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const link = `${appUrl}/proposal/${publicToken}`;
  if (!appUrl) {
    // Without a base URL the message would carry "/proposal/abc" — a relative
    // path in an email, which is nothing at all. Better to refuse than to send
    // a homeowner a dead link and stamp the deal as sent.
    return fail("NEXT_PUBLIC_APP_URL is not configured, so the link would be unreachable.");
  }

  const note = (input.note ?? "").trim();
  const greeting = p.lead.firstName ? `Hi ${p.lead.firstName},` : "Hi,";
  const body = [
    greeting,
    "",
    note || `Here is your solar proposal from ${p.company.name}.`,
    "",
    link,
    "",
    "You can read it on any device, and print it if you would like a copy.",
  ].join("\n");

  // Delivery is attempted BEFORE anything is stamped. A send that failed must
  // not leave a deal claiming the customer has it.
  const delivered: string[] = [];
  const failed: string[] = [];
  if (input.email && to.email) {
    const ok = await sendEmail(to.email, `Your solar proposal from ${p.company.name}`, body, {
      fromName: p.company.name,
    });
    (ok ? delivered : failed).push("email");
  }
  if (input.sms && to.phone) {
    // One line for a text: a link buried under four paragraphs on a phone gets
    // scrolled past.
    const ok = await sendSms(
      to.phone,
      `${note || `Your solar proposal from ${p.company.name}`}: ${link}`
    );
    (ok ? delivered : failed).push("text");
  }

  // NOTHING is stamped unless something actually went out. A deal that claims
  // the customer has the proposal when the provider refused it is the failure
  // this whole action replaced.
  if (delivered.length === 0) {
    return fail(
      `Nothing was sent — ${failed.join(" and ")} could not be delivered. Check the messaging provider is configured.`
    );
  }

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
          detail: `${delivered.join(" + ")}${p.publicToken ? " · existing link kept" : " · public link activated"}`,
        },
      },
    },
  });
  await prisma.activityLog.create({
    data: {
      companyId: user.companyId,
      type: "system",
      message: `${user.fullName} sent solar proposal v${p.version} by ${delivered.join(" and ")}`,
      leadId: p.leadId,
      actorId: user.userId,
    },
  });

  revalidatePath(`/portal/leads/${p.leadId}`);
  revalidatePath(`/portal/leads/${p.leadId}/solar-proposal`);
  return { ok: true as const, delivered, failed, link };
}

/**
 * Mark one version as the proposal this deal actually sold — or take that back.
 *
 * A deal accumulates versions while a price is worked at the table; ten is
 * ordinary. Which one is NEWEST and which have been SUPERSEDED were the only
 * two things the list could say, and neither is the question anybody asks of
 * it. This answers the question that is actually asked, and files the copy that
 * answer implies into the deal's Proposal folder.
 *
 * A SUPERSEDED VERSION IS APPROVABLE, deliberately. The agreed proposal is
 * frequently not the last one generated — a rep runs three more scenarios after
 * the handshake — and a rule that only the current version may be approved
 * would make the feature unable to record the common case.
 *
 * Gated on `update Settings`, the same permission that marks a panel layout
 * final: approving is an authority call about what the company sold, not part
 * of ordinary deal editing. A rep can still generate, preview and send.
 *
 * The PDF is NOT rendered here. Filing the copy is a separate POST to
 * api/solar/proposals/[id]/file-copy, which the caller makes straight
 * afterwards — see the note on approveProposalVersion for why the browser is
 * kept out of this module's import graph.
 */
export async function setProposalApprovalAction(proposalId: string, approved: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) {
    return fail("Only an admin can approve the final proposal.");
  }

  const p = await prisma.solarProposal.findFirst({
    where: { companyId: user.companyId, id: proposalId },
    select: {
      id: true,
      leadId: true,
      version: true,
      approvedAt: true,
      approvedFileId: true,
      approvedParFileId: true,
    },
  });
  if (!p) return fail("Proposal not found.");

  if (approved) {
    await approveProposalVersion(
      { companyId: user.companyId, userId: user.userId, fullName: user.fullName },
      p,
    );
  } else {
    if (!p.approvedAt) return fail("That version is not approved.");
    await unapproveProposalVersion(
      { companyId: user.companyId, userId: user.userId, fullName: user.fullName },
      p,
    );
  }

  revalidatePath(`/portal/leads/${p.leadId}`);
  revalidatePath(`/portal/leads/${p.leadId}/solar-proposal`);
  return { ok: true as const };
}

/**
 * Show or hide the year-by-year comparison on the customer's copy.
 *
 * Does NOT reissue the proposal, on purpose. The snapshot is what this customer
 * was quoted and every figure in it stays exactly where it was; this changes
 * which section of it is rendered, which is a decision a rep makes at the table
 * once they know whether this household reads the table as proof or as a wall
 * of numbers.
 */
export async function setProposalComparisonAction(proposalId: string, show: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Proposal")) return fail("Not allowed.");
  const p = await prisma.solarProposal.findFirst({
    where: { companyId: user.companyId, id: proposalId },
    select: { id: true, leadId: true },
  });
  if (!p) return fail("Proposal not found.");

  await prisma.solarProposal.update({
    where: { id: p.id },
    data: { showComparison: show },
  });
  revalidatePath(`/portal/leads/${p.leadId}/solar-proposal`);
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
      category: LAYOUT_CATEGORY,
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

  // Only AFTER the design points at the new drawing. Prune first and a failure
  // between the two would leave the deal with no layout at all — the order here
  // is the difference between losing a duplicate and losing the picture.
  await pruneSupersededLayouts(user.companyId, leadId, asset.id);

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
