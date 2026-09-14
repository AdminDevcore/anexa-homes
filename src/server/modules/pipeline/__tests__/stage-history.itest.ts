import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { recordStageEntry } from "../stage-history";
import { buildTimeline } from "@/lib/stage-history";

/**
 * The stage-history recorder against a real database.
 *
 * The properties that matter are all about NOT corrupting the record: exactly
 * one open span per lead, no duplicate span when a save doesn't move the deal,
 * and a name that survives the stage being renamed underneath it.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let pipelineId: string;
let userId: string;
const stages: Record<string, string> = {};

const STAGE_NAMES = ["New Appointment", "Contract Signed", "Install Complete"];

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Cycle Time Co", slug: `cyc-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const u = await db.user.create({
    data: {
      companyId, email: `mover-${process.pid}-${Date.now()}@example.com`, passwordHash: "x",
      firstName: "Mo", lastName: "Ver", role: "sales_rep",
    },
  });
  userId = u.id;
  const p = await db.pipeline.create({ data: { companyId, name: "P", vertical: "solar" } });
  pipelineId = p.id;
  for (const [i, name] of STAGE_NAMES.entries()) {
    const s = await db.pipelineStage.create({
      data: { pipelineId, key: `s${i}`, name, position: i },
    });
    stages[name] = s.id;
  }
});

afterAll(async () => {
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId } } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.user.deleteMany({ where: { companyId } });
  await db.pipelineStage.deleteMany({ where: { pipelineId } });
  await db.pipeline.delete({ where: { id: pipelineId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

let leadId: string;
beforeEach(async () => {
  const lead = await db.lead.create({
    data: { companyId, vertical: "solar", pipelineId, stageId: stages["New Appointment"], firstName: "N", lastName: "T" },
  });
  leadId = lead.id;
});

async function events() {
  return db.leadStageEvent.findMany({ where: { leadId }, orderBy: { enteredAt: "asc" } });
}

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

describe("recordStageEntry", () => {
  it("opens a span and closes it when the deal moves on", async () => {
    await recordStageEntry({ leadId, stageId: stages["New Appointment"], at: day(1) }, db);
    await recordStageEntry({ leadId, stageId: stages["Contract Signed"], at: day(4) }, db);

    const rows = await events();
    expect(rows).toHaveLength(2);
    expect(rows[0].stageName).toBe("New Appointment");
    expect(rows[0].exitedAt).toEqual(day(4));
    expect(rows[1].stageName).toBe("Contract Signed");
    expect(rows[1].exitedAt).toBeNull();
  });

  it("leaves exactly one span open, whatever the sequence", async () => {
    for (const [i, name] of STAGE_NAMES.entries()) {
      await recordStageEntry({ leadId, stageId: stages[name], at: day(i + 1) }, db);
    }
    const open = (await events()).filter((r) => r.exitedAt === null);
    expect(open).toHaveLength(1);
    expect(open[0].stageName).toBe("Install Complete");
  });

  it("ignores a repeat entry into the stage the deal is already in", async () => {
    await recordStageEntry({ leadId, stageId: stages["New Appointment"], at: day(1) }, db);
    await recordStageEntry({ leadId, stageId: stages["New Appointment"], at: day(3) }, db);
    await recordStageEntry({ leadId, stageId: stages["New Appointment"], at: day(9) }, db);

    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0].enteredAt).toEqual(day(1)); // the clock never restarted
  });

  it("records a re-entry after the deal moved away and came back", async () => {
    await recordStageEntry({ leadId, stageId: stages["Contract Signed"], at: day(1) }, db);
    await recordStageEntry({ leadId, stageId: stages["Install Complete"], at: day(3) }, db);
    await recordStageEntry({ leadId, stageId: stages["Contract Signed"], at: day(5) }, db);

    const rows = await events();
    expect(rows.map((r) => r.stageName)).toEqual([
      "Contract Signed",
      "Install Complete",
      "Contract Signed",
    ]);
  });

  it("keeps the name the stage had at the time, even after a rename", async () => {
    const temp = await db.pipelineStage.create({
      data: { pipelineId, key: "temp", name: "Permit Submitted", position: 9 },
    });
    await recordStageEntry({ leadId, stageId: temp.id, at: day(1) }, db);
    await db.pipelineStage.update({ where: { id: temp.id }, data: { name: "Permitting (AHJ)" } });

    const rows = await events();
    expect(rows[0].stageName).toBe("Permit Submitted");

    await db.leadStageEvent.deleteMany({ where: { stageId: temp.id } });
    await db.pipelineStage.delete({ where: { id: temp.id } });
  });

  it("never writes a span that closes before it opened", async () => {
    await recordStageEntry({ leadId, stageId: stages["New Appointment"], at: day(10) }, db);
    // A backdated write — a clock skew, a replayed job.
    await recordStageEntry({ leadId, stageId: stages["Contract Signed"], at: day(2) }, db);

    const rows = await events();
    expect(rows[0].exitedAt!.getTime()).toBeGreaterThanOrEqual(rows[0].enteredAt.getTime());
  });

  it("records who made each move, and what did when nobody did", async () => {
    await recordStageEntry({ leadId, stageId: stages["New Appointment"], at: day(1), movedById: userId }, db);
    await recordStageEntry({ leadId, stageId: stages["Contract Signed"], at: day(2), via: "signature" }, db);
    await recordStageEntry({ leadId, stageId: stages["Install Complete"], at: day(3), via: "automation" }, db);

    expect((await events()).map((r) => [r.stageName, r.movedById, r.via])).toEqual([
      ["New Appointment", userId, null],
      ["Contract Signed", null, "signature"],
      ["Install Complete", null, "automation"],
    ]);
  });

  it("keeps the original mover when a later write does not move the deal", async () => {
    await recordStageEntry({ leadId, stageId: stages["New Appointment"], at: day(1), movedById: userId }, db);
    await recordStageEntry({ leadId, stageId: stages["New Appointment"], at: day(2), via: "automation" }, db);

    const rows = await events();
    expect(rows).toHaveLength(1);
    expect([rows[0].movedById, rows[0].via]).toEqual([userId, null]);
  });

  it("does nothing for a lead with no stage", async () => {
    await recordStageEntry({ leadId, stageId: null, at: day(1) }, db);
    expect(await events()).toHaveLength(0);
  });

  it("feeds a timeline whose days match the calendar", async () => {
    await recordStageEntry({ leadId, stageId: stages["New Appointment"], at: day(1) }, db);
    await recordStageEntry({ leadId, stageId: stages["Contract Signed"], at: day(4) }, db);
    await recordStageEntry({ leadId, stageId: stages["Install Complete"], at: day(20) }, db);

    const rows = await events();
    const t = buildTimeline(
      rows.map((r) => ({
        id: r.id,
        stageId: r.stageId,
        stageName: r.stageName,
        position: r.position,
        enteredAt: r.enteredAt.toISOString(),
        exitedAt: r.exitedAt ? r.exitedAt.toISOString() : null,
      })),
      { createdAt: day(1).toISOString(), now: day(25) }
    );

    expect(t.rows.map((r) => r.days)).toEqual([3, 16, 5]);
    expect(t.completedAt).toBe(day(20).toISOString());
    expect(t.totalDays).toBe(19); // created Jan 1 → installed Jan 20
    expect(t.slowest?.stageName).toBe("Contract Signed");
  });
});
