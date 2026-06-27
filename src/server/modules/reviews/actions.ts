"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";

function fail(error: string) {
  return { ok: false as const, error };
}
function ok() {
  return { ok: true as const };
}

// Revalidate the moderation page and every public surface that renders reviews.
function revalidateReviewSurfaces() {
  revalidatePath("/portal/settings/reviews");
  revalidatePath("/");
  revalidatePath("/reviews");
}

/** Loads a company-scoped review or returns null (prevents cross-tenant edits). */
async function ownedReview(companyId: string, id: string) {
  return prisma.review.findFirst({ where: { id, companyId } });
}

export async function setReviewStatusAction(input: { id: string; status: "approved" | "rejected" | "pending" }) {
  const user = await requireUser();
  if (!can(user, "approve", "Review") && !can(user, "update", "Review")) return fail("Not allowed.");
  const parsed = z.object({ id: z.string().min(1), status: z.enum(["approved", "rejected", "pending"]) }).safeParse(input);
  if (!parsed.success) return fail("Invalid request.");

  const review = await ownedReview(user.companyId, parsed.data.id);
  if (!review) return fail("Review not found.");

  const approving = parsed.data.status === "approved";
  await prisma.review.update({
    where: { id: review.id },
    data: {
      status: parsed.data.status,
      approvedAt: approving ? new Date() : null,
      approvedById: approving ? user.userId : null,
      // Re-show on approval; nothing else touches hidden.
      ...(approving ? { hidden: false } : {}),
    },
  });
  revalidateReviewSurfaces();
  return ok();
}

export async function setReviewFeaturedAction(input: { id: string; featured: boolean }) {
  const user = await requireUser();
  if (!can(user, "update", "Review")) return fail("Not allowed.");
  const parsed = z.object({ id: z.string().min(1), featured: z.boolean() }).safeParse(input);
  if (!parsed.success) return fail("Invalid request.");

  const review = await ownedReview(user.companyId, parsed.data.id);
  if (!review) return fail("Review not found.");
  await prisma.review.update({ where: { id: review.id }, data: { featured: parsed.data.featured } });
  revalidateReviewSurfaces();
  return ok();
}

export async function setReviewHiddenAction(input: { id: string; hidden: boolean }) {
  const user = await requireUser();
  if (!can(user, "update", "Review")) return fail("Not allowed.");
  const parsed = z.object({ id: z.string().min(1), hidden: z.boolean() }).safeParse(input);
  if (!parsed.success) return fail("Invalid request.");

  const review = await ownedReview(user.companyId, parsed.data.id);
  if (!review) return fail("Review not found.");
  await prisma.review.update({ where: { id: review.id }, data: { hidden: parsed.data.hidden } });
  revalidateReviewSurfaces();
  return ok();
}

export async function editReviewAction(input: { id: string; customerName: string; city?: string; serviceType?: string; reviewText: string }) {
  const user = await requireUser();
  if (!can(user, "update", "Review")) return fail("Not allowed.");
  const parsed = z
    .object({
      id: z.string().min(1),
      customerName: z.string().trim().min(2).max(80),
      city: z.string().trim().max(80).optional().or(z.literal("")),
      serviceType: z.string().trim().max(60).optional().or(z.literal("")),
      reviewText: z.string().trim().min(5).max(2000),
    })
    .safeParse(input);
  if (!parsed.success) return fail("Please check the fields and try again.");

  const review = await ownedReview(user.companyId, parsed.data.id);
  if (!review) return fail("Review not found.");
  await prisma.review.update({
    where: { id: review.id },
    data: {
      customerName: parsed.data.customerName,
      city: parsed.data.city || null,
      serviceType: parsed.data.serviceType || null,
      reviewText: parsed.data.reviewText,
    },
  });
  revalidateReviewSurfaces();
  return ok();
}

/** Soft-delete. Only Super Admin (Review:delete) may remove reviews. */
export async function deleteReviewAction(input: { id: string }) {
  const user = await requireUser();
  if (!can(user, "delete", "Review")) return fail("Only a Super Admin can delete reviews.");
  const parsed = z.object({ id: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return fail("Invalid request.");

  const review = await ownedReview(user.companyId, parsed.data.id);
  if (!review) return fail("Review not found.");
  await prisma.review.update({ where: { id: review.id }, data: { deletedAt: new Date() } });
  revalidateReviewSurfaces();
  return ok();
}
