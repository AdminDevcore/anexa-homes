import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import { ACTIONS, ROLES, roleCan, type Action } from "../matrix";

/**
 * Who holds what on Agent, by ROLE. The per-person switch for Operations is an
 * override on top of this and is tested in modules/agents/__tests__/access.test.ts.
 *
 * Written out verb by verb because super_admin's grant is `manage`, and
 * `manage` is silent: reading it out loud is the only way a reviewer sees that
 * a sales manager is excluded on purpose.
 */
const expectVerb = (verb: Action, allowed: Role[]) => {
  for (const role of ROLES as readonly Role[]) {
    expect(roleCan(role, verb, "Agent"), `${role} ${verb} Agent`).toBe(allowed.includes(role));
  }
};

describe("Agent grants", () => {
  it("only owners and admins create or edit an agent", () => {
    expectVerb("create", ["super_admin", "admin"]);
    expectVerb("update", ["super_admin", "admin"]);
  });

  it("owners, admins and accounting read agents and runs", () => {
    expectVerb("read", ["super_admin", "admin", "accounting"]);
  });

  it("only owners and admins run or resolve by role", () => {
    expectVerb("run", ["super_admin", "admin"]);
    expectVerb("approve", ["super_admin", "admin"]);
  });

  it("a sales manager holds nothing on Agent by role", () => {
    for (const verb of ACTIONS) expect(roleCan("manager", verb, "Agent"), `manager ${verb}`).toBe(false);
  });
});
