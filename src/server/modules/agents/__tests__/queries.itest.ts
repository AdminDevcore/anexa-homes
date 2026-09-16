import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, type AgentDepartment, type AgentRunStatus, type Prisma, type Vertical } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { countNeedsHuman, getAgent, listAgents, listRunsFeed, listRunsForAgent, needsHumanQueue, type Viewer } from "../queries";

/**
 * Agent and AgentRun are shared models, so the pages' workspace boundary lives
 * in these queries and nowhere else. Every case here is a line of that boundary.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId = "";
let otherId = "";
const agents: Record<string, string> = {};

const owner = (): Viewer => ({ companyId, role: "super_admin", verticals: [] });
const roofingAdmin = (): Viewer => ({ companyId, role: "admin", verticals: ["roofing"] });

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Queries Co", slug: `queries-${process.pid}-${Date.now()}` } })).id;
  otherId = (await db.company.create({ data: { name: "Other Queries Co", slug: `queries-other-${process.pid}-${Date.now()}` } })).id;

  const mk = async (name: string, cid: string, vertical: Vertical | null, department: AgentDepartment) => {
    agents[name] = (await db.agent.create({ data: { companyId: cid, name, handlerKey: "system.hello", vertical, department } })).id;
  };
  await mk("Roofing Poller", companyId, "roofing", "permit");
  await mk("Solar Poller", companyId, "solar", "operations");
  await mk("Both Poller", companyId, null, "operations");
  await mk("Elsewhere", otherId, null, "operations");

  const run = (name: string, cid: string, vertical: Vertical, status: AgentRunStatus, extra: Partial<Prisma.AgentRunUncheckedCreateInput> = {}) =>
    db.agentRun.create({ data: { companyId: cid, agentId: agents[name], vertical, trigger: "scheduled", status, summary: `${name} ${vertical} ${status}`, ...extra } });
  await run("Roofing Poller", companyId, "roofing", "success");
  await run("Solar Poller", companyId, "solar", "failed");
  await run("Both Poller", companyId, "roofing", "needs_human");
  // Explicitly newer than the roofing run above, not merely inserted after it:
  // the vertical-filter test below depends on there being no doubt which run
  // is more recent.
  await run("Both Poller", companyId, "solar", "needs_human", {
    resolvedAt: new Date(),
    resolution: "closed",
    resolutionNote: "fine",
    createdAt: new Date(Date.now() + 60_000),
  });
  await run("Elsewhere", otherId, "roofing", "needs_human");
});

afterAll(async () => {
  await db.agentRun.deleteMany({ where: { companyId: { in: [companyId, otherId] } } });
  await db.agent.deleteMany({ where: { companyId: { in: [companyId, otherId] } } });
  await db.company.deleteMany({ where: { id: { in: [companyId, otherId] } } });
  await db.$disconnect();
});

const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe("agents pages queries", () => {
  it("lists this company's agents only, each with its last run", async () => {
    const rows = await listAgents(owner(), { product: null, department: null });
    expect(names(rows)).toEqual(["Both Poller", "Roofing Poller", "Solar Poller"]);
    expect(rows.find((r) => r.name === "Solar Poller")?.lastRun?.status).toBe("failed");
    expect(rows.every((r) => !r.handlerMissing)).toBe(true);
  });

  it("filters by product — Roofing includes Both — and by department", async () => {
    expect(names(await listAgents(owner(), { product: "roofing", department: null }))).toEqual(["Both Poller", "Roofing Poller"]);
    expect(names(await listAgents(owner(), { product: "both", department: null }))).toEqual(["Both Poller"]);
    expect(names(await listAgents(owner(), { product: null, department: "permit" }))).toEqual(["Roofing Poller"]);
  });

  it("hides a workspace the viewer does not hold, and another company entirely", async () => {
    expect(names(await listAgents(roofingAdmin(), { product: null, department: null }))).toEqual(["Both Poller", "Roofing Poller"]);
    expect(await getAgent(roofingAdmin(), agents["Solar Poller"])).toBeNull();
    expect(await getAgent(owner(), agents["Elsewhere"])).toBeNull();
    expect((await getAgent(owner(), agents["Both Poller"]))?.form.product).toBe("both");
    const feed = await listRunsFeed(roofingAdmin(), { status: null, product: null, page: 1 });
    expect(feed.runs.map((r) => r.vertical)).toEqual(["roofing", "roofing"]);
  });

  it("filters the feed by status and by product", async () => {
    const failed = await listRunsFeed(owner(), { status: "failed", product: null, page: 1 });
    expect(failed.runs.map((r) => r.summary)).toEqual(["Solar Poller solar failed"]);
    const solar = await listRunsFeed(owner(), { status: null, product: "solar", page: 1 });
    expect(solar.total).toBe(2);
    expect(solar.runs.every((r) => r.vertical === "solar")).toBe(true);
  });

  it("queues only this company's unresolved needs-a-human runs", async () => {
    const queue = await needsHumanQueue(owner());
    expect(queue.map((r) => r.summary)).toEqual(["Both Poller roofing needs_human"]);
    expect(queue[0]).toMatchObject({ agentName: "Both Poller", resolution: null });
    expect(await countNeedsHuman(owner())).toBe(1);
  });

  it("filters a Both agent's last run to the viewer's held verticals, not merely the newest run overall", async () => {
    const roofingRun = await db.agentRun.findFirst({
      where: { agentId: agents["Both Poller"], vertical: "roofing" },
      select: { createdAt: true },
    });
    const solarRun = await db.agentRun.findFirst({
      where: { agentId: agents["Both Poller"], vertical: "solar" },
      select: { createdAt: true },
    });
    // The fixture: this really is the newer run, so a filter-less "most
    // recent" lookup would pick it — which is exactly the bug this proves
    // doesn't happen for a viewer who does not hold Solar.
    expect(solarRun!.createdAt.getTime()).toBeGreaterThan(roofingRun!.createdAt.getTime());

    const rows = await listAgents(roofingAdmin(), { product: null, department: null });
    const both = rows.find((r) => r.name === "Both Poller");
    expect(both?.lastRun?.createdAt.getTime()).toBe(roofingRun!.createdAt.getTime());
  });

  it("lists one agent's own runs, scoped to the viewer's workspaces", async () => {
    const both = await listRunsForAgent(owner(), agents["Both Poller"], 1);
    expect(both.total).toBe(2);
    // Newest first: the solar run is the one stamped 60s ahead in the fixture.
    expect(both.runs.map((r) => r.vertical)).toEqual(["solar", "roofing"]);

    const scoped = await listRunsForAgent(roofingAdmin(), agents["Both Poller"], 1);
    expect(scoped.runs.map((r) => r.vertical)).toEqual(["roofing"]);
  });

  it("clamps a page number past the end instead of erroring or returning nonsense", async () => {
    const feed = await listRunsFeed(owner(), { status: null, product: null, page: 99 });
    expect(feed.pageCount).toBe(1);
    expect(feed.page).toBe(1);
    expect(feed.runs.length).toBe(4);
  });
});
