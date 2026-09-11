import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";

const leadFindFirst = vi.fn();
const projectFindFirst = vi.fn();
vi.mock("@/server/db/client", () => ({
  prisma: {
    lead: { findFirst: (...a: unknown[]) => leadFindFirst(...a) },
    project: { findFirst: (...a: unknown[]) => projectFindFirst(...a) },
  },
}));

const { leadAccessible, projectAccessible } = await import("../lead-access");

const rep = { userId: "rep-1", companyId: "co-1", role: "sales_rep" as Role };
const owner = { userId: "boss-1", companyId: "co-1", role: "super_admin" as Role };

beforeEach(() => {
  leadFindFirst.mockReset().mockResolvedValue(null);
  projectFindFirst.mockReset().mockResolvedValue(null);
});

describe("leadAccessible", () => {
  it("asks for the row AND the viewer's scope, never the id alone", async () => {
    await leadAccessible(rep, "lead-9");

    const { where } = leadFindFirst.mock.calls[0][0];
    // ANDed, not spread: listScope's own `OR` would be clobbered by a second
    // `OR` key, which is how scoping silently evaporates. See dashboard/scope.ts.
    expect(where.AND[0]).toEqual({ id: "lead-9" });
    expect(JSON.stringify(where.AND[1])).toContain("rep-1");
    expect(JSON.stringify(where.AND[1])).toContain("co-1");
  });

  it("returns null when the deal is outside the viewer's scope", async () => {
    leadFindFirst.mockResolvedValue(null);
    expect(await leadAccessible(rep, "someone-elses-deal")).toBeNull();
  });

  it("hands back the vertical, so a caller can refuse a roofing deal", async () => {
    leadFindFirst.mockResolvedValue({ id: "lead-9", vertical: "solar" });
    expect(await leadAccessible(rep, "lead-9")).toEqual({ id: "lead-9", vertical: "solar" });
  });

  it("does not narrow past the company for a role that sees all of it", async () => {
    await leadAccessible(owner, "lead-9");
    const { where } = leadFindFirst.mock.calls[0][0];
    expect(where.AND[1]).toEqual({ companyId: "co-1" });
  });
});

describe("projectAccessible", () => {
  it("scopes the job the same way", async () => {
    await projectAccessible(rep, "proj-3");
    const { where } = projectFindFirst.mock.calls[0][0];
    expect(where.AND[0]).toEqual({ id: "proj-3" });
    expect(JSON.stringify(where.AND[1])).toContain("rep-1");
  });
});
