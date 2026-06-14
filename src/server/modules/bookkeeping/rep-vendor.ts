import { prisma } from "@/server/db/client";

/**
 * Ensure a team member has a linked 1099 contractor vendor in bookkeeping, so
 * their commission payouts can be tracked as contractor payments and roll up
 * onto their 1099. Idempotent: returns the existing link if there is one.
 * Called whenever a sales rep is created or a member becomes a sales rep.
 */
export async function ensureRepVendor(companyId: string, userId: string): Promise<string | null> {
  const existing = await prisma.bookkeepingVendor.findFirst({ where: { companyId, userId }, select: { id: true } });
  if (existing) return existing.id;

  const u = await prisma.user.findFirst({
    where: { id: userId, companyId },
    select: { firstName: true, lastName: true, email: true },
  });
  if (!u) return null;
  const name = `${u.firstName} ${u.lastName}`.trim() || u.email;

  const vendor = await prisma.bookkeepingVendor.create({
    data: {
      companyId,
      userId,
      name,
      contactName: name,
      email: u.email,
      is1099: true,
    },
    select: { id: true },
  });
  return vendor.id;
}
