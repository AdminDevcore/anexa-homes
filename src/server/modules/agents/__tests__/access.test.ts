import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import {
  AGENT_ACCESS_KEYS,
  agentCan,
  canEditAgentConfig,
  hasAgentsAccess,
  withAgentsAccess,
  withoutAgentsAccess,
} from "../access";

const as = (role: Role, permissions: Record<string, unknown> = {}) => ({ role, permissions });
const SWITCH = { "Agent:read": true, "Agent:run": true, "Agent:approve": true };

describe("agentCan", () => {
  it("a manager with the switch reads, runs and resolves", () => {
    for (const verb of ["read", "run", "approve"] as const) expect(agentCan(as("manager", SWITCH), verb)).toBe(true);
  });

  it("a manager without it does nothing", () => {
    for (const verb of ["read", "run", "approve"] as const) expect(agentCan(as("manager"), verb)).toBe(false);
  });

  it("ignores the switch's keys on any role but manager", () => {
    expect(agentCan(as("sales_rep", SWITCH), "read")).toBe(false);
    expect(agentCan(as("installer", SWITCH), "run")).toBe(false);
  });

  it("accounting reads, and cannot run or resolve even with the keys", () => {
    expect(agentCan(as("accounting"), "read")).toBe(true);
    expect(agentCan(as("accounting", SWITCH), "run")).toBe(false);
    expect(agentCan(as("accounting", SWITCH), "approve")).toBe(false);
  });

  it("owners and admins hold every verb", () => {
    for (const role of ["super_admin", "admin"] as const) {
      for (const verb of ["read", "run", "approve"] as const) expect(agentCan(as(role), verb)).toBe(true);
    }
  });
});

describe("canEditAgentConfig", () => {
  it("is role-only: a hand-written Agent:update override never grants it", () => {
    expect(canEditAgentConfig(as("super_admin"))).toBe(true);
    expect(canEditAgentConfig(as("admin"))).toBe(true);
    expect(canEditAgentConfig(as("manager", { ...SWITCH, "Agent:update": true, "Agent:create": true }))).toBe(false);
    expect(canEditAgentConfig(as("accounting"))).toBe(false);
  });
});

describe("the switch's keys", () => {
  it("on writes all three and keeps every other key", () => {
    const next = withAgentsAccess({ "Lead:delete": true });
    expect(next).toEqual({ "Lead:delete": true, ...SWITCH });
    expect(hasAgentsAccess(next)).toBe(true);
  });

  it("off deletes them — never writes false, which would override a role grant", () => {
    const next = withoutAgentsAccess({ "Lead:delete": true, ...SWITCH });
    expect(next).toEqual({ "Lead:delete": true });
    for (const k of AGENT_ACCESS_KEYS) expect(k in next).toBe(false);
  });

  it("needs all three to count as on, and survives junk", () => {
    expect(hasAgentsAccess({ "Agent:read": true })).toBe(false);
    expect(hasAgentsAccess(null)).toBe(false);
    expect(withAgentsAccess("junk")).toEqual(SWITCH);
  });
});
