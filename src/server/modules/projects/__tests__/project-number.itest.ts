import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * Project numbers are unique per COMPANY, across every workspace.
 *
 * `Project` is a vertical-scoped model, so the obvious way to pick the next
 * number — count the company's projects — counts only the ones in the workspace
 * you happen to be standing in. On a company whose projects are all roofing,
 * that count is zero from the solar side, so the number generated is the first
 * one, which a roofing project has held since day one. Starting production on a
 * solar deal failed on the unique index EVERY time, and because the action
 * threw rather than returning an error, the button just span.
 *
 * These tests use an unscoped client on purpose: the point is what exists in
 * the table, not what one workspace can see.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;

/** The rule the action uses: highest number so far, plus one. */
function nextNumber(existing: string[]): number {
  return (
    existing.reduce((max, n) => {
      const m = n.match(/(\d+)\s*$/);
      const v = m ? Number(m[1]) : 0;
      return Number.isFinite(v) && v > max ? v : max;
    }, 1000) + 1
  );
}

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Numbering Co", slug: `num-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
});

afterAll(async () => {
  await db.project.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

async function makeLead(vertical: "roofing" | "solar") {
  const pipe = await db.pipeline.create({
    data: { companyId, name: `P-${vertical}-${Math.random()}`, vertical },
  });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipe.id, key: "new", name: "New", position: 1 },
  });
  return db.lead.create({
    data: { companyId, vertical, pipelineId: pipe.id, stageId: stage.id, firstName: "N", lastName: "Test" },
  });
}

async function startProduction(leadId: string, vertical: "roofing" | "solar") {
  const rows = await db.project.findMany({ where: { companyId }, select: { projectNumber: true } });
  return db.project.create({
    data: {
      companyId,
      vertical,
      leadId,
      projectNumber: `AH-${nextNumber(rows.map((r) => r.projectNumber))}`,
      status: "not_started",
    },
    select: { projectNumber: true },
  });
}

describe("starting production numbers the job", () => {
  it("does not reuse a roofing number when the deal is solar", async () => {
    const roofing = await makeLead("roofing");
    const first = await startProduction(roofing.id, "roofing");
    expect(first.projectNumber).toBe("AH-1001");

    // The case that used to fail: a solar deal on a company whose only
    // projects are roofing.
    const solar = await makeLead("solar");
    const second = await startProduction(solar.id, "solar");
    expect(second.projectNumber).toBe("AH-1002");
  });

  it("keeps going up across both workspaces", async () => {
    const numbers: string[] = [];
    for (const v of ["solar", "roofing", "solar"] as const) {
      const lead = await makeLead(v);
      numbers.push((await startProduction(lead.id, v)).projectNumber);
    }
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual(["AH-1003", "AH-1004", "AH-1005"]);
  });

  /**
   * A GAP is never reused, which is the case that matters.
   *
   * Highest-so-far does mean the very top number becomes free again if that job
   * disappears. Nothing in the app can do that: there is no delete-project
   * action, and a Project only goes when its whole deal is cascaded away — at
   * which point the number is on nothing. A counter that never goes backwards
   * would close it, and would be storage bought for a case the UI cannot
   * produce, so this pins the real rule rather than claiming a stronger one.
   */
  it("never reuses a number from a gap in the middle", async () => {
    const middle = await makeLead("roofing");
    const gap = await startProduction(middle.id, "roofing");

    const above = await makeLead("solar");
    const higher = await startProduction(above.id, "solar");
    expect(Number(higher.projectNumber.slice(3))).toBeGreaterThan(Number(gap.projectNumber.slice(3)));

    // Remove the middle one, the way a cascaded deal deletion would.
    await db.project.delete({ where: { leadId: middle.id } });

    const next = await makeLead("solar");
    const after = await startProduction(next.id, "solar");
    expect(after.projectNumber).not.toBe(gap.projectNumber);
    expect(Number(after.projectNumber.slice(3))).toBeGreaterThan(Number(higher.projectNumber.slice(3)));
  });

  it("the unique index is real — the same number twice is refused", async () => {
    const a = await makeLead("solar");
    const taken = await startProduction(a.id, "solar");
    const b = await makeLead("roofing");
    await expect(
      db.project.create({
        data: {
          companyId,
          vertical: "roofing",
          leadId: b.id,
          projectNumber: taken.projectNumber,
          status: "not_started",
        },
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
