import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";

/**
 * What a partner calls the equipment we call something else, and the one way
 * it can be lost.
 *
 * The name lives on `SolarEquipmentLender` — the row that already says this
 * partner approves this item — because two correct catalogues disagree: ours
 * names a SKU and carries the wattage the designer sizes from, theirs names a
 * product family. Sending ours is a 422 `unknown_equipment` in front of a
 * homeowner.
 *
 * THE TRAP THESE TESTS EXIST FOR. Approvals are written from the equipment
 * screen, and that action used to `deleteMany` every row for an item and write
 * the ticked set back. That is the same thing when the row holds nothing but a
 * tick, and it stopped being the same thing the moment the row also held a
 * name: re-saving a panel — even WITHOUT touching a tick — silently threw the
 * mapping away, and the next deal on that panel bounced with nothing on any
 * screen to explain it.
 *
 * Against a real database, because the whole behaviour is which rows survive a
 * write, which no type can express.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setEquipmentLendersAction } = await import("../actions");
const { setLenderEquipmentNamesAction } = await import("../amos-actions");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let amosId: string;
let otherId: string;
let panelId: string;

const names = (equipmentId: string, lenderId: string) =>
  db.solarEquipmentLender.findUnique({
    where: { equipmentId_lenderId: { equipmentId, lenderId } },
    select: { lenderBrand: true, lenderModel: true },
  });

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Lender Names Co", slug: `lnc-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const amos = await db.solarLender.create({ data: { companyId, name: "Amos Capital Fund" } });
  const other = await db.solarLender.create({ data: { companyId, name: "Climate First" } });
  amosId = amos.id;
  otherId = other.id;
});

beforeEach(async () => {
  session.requireUser.mockReset().mockResolvedValue({
    id: "u1",
    companyId,
    role: "super_admin",
    permissions: null,
  });
  await db.solarEquipment.deleteMany({ where: { companyId } });
  const panel = await db.solarEquipment.create({
    data: {
      companyId,
      kind: "module",
      manufacturer: "Silfab",
      model: "SIL440-QD-DCA2",
      ratingW: 440,
    },
  });
  panelId = panel.id;
  await db.solarEquipmentLender.createMany({
    data: [
      { equipmentId: panelId, lenderId: amosId },
      { equipmentId: panelId, lenderId: otherId },
    ],
  });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("a partner's own name for an item", () => {
  it("is stored on the approval row, per partner", async () => {
    await runInVertical("solar", () =>
      setLenderEquipmentNamesAction(amosId, [
        { equipmentId: panelId, lenderBrand: "Silfab", lenderModel: "PRIME DCA2 (SIL440QD-DCA2)" },
      ]),
    );

    expect(await names(panelId, amosId)).toEqual({
      lenderBrand: "Silfab",
      lenderModel: "PRIME DCA2 (SIL440QD-DCA2)",
    });
    // The other partner has its own row and its own answer, which is none.
    expect(await names(panelId, otherId)).toEqual({ lenderBrand: null, lenderModel: null });
  });

  it("SURVIVES a re-save of the approvals that did not change a tick", async () => {
    await runInVertical("solar", () =>
      setLenderEquipmentNamesAction(amosId, [
        { equipmentId: panelId, lenderBrand: "Silfab", lenderModel: "PRIME DCA2 (SIL440QD-DCA2)" },
      ]),
    );

    // Exactly what pressing Save on the equipment screen does.
    await runInVertical("solar", () => setEquipmentLendersAction(panelId, [amosId, otherId]));

    expect(await names(panelId, amosId)).toEqual({
      lenderBrand: "Silfab",
      lenderModel: "PRIME DCA2 (SIL440QD-DCA2)",
    });
  });

  it("survives ANOTHER lender being ticked on alongside it", async () => {
    await runInVertical("solar", () =>
      setLenderEquipmentNamesAction(amosId, [
        { equipmentId: panelId, lenderBrand: "Silfab", lenderModel: "PRIME DCA2 (SIL440QD-DCA2)" },
      ]),
    );
    await runInVertical("solar", () => setEquipmentLendersAction(panelId, [amosId]));
    await runInVertical("solar", () => setEquipmentLendersAction(panelId, [amosId, otherId]));

    expect((await names(panelId, amosId))?.lenderModel).toBe("PRIME DCA2 (SIL440QD-DCA2)");
  });

  /**
   * The one case where losing it is correct: the partner no longer approves
   * the item, so there is no relationship left for a name to be about.
   */
  it("goes with the approval when the item is unticked", async () => {
    await runInVertical("solar", () =>
      setLenderEquipmentNamesAction(amosId, [
        { equipmentId: panelId, lenderBrand: "Silfab", lenderModel: "PRIME DCA2 (SIL440QD-DCA2)" },
      ]),
    );
    await runInVertical("solar", () => setEquipmentLendersAction(panelId, [otherId]));

    expect(await names(panelId, amosId)).toBeNull();
  });

  it("cannot be written for an item the partner does not approve", async () => {
    const unapproved = await db.solarEquipment.create({
      data: { companyId, kind: "module", manufacturer: "Sirius", model: "ELNSM54M-450", ratingW: 450 },
    });

    await runInVertical("solar", () =>
      setLenderEquipmentNamesAction(amosId, [
        { equipmentId: unapproved.id, lenderBrand: "Sirius", lenderModel: "Whatever" },
      ]),
    );

    // No row was invented, so no approval was granted as a side effect.
    expect(await names(unapproved.id, amosId)).toBeNull();
  });
});
