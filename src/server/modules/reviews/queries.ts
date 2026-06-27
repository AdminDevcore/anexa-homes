import type { Prisma, ReviewStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";

export type AdminReviewFilter = "all" | "pending" | "approved" | "rejected";

export type AdminReview = {
  id: string;
  customerName: string;
  city: string | null;
  serviceType: string | null;
  rating: number;
  reviewText: string;
  photoUrl: string | null;
  status: ReviewStatus;
  featured: boolean;
  hidden: boolean;
  consentToPublish: boolean;
  createdAt: string;
  approvedAt: string | null;
  approvedByName: string | null;
};

export async function getReviewCounts(companyId: string) {
  const grouped = await prisma.review.groupBy({
    by: ["status"],
    where: { companyId, deletedAt: null },
    _count: true,
  });
  const counts = { all: 0, pending: 0, approved: 0, rejected: 0 };
  for (const g of grouped) {
    counts[g.status] = g._count;
    counts.all += g._count;
  }
  return counts;
}

export async function getReviewsForAdmin(
  companyId: string,
  filter: AdminReviewFilter = "all",
  search = ""
): Promise<AdminReview[]> {
  const where: Prisma.ReviewWhereInput = { companyId, deletedAt: null };
  if (filter !== "all") where.status = filter;
  const q = search.trim();
  if (q) {
    where.OR = [
      { customerName: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { serviceType: { contains: q, mode: "insensitive" } },
      { reviewText: { contains: q, mode: "insensitive" } },
    ];
  }

  const rows = await prisma.review.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: 300,
    select: {
      id: true,
      customerName: true,
      city: true,
      serviceType: true,
      rating: true,
      reviewText: true,
      photoKey: true,
      status: true,
      featured: true,
      hidden: true,
      consentToPublish: true,
      createdAt: true,
      approvedAt: true,
      approvedBy: { select: { firstName: true, lastName: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    customerName: r.customerName,
    city: r.city,
    serviceType: r.serviceType,
    rating: r.rating,
    reviewText: r.reviewText,
    photoUrl: r.photoKey ? `/api/reviews/photo?id=${r.id}` : null,
    status: r.status,
    featured: r.featured,
    hidden: r.hidden,
    consentToPublish: r.consentToPublish,
    createdAt: r.createdAt.toISOString(),
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    approvedByName: r.approvedBy ? `${r.approvedBy.firstName} ${r.approvedBy.lastName}`.trim() : null,
  }));
}
