import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";

/**
 * Row scoping on the storm match list.
 *
 * `PropertyStormMatch` carries a bare `leadId` / `knockId` with no Prisma
 * relation, so the rows cannot be filtered by a join — the scope has to be
 * applied to the lead and knock lookups that hydrate them, and any match whose
 * subject did not come back has to be DROPPED. Both halves are tested here:
 * a scope that is applied but not acted on leaks the address anyway, because
 * the match row itself holds lat/lng.
 */

const matchFindMany = vi.fn();
const leadFindMany = vi.fn();
const knockFindMany = vi.fn();
vi.mock("@/server/db/client", () => ({
  prisma: {
    propertyStormMatch: { findMany: (...a: unknown[]) => matchFindMany(...a) },
    lead: { findMany: (...a: unknown[]) => leadFindMany(...a) },
    knock: { findMany: (...a: unknown[]) => knockFindMany(...a) },
  },
}));

const { getStormMatches } = await import("../queries");

const rep = { userId: "rep-1", companyId: "co-1", role: "sales_rep" as Role };
const owner = { userId: "boss-1", companyId: "co-1", role: "super_admin" as Role };

const match = (id: string, leadId: string | null, knockId: string | null = null) => ({
  id,
  leadId,
  knockId,
  lat: 32.7,
  lng: -96.8,
  score: 90,
  distanceMiles: 1,
  dateOfLoss: null,
  eventCount: 2,
  maxHailIn: 1.5,
  maxWindMph: 60,
});

beforeEach(() => {
  matchFindMany.mockReset().mockResolvedValue([]);
  leadFindMany.mockReset().mockResolvedValue([]);
  knockFindMany.mockReset().mockResolvedValue([]);
});

describe("getStormMatches — row scoping", () => {
  it("constrains the lead lookup to the viewer's own deals", async () => {
    matchFindMany.mockResolvedValue([match("m1", "lead-1")]);
    await getStormMatches(rep, {}, 500);

    const where = leadFindMany.mock.calls[0][0].where;
    // listScope(sales_rep, "Lead") — their own deals and their canvassers'.
    expect(JSON.stringify(where)).toContain("rep-1");
    expect(JSON.stringify(where)).toContain("co-1");
  });

  it("drops a match whose lead the viewer may not open", async () => {
    matchFindMany.mockResolvedValue([match("mine", "lead-mine"), match("theirs", "lead-theirs")]);
    // The scoped lookup only returns the one they own.
    leadFindMany.mockResolvedValue([
      { id: "lead-mine", firstName: "Ada", lastName: "Byron", address: "1 Elm", city: "Dallas", state: "TX", zip: "75201" },
    ]);

    const out = await getStormMatches(rep, {}, 500);

    expect(out.map((m) => m.leadId)).toEqual(["lead-mine"]);
  });

  it("constrains the knock lookup to the viewer's own doors", async () => {
    matchFindMany.mockResolvedValue([match("k1", null, "knock-1")]);
    await getStormMatches(rep, {}, 500);

    const where = knockFindMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain("rep-1");
  });

  it("drops a match whose knock the viewer may not open", async () => {
    matchFindMany.mockResolvedValue([match("k1", null, "knock-mine"), match("k2", null, "knock-theirs")]);
    knockFindMany.mockResolvedValue([
      { id: "knock-mine", address: "2 Oak", city: "Dallas", state: "TX", zip: "75201", contactName: "Grace" },
    ]);

    const out = await getStormMatches(rep, {}, 500);

    expect(out.map((m) => m.knockId)).toEqual(["knock-mine"]);
  });

  it("narrows nothing for an owner, who may already see the whole company", async () => {
    matchFindMany.mockResolvedValue([match("m1", "lead-1")]);
    leadFindMany.mockResolvedValue([
      { id: "lead-1", firstName: "Ada", lastName: "Byron", address: "1 Elm", city: "Dallas", state: "TX", zip: "75201" },
    ]);

    const out = await getStormMatches(owner, {}, 500);

    expect(out).toHaveLength(1);
    const where = JSON.stringify(leadFindMany.mock.calls[0][0].where);
    expect(where).toContain("co-1");
    expect(where).not.toContain("boss-1");
  });

  it("still scopes the match rows to the viewer's company", async () => {
    await getStormMatches(rep, {}, 500);
    expect(matchFindMany.mock.calls[0][0].where).toMatchObject({ companyId: "co-1" });
  });
});
