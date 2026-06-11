"use server";

import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { putObject } from "@/server/storage";
import { encryptField } from "@/server/lib/crypto";

function fail(error: string) {
  return { ok: false as const, error };
}
function safeName(n: string): string {
  return n.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "file";
}

const onboardingSchema = z.object({
  legalFirstName: z.string().max(80).optional().or(z.literal("")),
  legalMiddleName: z.string().max(80).optional().or(z.literal("")),
  legalLastName: z.string().max(80).optional().or(z.literal("")),
  dateOfBirth: z.string().optional().or(z.literal("")),
  ssn: z.string().max(20).optional().or(z.literal("")),
  address: z.string().max(160).optional().or(z.literal("")),
  city: z.string().max(80).optional().or(z.literal("")),
  state: z.string().max(40).optional().or(z.literal("")),
  zip: z.string().max(12).optional().or(z.literal("")),
  bankName: z.string().max(120).optional().or(z.literal("")),
  routingNumber: z.string().max(20).optional().or(z.literal("")),
  account: z.string().max(30).optional().or(z.literal("")),
  accountType: z.string().max(20).optional().or(z.literal("")),
  taxClassification: z.string().max(40).optional().or(z.literal("")),
  businessName: z.string().max(160).optional().or(z.literal("")),
  ein: z.string().max(20).optional().or(z.literal("")),
  signatureName: z.string().max(120).optional().or(z.literal("")),
  complete: z.boolean().optional(),
});

const last4 = (s: string) => s.replace(/\D/g, "").slice(-4);

/** Save the current user's onboarding info (encrypting SSN / account / EIN). */
export async function saveOnboardingAction(input: z.infer<typeof onboardingSchema>) {
  const user = await requireUser();
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the form and try again.");
  const d = parsed.data;
  if (d.complete) {
    if (!d.legalFirstName || !d.legalLastName) return fail("Legal first and last name are required.");
    if (!d.ssn) return fail("SSN is required.");
    if (!d.signatureName) return fail("Type your name to sign and submit.");
  }
  const dob = d.dateOfBirth ? new Date(`${d.dateOfBirth}T12:00:00`) : null;

  const data = {
    legalFirstName: d.legalFirstName || null,
    legalMiddleName: d.legalMiddleName || null,
    legalLastName: d.legalLastName || null,
    dateOfBirth: dob && !Number.isNaN(dob.getTime()) ? dob : null,
    ...(d.ssn ? { ssnEnc: encryptField(d.ssn), ssnLast4: last4(d.ssn) } : {}),
    address: d.address || null,
    city: d.city || null,
    state: d.state || null,
    zip: d.zip || null,
    bankName: d.bankName || null,
    routingNumber: d.routingNumber || null,
    ...(d.account ? { accountEnc: encryptField(d.account), accountLast4: last4(d.account) } : {}),
    accountType: d.accountType || null,
    taxClassification: d.taxClassification || null,
    businessName: d.businessName || null,
    ...(d.ein ? { einEnc: encryptField(d.ein), einLast4: last4(d.ein) } : {}),
    ...(d.signatureName ? { signatureName: d.signatureName, signedAt: new Date() } : {}),
    ...(d.complete ? { completedAt: new Date() } : {}),
  };

  await prisma.userOnboarding.upsert({
    where: { userId: user.userId },
    update: data,
    create: { userId: user.userId, ...data },
  });
  revalidatePath("/portal/onboarding");
  revalidatePath(`/portal/team/${user.userId}`);
  return { ok: true as const, completed: !!d.complete };
}

/** Upload an onboarding document (government ID, SS card, voided check). */
export async function uploadOnboardingDocAction(formData: FormData) {
  const user = await requireUser();
  const kind = String(formData.get("kind") || "");
  const field = ({ id: "idPhotoFileId", ssn_card: "ssnCardFileId", voided_check: "voidedCheckFileId" } as Record<string, string>)[kind];
  if (!field) return fail("Unknown document type.");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("No file provided.");
  if (file.size > 15 * 1024 * 1024) return fail("File too large (max 15MB).");

  const buf = Buffer.from(await file.arrayBuffer());
  const storageKey = `companies/${user.companyId}/onboarding/${user.userId}/${nanoid()}-${safeName(file.name)}`;
  await putObject(storageKey, buf);
  const asset = await prisma.fileAsset.create({
    data: {
      companyId: user.companyId, kind: "document", name: file.name, storageKey,
      mimeType: file.type || null, size: buf.length, category: "onboarding", uploadedById: user.userId,
    },
    select: { id: true },
  });
  await prisma.userOnboarding.upsert({
    where: { userId: user.userId },
    update: { [field]: asset.id },
    create: { userId: user.userId, [field]: asset.id },
  });
  revalidatePath("/portal/onboarding");
  return { ok: true as const, fileId: asset.id };
}
