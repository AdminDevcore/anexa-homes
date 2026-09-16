import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, type AgentDepartment, type AgentRunStatus, type Prisma, type Vertical } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { countNeedsHuman, getAgent, listAgents, listRunsFeed, needsHumanQueue, type Viewer } from "../queries";

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
  await run("Both Poller", companyId, "solar", "needs_human", { resolvedAt: new Date(), resolution: "closed", resolutionNote: "fine" });
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
});
