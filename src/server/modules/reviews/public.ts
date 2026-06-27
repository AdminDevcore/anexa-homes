"use server";

import { z } from "zod";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { prisma } from "@/server/db/client";
import { putObject } from "@/server/storage";

const PRIMARY_COMPANY_SLUG = "anexa-homes";

async function resolvePrimaryCompanyId(): Promise<string | null> {
  const company =
    (await prisma.company.findUnique({ where: { slug: PRIMARY_COMPANY_SLUG }, select: { id: true } })) ??
    (await prisma.company.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }));
  return company?.id ?? null;
}

// Photo arrives as a data URL (data:image/jpeg;base64,...). Cap the raw string
// so a giant upload can't exhaust memory before we re-encode it.
const MAX_PHOTO_CHARS = 8_000_000; // ~6 MB decoded

const submitSchema = z.object({
  customerName: z.string().trim().min(2, "Please enter your name").max(80),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  serviceType: z.string().trim().max(60).optional().or(z.literal("")),
  rating: z.coerce.number().int().min(1, "Please choose a rating").max(5),
  reviewText: z.string().trim().min(10, "Please share a little more").max(2000),
  consentToPublish: z.boolean(),
  // Optional base64 data URL from the file input.
  photoDataUrl: z.string().max(MAX_PHOTO_CHARS).optional().or(z.literal("")),
});

export type SubmitReviewInput = z.infer<typeof submitSchema>;

async function storeReviewPhoto(companyId: string, dataUrl: string): Promise<{ key: string; mime: string } | null> {
  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const raw = Buffer.from(match[2], "base64");
  if (raw.length === 0) return null;
  // Re-encode to a sane, stripped JPEG — normalizes format, drops EXIF, bounds size.
  let processed: Buffer;
  try {
    processed = await sharp(raw)
      .rotate()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    return null; // not a real/decodable image
  }
  const key = `reviews/${companyId}/${nanoid()}.jpg`;
  await putObject(key, processed);
  return { key, mime: "image/jpeg" };
}

export async function submitReview(
  input: SubmitReviewInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  }
  const data = parsed.data;
  if (!data.consentToPublish) {
    return { ok: false, error: "Please confirm we can publish your review." };
  }

  const companyId = await resolvePrimaryCompanyId();
  if (!companyId) {
    return { ok: false, error: "We couldn't submit your review right now. Please try again later." };
  }

  let photoKey: string | null = null;
  let photoMime: string | null = null;
  if (data.photoDataUrl) {
    const stored = await storeReviewPhoto(companyId, data.photoDataUrl);
    if (stored) {
      photoKey = stored.key;
      photoMime = stored.mime;
    }
  }

  await prisma.review.create({
    data: {
      companyId,
      customerName: data.customerName,
      city: data.city || null,
      serviceType: data.serviceType || null,
      rating: data.rating,
      reviewText: data.reviewText,
      consentToPublish: true,
      photoKey,
      photoMime,
      status: "pending",
    },
  });

  await prisma.activityLog.create({
    data: {
      companyId,
      type: "system",
      message: `New website review submitted by ${data.customerName} (${data.rating}★) — pending approval`,
    },
  });

  return { ok: true };
}

export type PublicReview = {
  id: string;
  name: string;
  location: string | null;
  service: string | null;
  rating: number;
  quote: string;
  photoUrl: string | null;
};

/**
 * Approved, consented, non-deleted, non-hidden reviews for the public site.
 * Featured first, then most recently approved. Safe to call from any RSC.
 */
export async function getPublicReviews(limit = 12): Promise<PublicReview[]> {
  // Marketing pages are statically prerendered, so this runs at build time too.
  // Never let a DB hiccup (or a build env without DATABASE_URL) crash the page —
  // degrade to no reviews and let the seed testimonials carry the section.
  try {
    const companyId = await resolvePrimaryCompanyId();
    if (!companyId) return [];

    const rows = await prisma.review.findMany({
      where: {
        companyId,
        status: "approved",
        deletedAt: null,
        hidden: false,
        consentToPublish: true,
      },
      orderBy: [{ featured: "desc" }, { approvedAt: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: {
        id: true,
        customerName: true,
        city: true,
        serviceType: true,
        rating: true,
        reviewText: true,
        photoKey: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      name: r.customerName,
      location: r.city,
      service: r.serviceType,
      rating: r.rating,
      quote: r.reviewText,
      photoUrl: r.photoKey ? `/api/reviews/photo?id=${r.id}` : null,
    }));
  } catch {
    return [];
  }
}

/** Aggregate rating + count for trust badges / schema markup. */
export async function getPublicReviewStats(): Promise<{ count: number; average: number } | null> {
  // Runs at build time via the marketing layout's structured data — fail soft so
  // a missing DB never breaks the static prerender (falls back to default rating).
  try {
    const companyId = await resolvePrimaryCompanyId();
    if (!companyId) return null;
    const agg = await prisma.review.aggregate({
      where: { companyId, status: "approved", deletedAt: null, hidden: false, consentToPublish: true },
      _count: true,
      _avg: { rating: true },
    });
    if (!agg._count) return null;
    return { count: agg._count, average: Math.round((agg._avg.rating ?? 0) * 10) / 10 };
  } catch {
    return null;
  }
}
