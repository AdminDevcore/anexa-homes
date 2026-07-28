"use server";

import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { emailBrandFor } from "@/server/modules/notifications/brand";
import { sendEmail } from "@/server/modules/notifications/delivery";
import { brandedEmailTemplate } from "@/server/modules/notifications/email-templates";
import { hashPassword } from "./password";

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

const emailSchema = z.object({ email: z.string().email() });

export type ResetRequestState = { ok?: boolean; error?: string } | undefined;

export async function requestPasswordReset(
  _prev: ResetRequestState,
  formData: FormData
): Promise<ResetRequestState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "Enter a valid email." };

  const email = parsed.data.email.toLowerCase().trim();
  const user = await prisma.user.findFirst({
    where: { email },
    select: {
      id: true,
      email: true,
      companyId: true,
      firstName: true,
      status: true,
      role: true,
      deletedAt: true,
    },
  });

  // Only accounts that could actually sign in get a link — mirrors the same
  // eligibility check the credentials provider applies on login.
  const eligible =
    !!user &&
    !user.deletedAt &&
    user.status !== "disabled" &&
    user.status !== "suspended" &&
    user.role !== "customer";

  // Always succeed to avoid leaking which emails exist.
  if (user && eligible) {
    const raw = crypto.randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60), // 1 hour
      },
    });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const url = `${appUrl}/reset-password?token=${raw}`;

    const { brand, fromName } = await emailBrandFor(user.companyId);
    const tpl = brandedEmailTemplate({
      brand,
      subject: `Reset your ${brand.companyName} password`,
      preheader: "Use this secure link to choose a new password. It expires in 1 hour.",
      heading: "Reset your password",
      paragraphs: [
        `Hi ${user.firstName || "there"},`,
        `We received a request to reset the password for your ${brand.companyName} account (${user.email}). Click the button below to choose a new one.`,
      ],
      cta: { label: "Reset my password", url },
      note: "This link expires in 1 hour and can only be used once. If you didn't request a reset, you can safely ignore this email — your password won't change.",
    });

    const sent = await sendEmail(user.email, tpl.subject, tpl.text, {
      fromName,
      html: tpl.html,
    }).catch(() => false);

    if (!sent) {
      // No provider configured (dev) or the provider rejected it — log the link
      // so the flow stays testable and prod failures are visible in the logs.
      console.warn(`[password-reset] email NOT delivered to ${user.email} -> ${url}`);
    }
  }

  return { ok: true };
}

const resetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type ResetState = { ok?: boolean; error?: string } | undefined;

export async function resetPassword(
  _prev: ResetState,
  formData: FormData
): Promise<ResetState> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: sha256(parsed.data.token) },
  });

  if (!record || record.consumedAt || record.expiresAt < new Date()) {
    return { error: "This reset link is invalid or has expired." };
  }

  const passwordHash = await hashPassword(parsed.data.password);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
  ]);

  return { ok: true };
}
