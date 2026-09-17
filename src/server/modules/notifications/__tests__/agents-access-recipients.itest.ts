import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient, type Role, type UserStatus } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { fireEvent } from "../engine";

/**
 * Who hears that an agent run failed: the owner, admins, and the managers who
 * hold the Agents access switch — read when the alert fires, so switching
 * someone off stops the very next one. A sales manager without the switch, and
 * a rep with a stale override, hear nothing. Nor does a manager who holds the
 * switch but is inactive, nor one whose override wrote the JSON string "true"
 * instead of the boolean.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const SWITCH = { "Agent:read": true, "Agent:run": true, "Agent:approve": true };

let companyId = "";
const ids: Record<string, string> = {};

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Agent Alerts Co", slug: `agent-alerts-${process.pid}-${Date.now()}` } })).id;
  const people: [string, Role, Record<string, boolean | string>, UserStatus][] = [
    ["owner", "super_admin", {}, "active"],
    ["admin", "admin", {}, "active"],
    ["coordinator", "manager", SWITCH, "active"],
    ["salesManager", "manager", {}, "active"],
    ["rep", "sales_rep", SWITCH, "active"],
    ["accounting", "accounting", {}, "active"],
    // Holds the switch, but the recipient query requires status: "active" — must
    // never be a recipient.
    ["inactiveCoordinator", "manager", SWITCH, "suspended"],
    // Agent:approve is the JSON STRING "true", not the boolean. The Prisma path
    // filter (`equals: true`) only matches the boolean — must never be a recipient.
    ["stringSwitchCoordinator", "manager", { "Agent:approve": "true" }, "active"],
  ];
  for (const [key, role, permissions, status] of people) {
    ids[key] = (
      await db.user.create({
        data: { companyId, email: `${key}-${process.pid}@agent-alerts.test`, firstName: key, lastName: "Test", role, status, passwordHash: "x", permissions },
      })
    ).id;
  }
  const recipients = { roles: ["super_admin", "admin"], userIds: [], dynamic: ["agents_access"] };
  await db.notificationRule.create({
    data: {
      companyId,
      vertical: "roofing",
      name: "Agent failed",
      event: "agent_run_failed",
      recipients,
      channels: ["in_app"],
      titleTemplate: "Agent failed: {{agent}}",
      bodyTemplate: "{{status}}",
    },
  });
  // Same rule, scoped to Solar: NotificationRule is vertical-isolated, so the
  // Roofing rule above is invisible while firing inside the Solar workspace.
  await db.notificationRule.create({
    data: {
      companyId,
      vertical: "solar",
      name: "Agent failed (solar)",
      event: "agent_run_failed",
      recipients,
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
  await db.lead.deleteMany({ where: { companyId } });
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
    try {
      await runInVertical("roofing", fire);
      const rows = await db.notification.findMany({ where: { companyId }, select: { userId: true } });
      const recipientIds = rows.map((r) => r.userId);
      expect(recipientIds).not.toContain(ids.coordinator);
      // The switch going off for one manager must not take the owner and admin
      // down with it — otherwise this passes when the fire delivers to nobody.
      expect(recipientIds).toEqual(expect.arrayContaining([ids.owner, ids.admin]));
    } finally {
      // A failed assertion above must not leave the switch off for later cases.
      await db.user.update({ where: { id: ids.coordinator }, data: { permissions: SWITCH } });
    }
  });

  it("notifies nobody, silently, when fired outside a workspace — which is why notify.ts wraps it", async () => {
    await fire();
    expect(await db.notification.count({ where: { companyId } })).toBe(0);
  });
});

describe("agent-level vertical stamping (no deal to read a vertical off of)", () => {
  it("stamps the notification with the run's own vertical when there is no lead", async () => {
    await runInVertical("solar", () =>
      fireEvent({
        companyId,
        event: "agent_run_failed",
        vertical: "solar",
        agentName: "NTP Poller",
        status: "No handler is registered for \"bank.ntp_poll\".",
      })
    );
    const rows = await db.notification.findMany({ where: { companyId }, select: { vertical: true } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.vertical).toBe("solar");
  });

  it("lets a roofing deal win over the run's own (mismatched) vertical", async () => {
    const lead = await db.lead.create({
      data: { companyId, firstName: "Vertical", lastName: "Winner", vertical: "roofing" },
    });
    await runInVertical("roofing", () =>
      fireEvent({
        companyId,
        event: "agent_run_failed",
        leadId: lead.id,
        vertical: "solar",
        agentName: "NTP Poller",
        status: "No handler is registered for \"bank.ntp_poll\".",
      })
    );
    const rows = await db.notification.findMany({ where: { companyId }, select: { vertical: true } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.vertical).toBe("roofing");
  });
});
