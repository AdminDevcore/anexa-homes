"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { leadAccessible } from "@/server/rbac/lead-access";
import { checkSignedLock } from "./signed-lock";
import { recomputeDealMoney } from "./deal-money";
import { ADDER_BASES } from "@/lib/solar-adders";
import {
  dealLenderId,
  financedOnTopFor,
  lenderAdderRules,
  lineFromCatalogue,
  parseOptOut,
  recomputeAdderTotal,
} from "./adders";

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

/**
 * The count cap, per basis.
 *
 * Ninety-nine is the right ceiling for a thing somebody buys several of and a
 * nonsense one for a trench: a 400-foot run to a detached shop is an ordinary
 * job, and rejecting it would send the rep to price it as a one-off with the
 * unit rate lost. Feet get their own, larger, ceiling.
 */
const QTY_MAX: Record<string, number> = { perFoot: 10_000, perUnit: 999 };
const qtyMaxFor = (basis: string) => QTY_MAX[basis] ?? 99;

/** kWh a single adder may add to a year. A house uses ~11,000; a fleet is not an adder. */
const CONSUMPTION_MAX = 100_000;

const BASIS_ENUM = z.enum(
  Object.keys(ADDER_BASES) as [keyof typeof ADDER_BASES, ...(keyof typeof ADDER_BASES)[]]
);

const addSchema = z.object({
  leadId: z.string().min(1),
  /** Null for a one-off priced on the deal rather than picked off the sheet. */
  equipmentId: z.string().min(1).nullish(),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  basis: BASIS_ENUM,
  flatCents: z.number().int().min(0).max(CENTS_MAX).nullish(),
  // 10,000 mills is $10/W. A rate above that is a units mistake — almost
  // certainly dollars typed where mills were wanted.
  millsPerWatt: z.number().int().min(0).max(10_000).nullish(),
  qty: z.number().int().min(1).max(10_000).default(1),
  showOnProposal: z.boolean().default(false),
  /**
   * Only meaningful on a ONE-OFF typed straight onto the deal. A line picked
   * off the catalogue takes the catalogue's answer, whatever arrives here.
   */
  financedOnTop: z.boolean().default(false),
  consumptionKwhPerYear: z.number().int().min(0).max(CONSUMPTION_MAX).nullish(),
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
  const lead = await leadAccessible(user, leadId);
  if (!lead) return { ok: false, error: "Deal not found." };
  if (lead.vertical !== "solar") return { ok: false, error: "This is not a solar deal." };
  /**
   * Adders are money on the contract — they gross up by the fee, they move the
   * total the customer signed, and on a flat-rate partner they ride on top of
   * it. A signature settles them with everything else.
   */
  const lock = await checkSignedLock(user, leadId, "the adders");
  if (lock.blocked) return { ok: false, error: lock.error };
  return { ok: true, user };
}

/**
 * Recompute both cached adder totals and return what the extra work comes to.
 *
 * The two halves are priced by different rules — see `financedOnTop` — but a
 * caller being told what it just changed wants ONE number, and every one of
 * these actions returns the same one it always did.
 */
async function adderGrandTotal(companyId: string, leadId: string): Promise<number> {
  const split = await recomputeAdderTotal(companyId, leadId, { force: true });
  /**
   * The adders are part of the contract, so moving them moves the contract.
   *
   * `recomputeAdderTotal` writes the two adder columns and stops; the cached
   * `contractPriceCents` beside them used to be left behind, which is how a
   * deal ended up quoting one figure on the builder and another to the lender.
   * See `recomputeDealMoney`.
   */
  await recomputeDealMoney(companyId, leadId);
  return split.adderTotalCents + split.onTopAdderTotalCents;
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
  const { leadId, equipmentId, label, basis } = parsed.data;

  // A basis decides which column means anything, so the other one is stored as
  // null rather than left holding a stale figure from the form it came off.
  const flatCents = basis === "perWatt" ? null : (parsed.data.flatCents ?? 0);
  const millsPerWatt = basis === "perWatt" ? (parsed.data.millsPerWatt ?? 0) : null;
  if (basis === "perWatt" && !millsPerWatt) return fail("Give the rate per watt.");
  if (basis !== "perWatt" && !flatCents) return fail("Give the amount.");

  // Only a basis that is priced PER something carries a count. Storing 120 on a
  // fixed line would multiply a $2,700 panel upgrade by a hundred and twenty.
  const qty = ADDER_BASES[basis].counted
    ? Math.min(Math.max(1, parsed.data.qty), qtyMaxFor(basis))
    : 1;

  // A catalogue item has to be one of OUR adders. Passing another company's id,
  // or a module id, would put a line on the quote that the catalogue disowns.
  //
  // It also decides whether this line rides ON TOP of a partner's price. Read
  // off the row rather than taken from the request for the same reason the
  // price of a quoted programme is: a flag a caller can post is a flag anybody
  // can post, and this one moves what the customer signs.
  //
  // And the answer is the LENDER'S first: the catalogue's tick is the company's
  // general practice, the lender's rule is what this partner's paper actually
  // does with the work, and only the second one is a fact about the contract.
  let financedOnTop = parsed.data.financedOnTop ?? false;
  if (equipmentId) {
    const item = await prisma.solarEquipment.findFirst({
      where: { id: equipmentId, companyId: g.user.companyId, kind: "adder" },
      select: { id: true, financedOnTop: true },
    });
    if (!item) return fail("That adder is not in the catalogue.");
    const rules = await lenderAdderRules(await dealLenderId(leadId));
    financedOnTop = financedOnTopFor(rules, item.id, item.financedOnTop);
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
      description: parsed.data.description?.trim() || null,
      basis,
      flatCents,
      millsPerWatt,
      qty,
      showOnProposal: parsed.data.showOnProposal,
      financedOnTop,
      consumptionKwhPerYear: parsed.data.consumptionKwhPerYear ?? null,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });

  const totalCents = await adderGrandTotal(g.user.companyId, leadId);
  revalidateDeal(leadId);
  return { ok: true as const, totalCents };
}

const updateSchema = z.object({
  leadId: z.string().min(1),
  id: z.string().min(1),
  qty: z.number().int().min(1).max(10_000).optional(),
  flatCents: z.number().int().min(0).max(CENTS_MAX).nullish(),
  millsPerWatt: z.number().int().min(0).max(10_000).nullish(),
  label: z.string().trim().min(1).max(120).optional(),
  /**
   * What this adder does to the household's year, kWh. Only meaningful on a
   * line whose catalogue item was marked as changing consumption; sent as null
   * to clear it.
   */
  consumptionKwhPerYear: z.number().int().min(0).max(CONSUMPTION_MAX).nullish(),
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

  // Only a basis priced PER something takes a count, and each has its own
  // ceiling — a 400-foot trench is a job, 400 main panel upgrades is a typo.
  const countable = ADDER_BASES[existing.basis as keyof typeof ADDER_BASES]?.counted ?? false;
  const nextQty =
    qty != null && countable
      ? Math.min(Math.max(1, qty), qtyMaxFor(existing.basis))
      : undefined;

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
    data: {
      ...money,
      ...(nextQty != null ? { qty: nextQty } : {}),
      ...(label ? { label } : {}),
      ...(parsed.data.consumptionKwhPerYear !== undefined
        ? { consumptionKwhPerYear: parsed.data.consumptionKwhPerYear ?? null }
        : {}),
    },
  });

  const totalCents = await adderGrandTotal(g.user.companyId, leadId);
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

  const line = await prisma.solarDealAdder.findFirst({
    where: { id: parsed.data.id, leadId: parsed.data.leadId, companyId: g.user.companyId },
    select: { id: true, equipmentId: true, autoApplied: true },
  });
  if (!line) return fail("That adder is not on this deal.");

  // Scoped by lead AND company, so an id from another deal deletes nothing.
  const { count } = await prisma.solarDealAdder.deleteMany({
    where: { id: parsed.data.id, leadId: parsed.data.leadId, companyId: g.user.companyId },
  });
  if (count === 0) return fail("That adder is not on this deal.");

  /**
   * Taking off an adder the SIZE RULE put here has to be remembered.
   *
   * Otherwise the next recompute — a rep nudging one panel, a module swap — puts
   * it straight back, and the only feedback the rep gets is that their click
   * appeared to do nothing. The opt-out is per deal and per catalogue item, so
   * the rule keeps working everywhere else.
   */
  if (line.autoApplied && line.equipmentId) {
    await rememberOptOut(parsed.data.leadId, [line.equipmentId], "add");
  }

  const totalCents = await adderGrandTotal(g.user.companyId, parsed.data.leadId);
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
      description: true,
      adderBasis: true,
      priceCents: true,
      priceMillsPerWatt: true,
      showOnProposal: true,
      financedOnTop: true,
      rank: true,
    },
    orderBy: [{ rank: "asc" }, { model: "asc" }],
  });
  if (items.length !== wanted.length) return fail("One of those adders is not in the catalogue.");

  const existing = await prisma.solarDealAdder.findMany({
    where: { companyId: g.user.companyId, leadId, equipmentId: { not: null } },
    select: { id: true, equipmentId: true, autoApplied: true },
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

  // What this deal's partner does with each of these, where it has said.
  const lenderRules = await lenderAdderRules(await dealLenderId(leadId));

  // One transaction, so a deal is never left holding half a rep's selection.
  await prisma.$transaction([
    ...(drop.length ? [prisma.solarDealAdder.deleteMany({ where: { id: { in: drop } } })] : []),
    ...add.map((i) =>
      prisma.solarDealAdder.create({
        data: {
          companyId: g.user.companyId,
          leadId,
          ...lineFromCatalogue(i, lenderRules),
          qty: 1,
          sortOrder: ++sortOrder,
        },
      })
    ),
  ]);

  /**
   * The picker is also how a rep changes their mind about a size-triggered
   * adder, so it maintains the opt-out list on both sides: unticking one
   * records that this deal does not want it, and ticking it again forgets that.
   * Without the second half, re-adding an adder by hand would be undone by the
   * next recompute — the same dead button, from the other direction.
   */
  const autoOff = existing
    .filter((l) => l.autoApplied && !wanted.includes(l.equipmentId!))
    .map((l) => l.equipmentId!);
  if (autoOff.length) await rememberOptOut(leadId, autoOff, "add");
  if (wanted.length) await rememberOptOut(leadId, wanted, "remove");

  const totalCents = await adderGrandTotal(g.user.companyId, leadId);
  revalidateDeal(leadId);
  return { ok: true as const, totalCents, added: add.length, removed: drop.length };
}

/**
 * Record — or forget — that this deal does not want a size-triggered adder.
 *
 * Kept on the design as a JSON array of catalogue ids rather than as a table:
 * it is a list of at most a handful of ids, read only by the auto-apply rule,
 * and a join table for it would be three files of machinery for a preference.
 *
 * Not exported: `"use server"` requires every export here to be an async server
 * action, and this is a helper the browser has no business calling.
 */
async function rememberOptOut(leadId: string, ids: string[], mode: "add" | "remove") {
  const design = await prisma.solarDesign.findUnique({
    where: { leadId },
    select: { autoAdderOptOut: true },
  });
  if (!design) return;
  const current = new Set(parseOptOut(design.autoAdderOptOut));
  const before = current.size;
  for (const id of ids) {
    if (mode === "add") current.add(id);
    else current.delete(id);
  }
  if (current.size === before) return;
  await prisma.solarDesign.update({
    where: { leadId },
    data: { autoAdderOptOut: [...current] },
  });
}
