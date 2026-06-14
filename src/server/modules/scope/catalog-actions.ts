"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { SCOPE_UNITS } from "@/lib/scope-catalog";

type Result = { ok: true } | { ok: false; error: string };

async function gate(): Promise<{ companyId: string } | { error: string }> {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return { error: "Not allowed." };
  return { companyId: user.companyId };
}

export async function createCatalogItemAction(input: {
  category: string;
  subcategory?: string;
  description: string;
  unit: string;
  trade: string;
  isCommonInsuranceItem?: boolean;
  isSupplementEligible?: boolean;
}): Promise<Result> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const description = input.description?.trim();
  if (!description) return { ok: false, error: "Description is required." };
  const unit = (SCOPE_UNITS as readonly string[]).includes(input.unit) ? input.unit : "EA";

  const count = await prisma.scopeCatalogItem.count({ where: { companyId: g.companyId } });
  await prisma.scopeCatalogItem.create({
    data: {
      companyId: g.companyId,
      position: count,
      category: input.category?.trim() || "General",
      subcategory: input.subcategory?.trim() || "",
      description,
      unit,
      trade: input.trade?.trim() || "General",
      isCommonInsuranceItem: !!input.isCommonInsuranceItem,
      isSupplementEligible: !!input.isSupplementEligible,
      isActive: true,
    },
  });
  revalidatePath("/portal/settings/scope-template");
  return { ok: true };
}

export async function updateCatalogItemAction(input: {
  id: string;
  category?: string;
  subcategory?: string;
  description?: string;
  unit?: string;
  trade?: string;
  isCommonInsuranceItem?: boolean;
  isSupplementEligible?: boolean;
  isActive?: boolean;
}): Promise<Result> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const existing = await prisma.scopeCatalogItem.findFirst({ where: { id: input.id, companyId: g.companyId }, select: { id: true } });
  if (!existing) return { ok: false, error: "Item not found." };

  const data: Prisma.ScopeCatalogItemUpdateInput = {};
  if (input.category !== undefined) data.category = input.category.trim() || "General";
  if (input.subcategory !== undefined) data.subcategory = input.subcategory.trim();
  if (input.description !== undefined) {
    const d = input.description.trim();
    if (!d) return { ok: false, error: "Description can't be empty." };
    data.description = d;
  }
  if (input.unit !== undefined && (SCOPE_UNITS as readonly string[]).includes(input.unit)) data.unit = input.unit;
  if (input.trade !== undefined) data.trade = input.trade.trim() || "General";
  if (input.isCommonInsuranceItem !== undefined) data.isCommonInsuranceItem = input.isCommonInsuranceItem;
  if (input.isSupplementEligible !== undefined) data.isSupplementEligible = input.isSupplementEligible;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  await prisma.scopeCatalogItem.update({ where: { id: input.id }, data });
  revalidatePath("/portal/settings/scope-template");
  return { ok: true };
}

export async function deleteCatalogItemAction(id: string): Promise<Result> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const existing = await prisma.scopeCatalogItem.findFirst({ where: { id, companyId: g.companyId }, select: { id: true } });
  if (!existing) return { ok: false, error: "Item not found." };
  await prisma.scopeCatalogItem.delete({ where: { id } });
  revalidatePath("/portal/settings/scope-template");
  return { ok: true };
}
