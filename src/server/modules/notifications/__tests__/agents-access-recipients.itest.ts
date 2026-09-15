import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient, type Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { fireEvent } from "../engine";

/**
 * Who hears that an agent run failed: the owner, admins, and the managers who
 * hold the Agents access switch — read when the alert fires, so switching
 * someone off stops the very next one. A sales manager without the switch, and
 * a rep with a stale override, hear nothing.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const SWITCH = { "Agent:read": true, "Agent:run": true, "Agent:approve": true };

let companyId = "";
const ids: Record<string, string> = {};

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Agent Alerts Co", slug: `agent-alerts-${process.pid}-${Date.now()}` } })).id;
  const people: [string, Role, Record<string, boolean>][] = [
    ["owner", "super_admin", {}],
    ["admin", "admin", {}],
    ["coordinator", "manager", SWITCH],
    ["salesManager", "manager", {}],
    ["rep", "sales_rep", SWITCH],
    ["accounting", "accounting", {}],
  ];
  for (const [key, role, permissions] of people) {
    ids[key] = (
      await db.user.create({
        data: { companyId, email: `${key}-${process.pid}@agent-alerts.test`, firstName: key, lastName: "Test", role, status: "active", passwordHash: "x", permissions },
      })
    ).id;
  }
  await db.notificationRule.create({
    data: {
      companyId,
      vertical: "roofing",
      name: "Agent failed",
      event: "agent_run_failed",
      recipients: { roles: ["super_admin", "admin"], userIds: [], dynamic: ["agents_access"] },
      channels: ["in_app"],
      titleTemplate: "Agent failed: {{agent}}",
      bodyTemplate: "{{status}}",
    },
  });
});

beforeEach(async () => {
  await db.notification.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await db.notification.deleteMany({ where: { companyId } });
  await db.notificationRule.deleteMany({ where: { companyId } });
  await db.user.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

const fire = () =>
  fireEvent({
    companyId,
    event: "agent_run_failed",
    agentName: "NTP Poller",
    status: 'No handler is registered for "bank.ntp_poll". Deploy the handler or disable this agent.',
  });

describe("agent_run_failed recipients", () => {
  it("reaches the owner, admins and managers with the Agents access switch, and nobody else", async () => {
    await runInVertical("roofing", fire);
    const rows = await db.notification.findMany({ where: { companyId }, select: { userId: true, title: true, body: true, link: true } });
    expect(rows.map((r) => r.userId).sort()).toEqual([ids.owner, ids.admin, ids.coordinator].sort());
    expect(rows[0]).toMatchObject({ title: "Agent failed: NTP Poller", link: "/portal/agents/runs" });
    // Passed through untouched: the handler key keeps its underscore.
    expect(rows[0].body).toContain('"bank.ntp_poll"');
  });

  it("stops reaching a manager the moment the switch is off", async () => {
    await db.user.update({ where: { id: ids.coordinator }, data: { permissions: {} } });
    await runInVertical("roofing", fire);
    const rows = await db.notification.findMany({ where: { companyId }, select: { userId: true } });
    expect(rows.map((r) => r.userId)).not.toContain(ids.coordinator);
    await db.user.update({ where: { id: ids.coordinator }, data: { permissions: SWITCH } });
  });

  it("notifies nobody, silently, when fired outside a workspace — which is why notify.ts wraps it", async () => {
    await fire();
    expect(await db.notification.count({ where: { companyId } })).toBe(0);
  });
});
