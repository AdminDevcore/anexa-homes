"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { recomputeAdderTotal } from "./adders";

/**
 * Putting extra work on a solar deal, one line at a time.
 *
 * Every one of these ends by recomputing `SolarFinance.adderTotalCents`, which
 * is what the pricing, the commission engine and the customer's proposal read.
 * The rep never sends a total — the same discipline as the panel count and the
 * system size, and for the same reason: a figure a homeowner is shown must come
 * from something nobody in the browser can retype.
 */

const fail = (error: string) => ({ ok: false as const, error });

/** A residential adder over a million dollars is a typo, not a re-roof. */
const CENTS_MAX = 100_000_000;

const addSchema = z.object({
  leadId: z.string().min(1),
  /** Null for a one-off priced on the deal rather than picked off the sheet. */
  equipmentId: z.string().min(1).nullish(),
  label: z.string().trim().min(1).max(120),
  basis: z.enum(["flat", "perWatt", "custom"]),
  flatCents: z.number().int().min(0).max(CENTS_MAX).nullish(),
  // 10,000 mills is $10/W. A rate above that is a units mistake — almost
  // certainly dollars typed where mills were wanted.
  millsPerWatt: z.number().int().min(0).max(10_000).nullish(),
  qty: z.number().int().min(1).max(99).default(1),
});

type SolarUser = Awaited<ReturnType<typeof requireUser>>;

/**
 * The guard every one of these shares: a solar deal this user may price.
 *
 * Discriminated on `ok`, and the return type is written out rather than
 * inferred. TypeScript unifies the object literals from several `return`
 * statements by making each other branch's keys optional-undefined, which
 * defeats `"error" in g` narrowing — both members then carry the key — and
 * `g.error` comes back as `string | undefined` at every call site.
 */
async function guard(
  leadId: string
): Promise<{ ok: false; error: string } | { ok: true; user: SolarUser }> {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return { ok: false, error: "Not allowed." };
  const lead = await prisma.lead.findFirst({
    where: { companyId: user.companyId, id: leadId },
    select: { id: true, vertical: true },
  });
  if (!lead) return { ok: false, error: "Deal not found." };
  if (lead.vertical !== "solar") return { ok: false, error: "This is not a solar deal." };
  return { ok: true, user };
}

/** Everything that has to be re-rendered once the money moves. */
function revalidateDeal(leadId: string) {
  revalidatePath(`/portal/leads/${leadId}`);
  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
}

export async function addDealAdderAction(input: z.infer<typeof addSchema>) {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return fail("That adder could not be read.");
  const g = await guard(parsed.data.leadId);
  if (!g.ok) return fail(g.error);
  const { leadId, equipmentId, label, basis, qty } = parsed.data;

  // A basis decides which column means anything, so the other one is stored as
  // null rather than left holding a stale figure from the form it came off.
  const flatCents = basis === "perWatt" ? null : (parsed.data.flatCents ?? 0);
  const millsPerWatt = basis === "perWatt" ? (parsed.data.millsPerWatt ?? 0) : null;
  if (basis === "perWatt" && !millsPerWatt) return fail("Give the rate per watt.");
  if (basis !== "perWatt" && !flatCents) return fail("Give the amount.");

  // A catalogue item has to be one of OUR adders. Passing another company's id,
  // or a module id, would put a line on the quote that the catalogue disowns.
  if (equipmentId) {
    const item = await prisma.solarEquipment.findFirst({
      where: { id: equipmentId, companyId: g.user.companyId, kind: "adder" },
      select: { id: true },
    });
    if (!item) return fail("That adder is not in the catalogue.");
  }

  const last = await prisma.solarDealAdder.findFirst({
    where: { companyId: g.user.companyId, leadId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  await prisma.solarDealAdder.create({
    data: {
      companyId: g.user.companyId,
      leadId,
      equipmentId: equipmentId ?? null,
      label,
      basis,
      flatCents,
      millsPerWatt,
      qty,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });

  const totalCents = await recomputeAdderTotal(g.user.companyId, leadId, { force: true });
  revalidateDeal(leadId);
  return { ok: true as const, totalCents };
}

const updateSchema = z.object({
  leadId: z.string().min(1),
  id: z.string().min(1),
  qty: z.number().int().min(1).max(99).optional(),
  flatCents: z.number().int().min(0).max(CENTS_MAX).nullish(),
  millsPerWatt: z.number().int().min(0).max(10_000).nullish(),
  label: z.string().trim().min(1).max(120).optional(),
});

export async function updateDealAdderAction(input: z.infer<typeof updateSchema>) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail("That change could not be read.");
  const g = await guard(parsed.data.leadId);
  if (!g.ok) return fail(g.error);
  const { leadId, id, qty, label } = parsed.data;

  const existing = await prisma.solarDealAdder.findFirst({
    where: { id, leadId, companyId: g.user.companyId },
    select: { basis: true },
  });
  if (!existing) return fail("That adder is not on this deal.");

  // Only the column this line's basis actually uses is writable. Letting a
  // per-watt line accept a flat amount stores two prices for one adder, and
  // which one applies then depends on which code path reads it.
  const money =
    existing.basis === "perWatt"
      ? parsed.data.millsPerWatt != null
        ? { millsPerWatt: parsed.data.millsPerWatt }
        : {}
      : parsed.data.flatCents != null
        ? { flatCents: parsed.data.flatCents }
        : {};

  await prisma.solarDealAdder.update({
    where: { id },
    data: { ...money, ...(qty != null ? { qty } : {}), ...(label ? { label } : {}) },
  });

  const totalCents = await recomputeAdderTotal(g.user.companyId, leadId, { force: true });
  revalidateDeal(leadId);
  return { ok: true as const, totalCents };
}

export async function removeDealAdderAction(input: { leadId: string; id: string }) {
  const parsed = z
    .object({ leadId: z.string().min(1), id: z.string().min(1) })
    .safeParse(input);
  if (!parsed.success) return fail("That adder could not be read.");
  const g = await guard(parsed.data.leadId);
  if (!g.ok) return fail(g.error);

  // Scoped by lead AND company, so an id from another deal deletes nothing.
  const { count } = await prisma.solarDealAdder.deleteMany({
    where: { id: parsed.data.id, leadId: parsed.data.leadId, companyId: g.user.companyId },
  });
  if (count === 0) return fail("That adder is not on this deal.");

  const totalCents = await recomputeAdderTotal(g.user.companyId, parsed.data.leadId, { force: true });
  revalidateDeal(parsed.data.leadId);
  return { ok: true as const, totalCents };
}

const syncSchema = z.object({
  leadId: z.string().min(1),
  /** Every catalogue adder that should be on the deal when this returns. */
  equipmentIds: z.array(z.string().min(1)).max(200),
});

/**
 * Put the deal's catalogue adders where the picker says they should be.
 *
 * A checkbox list is a STATE, not a stream of clicks: a rep opens the picker,
 * ticks two, unticks one, and presses Add once. Sending that as three separate
 * writes means three round trips, three recomputes of the contract price, and a
 * half-applied list if the third one fails. This takes the whole set and makes
 * the deal match it.
 *
 * ONE-OFF LINES ARE NEVER TOUCHED. A line typed on this deal — "tree removal,
 * $900" — has no catalogue item behind it and so cannot be represented by a
 * checkbox; deleting it because it is not in the ticked set would silently take
 * money off a quote from a screen that never showed it.
 *
 * Quantities survive: an item that is already on the deal at qty 3 and is still
 * ticked is left exactly as it is rather than reset to 1.
 */
export async function syncDealCatalogueAddersAction(input: z.infer<typeof syncSchema>) {
  const parsed = syncSchema.safeParse(input);
  if (!parsed.success) return fail("That selection could not be read.");
  const g = await guard(parsed.data.leadId);
  if (!g.ok) return fail(g.error);
  const { leadId } = parsed.data;
  const wanted = [...new Set(parsed.data.equipmentIds)];

  // Every id has to be one of OUR adders. An id from another company, or a
  // module id, would put a line on the quote that the catalogue disowns.
  const items = await prisma.solarEquipment.findMany({
    where: { id: { in: wanted }, companyId: g.user.companyId, kind: "adder" },
    select: {
      id: true,
      manufacturer: true,
      model: true,
      priceCents: true,
      priceMillsPerWatt: true,
      rank: true,
    },
    orderBy: [{ rank: "asc" }, { model: "asc" }],
  });
  if (items.length !== wanted.length) return fail("One of those adders is not in the catalogue.");

  const existing = await prisma.solarDealAdder.findMany({
    where: { companyId: g.user.companyId, leadId, equipmentId: { not: null } },
    select: { id: true, equipmentId: true },
  });
  const onDeal = new Set(existing.map((l) => l.equipmentId!));
  const drop = existing.filter((l) => !wanted.includes(l.equipmentId!)).map((l) => l.id);
  const add = items.filter((i) => !onDeal.has(i.id));

  const last = await prisma.solarDealAdder.findFirst({
    where: { companyId: g.user.companyId, leadId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  let sortOrder = last?.sortOrder ?? 0;

  // One transaction, so a deal is never left holding half a rep's selection.
  await prisma.$transaction([
    ...(drop.length ? [prisma.solarDealAdder.deleteMany({ where: { id: { in: drop } } })] : []),
    ...add.map((i) =>
      prisma.solarDealAdder.create({
        data: {
          companyId: g.user.companyId,
          leadId,
          equipmentId: i.id,
          // The label is COPIED, not joined at read time: the quote has to keep
          // saying what was sold even after somebody renames the catalogue row.
          label: [i.manufacturer, i.model].filter(Boolean).join(" ") || i.model,
          basis: i.priceMillsPerWatt ? "perWatt" : "flat",
          flatCents: i.priceMillsPerWatt ? null : i.priceCents,
          millsPerWatt: i.priceMillsPerWatt,
          qty: 1,
          sortOrder: ++sortOrder,
        },
      })
    ),
  ]);

  const totalCents = await recomputeAdderTotal(g.user.companyId, leadId, { force: true });
  revalidateDeal(leadId);
  return { ok: true as const, totalCents, added: add.length, removed: drop.length };
}
