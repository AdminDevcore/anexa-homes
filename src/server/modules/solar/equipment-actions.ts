"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { leadAccessible } from "@/server/rbac/lead-access";
import { checkSignedLock } from "./signed-lock";
import { recomputeDesignFigures } from "./recompute";
import { DEFAULT_BATTERY_QTY } from "./settings";

/**
 * Choosing what this system is built from, on the screen where it is drawn.
 *
 * The module used to be unchooseable. It came only from the catalogue's starred
 * default, on the reasoning that a rep sells a system and the approved-vendor
 * list decides the hardware — which is true, and which quietly assumed somebody
 * had starred one. A company with fifty modules and no default had no way to
 * put a panel on a design at all, so the system size, the production and the
 * offset all sat at zero with a warning pointing at Settings.
 *
 * So the default is now the FALLBACK it was always meant to be, and the deal
 * can name its own. Which is also where the choice belongs: the panel decides
 * how many fit on the roof and what each one is worth, and both of those are
 * questions you are looking at while you draw.
 *
 * Changing the module re-derives every figure that depends on it — see
 * `recomputeDesignFigures`. Nothing a rep typed is touched.
 */

const fail = (error: string) => ({ ok: false as const, error });

const schema = z.object({
  leadId: z.string().min(1),
  /** Undefined leaves a slot alone; null clears it. */
  moduleId: z.string().min(1).nullish(),
  inverterId: z.string().min(1).nullish(),
  batteryId: z.string().min(1).nullish(),
  /**
   * How many of that battery are going on the house.
   *
   * Undefined leaves it alone, EXCEPT on the pick that puts a battery on an
   * empty slot — that one starts at the company's standard quantity, from
   * Settings → Solar. Every reader defaults a missing count to one, including
   * the battery programme which multiplies its money by it, so a design that
   * never picked up a count quoted and earned for a single unit.
   */
  batteryQty: z.number().int().min(1).max(20).optional(),
  /**
   * Hand the count back to auto-sizing.
   *
   * The way OUT of an override. `batteryQty` says "a person decided this" and
   * latches the count against the sizing rule; without a way to unsay it, one
   * stray click on the stepper would keep a deal on a hand-set count for the
   * rest of its life, and the only remedy would be switching the company's
   * whole sizing rule off. Writes no count of its own — the recompute at the
   * end of this action works out the right one.
   */
  batteryQtyAuto: z.boolean().optional(),
});

export async function setSolarDesignEquipmentAction(input: z.infer<typeof schema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail("That equipment could not be read.");
  const { leadId, moduleId, inverterId, batteryId, batteryQty, batteryQtyAuto } = parsed.data;

  const lead = await leadAccessible(user, leadId);
  if (!lead) return fail("Deal not found.");
  if (lead.vertical !== "solar") return fail("This is not a solar deal.");

  // Panel count, inverter and battery quantity are all contract economics.
  const lock = await checkSignedLock(user, lead.id, "the system equipment");
  if (lock.blocked) return fail(lock.error);

  // Every id has to be OUR catalogue, and the right kind of thing. Passing a
  // battery id into the module slot would size the system off a kWh figure.
  const checks: [string | null | undefined, "module" | "inverter" | "battery"][] = [
    [moduleId, "module"],
    [inverterId, "inverter"],
    [batteryId, "battery"],
  ];
  for (const [id, kind] of checks) {
    if (!id) continue;
    const found = await prisma.solarEquipment.findFirst({
      where: { id, companyId: user.companyId, kind },
      select: { id: true },
    });
    if (!found) return fail(`That ${kind} is not in your catalogue.`);
  }

  /**
   * A battery landing on a design that had none arrives at the company's
   * standard quantity.
   *
   * The count used to start at zero and every reader downstream turned that
   * into ONE, so a company selling two batteries as its standard offer quoted
   * the second one for free and earned the battery programme's money on one of
   * them — unless a rep noticed the small quantity box beside the picker, which
   * only appears after the battery is chosen.
   *
   * Applied ONLY to a design with nothing in the battery slot. Swapping a
   * chosen battery for a different model keeps whatever the rep set: a default
   * that overwrites a deliberate decision is not a default. And an explicit
   * count in this call always wins — that IS the rep deciding.
   */
  let startingQty: number | undefined;
  /**
   * Whether this call hands the count back to the sizing rule.
   *
   * Swapping the BATTERY does, and that is the interesting case. A rep who set
   * four of one manufacturer's units has said something about that product —
   * four of somebody else's, with a different capacity, is not what they
   * decided, and honouring the number would leave the new battery quoted at a
   * count nobody chose for it. So a product change re-arms auto-sizing, and the
   * recompute at the end of this action works the count out afresh.
   */
  let unlatch = batteryQtyAuto === true;
  if (batteryQty === undefined && typeof batteryId === "string") {
    const current = await prisma.solarDesign.findUnique({
      where: { leadId },
      select: { batteryId: true, batteryQty: true },
    });
    if (current?.batteryId && current.batteryId !== batteryId) unlatch = true;
    const hadOne = !!current?.batteryId && (current?.batteryQty ?? 0) > 0;
    if (!hadOne) {
      const settings = await prisma.solarSettings.findUnique({
        where: { companyId: user.companyId },
        select: { defaultBatteryQty: true },
      });
      startingQty = Math.max(1, settings?.defaultBatteryQty ?? DEFAULT_BATTERY_QTY);
    }
  }

  // Upsert, because choosing a panel is a perfectly reasonable first thing to
  // do on a deal that has no design row yet.
  const data = {
    ...(moduleId !== undefined ? { moduleId } : {}),
    ...(inverterId !== undefined ? { inverterId } : {}),
    ...(batteryId !== undefined ? { batteryId } : {}),
    ...(batteryQty !== undefined ? { batteryQty } : {}),
    ...(startingQty !== undefined ? { batteryQty: startingQty } : {}),
    // Taking the battery off the design takes its count with it. A count left
    // behind on a slot with nothing in it is the sort of thing that comes back
    // as "two batteries" the next time somebody picks one.
    ...(batteryId === null ? { batteryQty: 0, batteryQtySetByRep: false } : {}),
    /**
     * A typed count is a person's decision, and it survives from here on.
     *
     * Only where the count came in EXPLICITLY. `startingQty` is the company's
     * own default landing on an empty slot — nobody chose it for this house, so
     * it must not latch, or turning sizing on would find every deal in the
     * pipeline already claiming to have been set by hand.
     */
    ...(batteryQty !== undefined ? { batteryQtySetByRep: true } : {}),
    ...(unlatch ? { batteryQtySetByRep: false } : {}),
  };
  const saved = await prisma.solarDesign.upsert({
    where: { leadId },
    create: { companyId: user.companyId, leadId, ...data },
    update: data,
    select: { batteryQty: true, batteryQtySetByRep: true },
  });

  // The panel decides what every panel on the roof is worth, so the size, the
  // production and the offset all follow from it.
  const figures = await recomputeDesignFigures(user.companyId, leadId);

  revalidatePath(`/portal/leads/${leadId}`);
  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
  revalidatePath(`/portal/leads/${leadId}/solar-proposal/design`);
  /**
   * The count comes back so the screen can show what was actually written
   * rather than the "1" it would otherwise display until the refresh lands.
   *
   * AFTER the recompute, not before it. Putting a battery on an empty slot
   * writes the company's flat count and the recompute then sizes it to the
   * home a moment later — returning the flat one would flash two on the
   * screen and settle on three, which reads as a bug whichever is right.
   * Null — no sizing, or no recompute at all on a design that has not landed
   * yet — falls back to what was written, which is then the answer.
   */
  return {
    ok: true as const,
    figures,
    batteryQty: figures?.battery?.qty ?? saved.batteryQty,
    // Whether the count on this deal is now a person's, so the screen can say
    // so — and offer the way back — without waiting for a refresh.
    batteryQtySetByRep: saved.batteryQtySetByRep,
  };
}
