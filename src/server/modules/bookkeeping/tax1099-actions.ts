"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";

/** Set the company's payer EIN / Tax ID (used as the payer TIN on 1099 filings). */
export async function setCompanyEinAction(einTaxId: string) {
  const user = await requireUser();
  if (!can(user, "update", "Bookkeeping")) return { ok: false as const, error: "Not allowed." };
  await prisma.company.update({
    where: { id: user.companyId },
    data: { einTaxId: einTaxId.trim() || null },
  });
  revalidatePath("/portal/bookkeeping/1099");
  return { ok: true as const };
}
