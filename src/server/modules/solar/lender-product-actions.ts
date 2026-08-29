"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { factorToMicros } from "@/lib/solar-loan";

/**
 * A lender's rate sheet: what it will finance, and on what terms.
 *
 * Its own module rather than more of `actions.ts`, which is already 670 lines
 * of every other solar concern. Every export of a "use server" file is a
 * callable endpoint, so each one re-establishes who the caller is and scopes
 * every query to their company — an id posted from elsewhere must never reach
 * another company's rate sheet.
 */

const fail = (error: string) => ({ ok: false as const, error });
const ok = () => ({ ok: true as const });

const SETTINGS_PATH = "/portal/settings/lenders";

/**
 * Terms are validated PER PRODUCT, because "a product" means something
 * different for each. Loose optional fields would let a loan row be saved with
 * a PPA's rate and no APR, and it would price a deal at zero without
 * complaining.
 */
const productSchema = z
  .object({
    lenderId: z.string().min(1),
    // No `cash`: cash has no lender, and a cash deal quoted with a dealer fee
    // is simply overpriced.
    product: z.enum(["loan", "lease", "ppa"]),
    name: z.string().max(120).nullable().optional(),

    aprPct: z.number().min(0).max(50).nullable().optional(),
    termMonths: z.number().int().min(1).max(600).nullable().optional(),
    // At 100% the lender takes the entire sticker; the gross-up divides by zero.
    dealerFeePct: z.number().min(0).max(99).nullable().optional(),

    // Factors arrive as the decimal the sheet prints (0.005712) and are stored
    // in millionths. 0.05 is an absurd factor and 0 is not a payment, so both
    // ends are bounded rather than trusted.
    factorWithPaydown: z.number().min(0).max(0.05).nullable().optional(),
    factorWithoutPaydown: z.number().min(0).max(0.05).nullable().optional(),
    paydownPct: z.number().min(0).max(100).nullable().optional(),
    paydownMonths: z.number().int().min(1).max(120).nullable().optional(),

    leaseRateCentsPerKwMonth: z.number().int().min(1).max(100_000).nullable().optional(),
    /** Whether this paper funds a battery with no array. Off unless reviewed. */
    financesStorageOnly: z.boolean().optional(),
    rateMillsPerKwh: z.number().int().min(1).max(10_000).nullable().optional(),

    escalatorPct: z.number().min(0).max(20).nullable().optional(),
    termYears: z.number().int().min(1).max(50).nullable().optional(),

    rank: z.number().int().min(0).max(999).optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((d, ctx) => {
    const need = (field: keyof typeof d, label: string) => {
      if (d[field] == null) {
        ctx.addIssue({ code: "custom", path: [field], message: `${label} is required.` });
      }
    };
    if (d.product === "loan") {
      need("aprPct", "APR");
      need("termMonths", "Term");
      need("dealerFeePct", "Dealer fee");
    }
    if (d.product === "lease") {
      need("leaseRateCentsPerKwMonth", "Monthly rate per kW");
      need("escalatorPct", "Escalator");
      need("termYears", "Term");
    }
    if (d.product === "ppa") {
      need("rateMillsPerKwh", "Rate per kWh");
      need("escalatorPct", "Escalator");
      need("termYears", "Term");
    }

    // A paydown is two facts that only mean anything together: how much, and
    // by when. Half of it configured prints "pay down 30% by month null".
    if ((d.paydownPct == null) !== (d.paydownMonths == null)) {
      ctx.addIssue({
        code: "custom",
        path: ["paydownPct"],
        message: "A paydown needs both a percentage and the month it is due.",
      });
    }
    // The whole point of two factors is that skipping the paydown costs MORE.
    // Inverted, they quote a customer a reward for never paying it down.
    if (
      d.factorWithPaydown != null &&
      d.factorWithoutPaydown != null &&
      d.factorWithoutPaydown < d.factorWithPaydown
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["factorWithoutPaydown"],
        message: "The factor without the paydown should be the higher of the two — check the rate sheet.",
      });
    }
    // Factors are a LOAN's arithmetic. A lease or PPA carrying one would price
    // a monthly twice, by two different rules.
    if (d.product !== "loan" && (d.factorWithPaydown != null || d.factorWithoutPaydown != null)) {
      ctx.addIssue({
        code: "custom",
        path: ["factorWithPaydown"],
        message: "Payment factors belong to a loan.",
      });
    }
  });

export type LenderProductInput = z.infer<typeof productSchema>;

/** The first validation message, so the rep is told which field, not "invalid". */
function firstMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Invalid product.";
}

/**
 * Add or edit one product on a lender's rate sheet.
 *
 * Columns belonging to the other products are NULLED on every write rather than
 * left as they were. Editing a row from PPA to loan otherwise leaves the $/kWh
 * behind, and the deal-side code reads whichever field it finds — the same
 * defect `financeRowForProduct` exists to prevent, one level up.
 */
export async function upsertSolarLenderProductAction(
  id: string | null,
  input: LenderProductInput
) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return fail(firstMessage(parsed.error));
  const d = parsed.data;

  const lender = await prisma.solarLender.findFirst({
    where: { companyId: user.companyId, id: d.lenderId },
    select: { id: true },
  });
  if (!lender) return fail("Lender not found.");

  const data = {
    lenderId: d.lenderId,
    product: d.product,
    name: d.name?.trim() || null,
    aprPct: d.product === "loan" ? (d.aprPct ?? null) : null,
    termMonths: d.product === "loan" ? (d.termMonths ?? null) : null,
    dealerFeePct: d.product === "loan" ? (d.dealerFeePct ?? null) : null,
    leaseRateCentsPerKwMonth: d.product === "lease" ? (d.leaseRateCentsPerKwMonth ?? null) : null,
    // Loans only. A lease or PPA sells electricity and a battery generates
    // none; cash has no lender paper for eligibility to be a question about.
    financesStorageOnly: d.product === "loan" ? (d.financesStorageOnly ?? false) : false,
    rateMillsPerKwh: d.product === "ppa" ? (d.rateMillsPerKwh ?? null) : null,
    escalatorPct: d.product === "loan" ? null : (d.escalatorPct ?? null),
    termYears: d.product === "loan" ? null : (d.termYears ?? null),
    // Gated on the product like every other term: a row switched from loan to
    // PPA must not keep a factor that would price its monthly twice.
    factorWithPaydownMicros: d.product === "loan" ? factorToMicros(d.factorWithPaydown) : null,
    factorWithoutPaydownMicros: d.product === "loan" ? factorToMicros(d.factorWithoutPaydown) : null,
    paydownPct: d.product === "loan" ? (d.paydownPct ?? null) : null,
    paydownMonths: d.product === "loan" ? (d.paydownMonths ?? null) : null,
    ...(d.rank === undefined ? {} : { rank: d.rank }),
    ...(d.isActive === undefined ? {} : { isActive: d.isActive }),
  };

  if (id) {
    const existing = await prisma.solarLenderProduct.findFirst({
      where: { companyId: user.companyId, id },
      select: { id: true },
    });
    if (!existing) return fail("Not found.");
    await prisma.solarLenderProduct.update({ where: { id }, data });
  } else {
    await prisma.solarLenderProduct.create({
      data: { companyId: user.companyId, ...data },
    });
  }
  revalidatePath(SETTINGS_PATH);
  return ok();
}

/**
 * Retire a product, or bring it back.
 *
 * Retiring is the answer to "we stopped offering that rate", not deleting. It
 * leaves every deal quoted from it exactly as it was while removing it from the
 * picker on new work — the same rule equipment and lenders already follow.
 */
export async function setSolarLenderProductActiveAction(id: string, isActive: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const p = await prisma.solarLenderProduct.findFirst({
    where: { companyId: user.companyId, id },
    select: { id: true },
  });
  if (!p) return fail("Not found.");
  await prisma.solarLenderProduct.update({ where: { id }, data: { isActive } });
  revalidatePath(SETTINGS_PATH);
  return { ok: true as const, message: isActive ? "Product is sellable again." : "Product retired." };
}

/**
 * Delete a product outright. REFUSED while any deal was quoted from it.
 *
 * The foreign key is ON DELETE SET NULL, so this would not fail loudly — it
 * would quietly cut those deals loose from the rate sheet they were priced on,
 * leaving an APR on the row with nothing to explain where it came from.
 * Deleting stays available for a row nobody ever quoted: a typo, a duplicate, a
 * rate that never went live.
 */
export async function deleteSolarLenderProductAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const p = await prisma.solarLenderProduct.findFirst({
    where: { companyId: user.companyId, id },
    select: { id: true },
  });
  if (!p) return fail("Not found.");

  const quoted = await prisma.solarFinance.count({
    where: { companyId: user.companyId, lenderProductId: id },
  });
  if (quoted > 0) {
    return fail(
      `${quoted} ${quoted === 1 ? "deal was" : "deals were"} quoted from this product. ` +
        `Deleting it would cut ${quoted === 1 ? "that deal" : "those deals"} loose from the terms ` +
        `${quoted === 1 ? "it was" : "they were"} priced on. Retire it instead — it disappears from ` +
        `new deals and every existing one keeps its terms.`
    );
  }

  await prisma.solarLenderProduct.delete({ where: { id } });
  revalidatePath(SETTINGS_PATH);
  return ok();
}
