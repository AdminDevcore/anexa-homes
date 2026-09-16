import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { ROLES, roleCan } from "../matrix";

/**
 * What a sales rep may do with contract templates and e-signature.
 *
 * The rule the business asked for, stated as a closed list so it cannot drift:
 * a rep SENDS documents and READS the templates, and does not author them. The
 * two halves are carried by two different verbs — `create` sends an envelope,
 * `update` authors a template (new / rename / field editor / PDF upload /
 * delete all gate on it, see server/modules/esign/actions.ts) — so widening one
 * to fix the other is exactly the mistake this test exists to catch.
 *
 * The reps' complaint that started this was never a missing grant: `create` was
 * always here. The Documents page hid the send button whenever the rep's scoped
 * deal list came back empty, which is every rep in the workspace they land in by
 * default. See e2e/rep-documents.spec.ts.
 */
describe("sales_rep document grants", () => {
  it("may send a document for signature", () => {
    expect(roleCan("sales_rep", "create", "Document")).toBe(true);
  });

  it("may read templates and sent packages", () => {
    expect(roleCan("sales_rep", "read", "Document")).toBe(true);
  });

  it("may not author templates — create, edit, rename and delete all gate on update", () => {
    expect(roleCan("sales_rep", "update", "Document")).toBe(false);
    expect(roleCan("sales_rep", "delete", "Document")).toBe(false);
  });
});

describe("who may send a document for signature", () => {
  const SENDERS: Role[] = ["super_admin", "admin", "manager", "sales_rep"];

  it("is the sales floor plus the roles above it, and nobody else", () => {
    const holders = ROLES.filter((r) => roleCan(r as Role, "create", "Document"));
    expect([...holders].sort()).toEqual([...SENDERS].sort());
  });

  // `accountant_readonly` is listed for the same reason it was added to ROLES:
  // a role absent from a ratchet's list holds whatever it holds while the test
  // passes vacuously. The outside CPA has no Document grant and must not.
  it.each(["canvasser", "marketing", "installer", "accounting", "accountant_readonly"] as Role[])(
    "refuses %s",
    (role) => {
      expect(roleCan(role, "create", "Document")).toBe(false);
    },
  );
});
