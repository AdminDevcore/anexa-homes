"use server";

import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { hashPassword } from "@/server/auth/password";
import { ensureRepVendor } from "@/server/modules/bookkeeping/rep-vendor";

function fail(error: string) {
  return { ok: false as const, error };
}

/** Look up an invitation by its raw token (for the activation page). */
export async function getInvitation(token: string) {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash },
    select: { id: true, email: true, role: true, expiresAt: true, acceptedAt: true, company: { select: { name: true } } },
  });
  if (!inv) return { ok: false as const, error: "This invite link is invalid." };
  if (inv.acceptedAt) return { ok: false as const, error: "This invite has already been used. Please sign in." };
  if (inv.expiresAt < new Date()) return { ok: false as const, error: "This invite link has expired. Ask for a new one." };
  return { ok: true as const, email: inv.email, role: inv.role, company: inv.company.name };
}

const acceptSchema = z.object({
  token: z.string().min(10),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  password: z.string().min(8).max(200),
});

/** Activate an invited account: create the user + set their password. */
export async function acceptInviteAction(input: z.infer<typeof acceptSchema>) {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return fail("Enter your name and a password (8+ characters).");
  const { token, firstName, lastName, password } = parsed.data;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const inv = await prisma.invitation.findUnique({ where: { tokenHash }, select: { id: true, companyId: true, email: true, role: true, expiresAt: true, acceptedAt: true } });
  if (!inv) return fail("This invite link is invalid.");
  if (inv.acceptedAt) return fail("This invite has already been used.");
  if (inv.expiresAt < new Date()) return fail("This invite link has expired.");

  const existing = await prisma.user.findFirst({ where: { companyId: inv.companyId, email: inv.email, deletedAt: null }, select: { id: true } });
  if (existing) return fail("An account with that email already exists. Please sign in.");

  const passwordHash = await hashPassword(password);
  // Next sequential employee number for this company (join order = rank).
  const last = await prisma.user.aggregate({ where: { companyId: inv.companyId }, _max: { employeeNo: true } });
  const employeeNo = (last._max.employeeNo ?? 0) + 1;
  const [createdUser] = await prisma.$transaction([
    prisma.user.create({
      data: { companyId: inv.companyId, email: inv.email, firstName, lastName, role: inv.role, status: "active", passwordHash, employeeNo },
    }),
    prisma.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } }),
  ]);
  // A new sales rep automatically becomes a 1099 contractor vendor in bookkeeping.
  if (inv.role === "sales_rep") await ensureRepVendor(inv.companyId, createdUser.id);
  return { ok: true as const, email: inv.email };
}
