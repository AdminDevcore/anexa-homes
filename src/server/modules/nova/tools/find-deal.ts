import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { addressContains, formatMailingAddress } from "@/lib/address";
import { NOT_CANCELLED } from "@/server/modules/leads/cancelled";
import { NOT_SET, looksLikePhone, phoneDigits, phoneMatches } from "../format";
import { defineTool, z } from "./define";

const contains = (v: string) => ({ contains: v, mode: "insensitive" as const });

export const findDeal = defineTool({
  name: "find_deal",
  kind: "read",
  description:
    "Find Solar deals by the customer's name, street address, email or phone number. Returns up to five matches, each with a deal_id. Call this first whenever the user names a customer.",
  input: z.object({
    query: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .describe("A name, address, email or phone number, as the user said it."),
  }),
  async run(ctx, { query }) {
    // Deliberately NOT /api/search: that route searches every workspace the user
    // is granted. This one reads the active workspace only, and says so twice —
    // the isolation extension, and the explicit `vertical` below.
    const scope = listScope(ctx.user, "Lead") as Prisma.LeadWhereInput;
    const phone = looksLikePhone(query);

    const text: Prisma.LeadWhereInput = phone
      ? // Every stored shape keeps the last four digits contiguous; narrow on
        // those, then compare digits properly below.
        { phone: contains(phoneDigits(query).slice(-4)) }
      : {
          OR: [
            ...addressContains(query),
            {
              AND: query
                .split(/\s+/)
                .filter(Boolean)
                .map((token) => ({
                  OR: [
                    { firstName: contains(token) },
                    { lastName: contains(token) },
                    { email: contains(token) },
                    ...addressContains(token),
                  ],
                })),
            },
          ],
        };

    const leads = await prisma.lead.findMany({
      where: { AND: [scope, { vertical: "solar" }, NOT_CANCELLED, text] },
      orderBy: { updatedAt: "desc" },
      take: phone ? 50 : 6,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        address: true,
        city: true,
        state: true,
        zip: true,
        stage: { select: { name: true } },
        assignedRep: { select: { firstName: true, lastName: true } },
      },
    });
    const hits = phone ? leads.filter((l) => phoneMatches(l.phone, query)) : leads;

    return {
      ok: true,
      data: {
        matches: hits.slice(0, 5).map((l) => ({
          deal_id: l.id,
          customer: `${l.firstName} ${l.lastName}`.trim(),
          address: formatMailingAddress(l) || NOT_SET,
          phone: l.phone ?? NOT_SET,
          stage: l.stage?.name ?? NOT_SET,
          assigned_rep: l.assignedRep
            ? `${l.assignedRep.firstName} ${l.assignedRep.lastName}`.trim()
            : NOT_SET,
        })),
        more_matches: hits.length > 5,
      },
    };
  },
});
