import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { NOT_CANCELLED } from "../cancelled";

/**
 * NOT_CANCELLED against real Postgres.
 *
 * The predicate is a `where` fragment, so asserting its SHAPE in a unit test
 * would prove nothing — the only question worth answering is which rows come
 * back. Three of them matter and they are all here:
 *
 *  - a deal in a lost stage is gone, which is the feature;
 *  - a deal in a live stage stays, which is the thing not to break;
 *  - a deal with NO STAGE AT ALL stays. That is the one a negated nullable
 *    relation gets wrong, and it is not hypothetical: a lead created before a
 *    pipeline exists, or by an import, has a null stageId, and treating it as
 *    cancelled would hide brand-new leads from the list they are created for.
 *
 * The fourth case is the reason this keys on the stage rather than
 * `Lead.status`: dragging a card into the Cancelled column goes through
 * `moveLeadStage`, which leaves `status` at "open" on purpose. A status-based
 * filter would leave that deal on the list — and that is exactly the deal a
 * user has just told the app is dead.
 */

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  const company = await db.company.create({
    data: { name: "Cancelled Co", slug: `cx-${process.pid}-${Date.now()}` },
  });
  companyId = company.id;

  const pipeline = await db.pipeline.create({
    data: { companyId, name: "Roofing", vertical: "roofing" },
  });
  const live = await db.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "new", name: "New Appointment", position: 1 },
  });
  const lost = await db.pipelineStage.create({
    data: {
      pipelineId: pipeline.id,
      key: "cancelled",
      name: "Cancelled",
      position: 2,
      isLost: true,
    },
  });

  const lead = async (name: string, stageId: string | null, status: "open" | "lost" = "open") =>
    (
      await db.lead.create({
        data: {
          companyId,
          vertical: "roofing",
          pipelineId: pipeline.id,
          stageId,
          status,
          firstName: name,
          lastName: "Lead",
        },
      })
    ).id;

  ids.live = await lead("Live", live.id);
  ids.stageless = await lead("Stageless", null);
  // Cancelled via the Cancel button: stage AND status both moved.
  ids.cancelled = await lead("Cancelled", lost.id, "lost");
  // Cancelled by DRAGGING the card on the Pipeline board: stage moved, status
  // deliberately left alone by moveLeadStage.
  ids.dragged = await lead("Dragged", lost.id, "open");
});

afterAll(async () => {
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

describe("NOT_CANCELLED", () => {
  const found = async () =>
    new Set(
      (
        await db.lead.findMany({
          where: { AND: [{ companyId }, NOT_CANCELLED] },
          select: { id: true },
        })
      ).map((l) => l.id)
    );

  it("keeps a deal in a live stage", async () => {
    expect((await found()).has(ids.live)).toBe(true);
  });

  it("keeps a deal with no stage at all", async () => {
    expect((await found()).has(ids.stageless)).toBe(true);
  });

  it("drops a deal cancelled through the Cancel button", async () => {
    expect((await found()).has(ids.cancelled)).toBe(false);
  });

  it("drops a deal DRAGGED into the lost stage, whose status is still open", async () => {
    expect((await found()).has(ids.dragged)).toBe(false);
    // Proving the point: filtering on status alone would have kept this one.
    const byStatus = await db.lead.findMany({
      where: { companyId, status: { not: "lost" } },
      select: { id: true },
    });
    expect(byStatus.map((l) => l.id)).toContain(ids.dragged);
  });

  it("returns exactly the two live deals and nothing else", async () => {
    expect(await found()).toEqual(new Set([ids.live, ids.stageless]));
  });
});
