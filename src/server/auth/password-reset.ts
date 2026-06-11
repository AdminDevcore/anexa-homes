"use server";

import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/server/db/client";
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

  const user = await prisma.user.findFirst({
    where: { email: parsed.data.email.toLowerCase().trim() },
    select: { id: true },
  });

  // Always succeed to avoid leaking which emails exist.
  if (user) {
    const raw = crypto.randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60), // 1 hour
      },
    });
    const url = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/reset-password?token=${raw}`;
    // In production, send via email. In dev, log the link so it can be tested.
    console.log(`[password-reset] ${parsed.data.email} -> ${url}`);
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
