import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { getActiveVertical } from "@/server/auth/vertical";
import { prisma } from "@/server/db/client";

export type LeadLookupItem = {
  id: string;
  name: string;
  subtitle: string | null;
  assignedRepId: string | null;
  assignedRepName: string | null;
};

/**
 * Typeahead for the "tag a job" picker on a task. Deliberately separate from
 * `/api/search` (the ⌘K palette): this one is scoped to the ACTIVE vertical and
 * carries the deal's assigned rep, so the task form can pre-select the person
 * who actually owns the job.
 *
 * Scoping is `listScope(user, "Lead")` — a rep can only ever find their own
 * deals, which is the same rule `createTaskAction` re-checks server-side.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Lead")) {
    return NextResponse.json({ leads: [] }, { status: 401 });
  }

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ leads: [] });

  const contains = { contains: q, mode: "insensitive" as const };
  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const vertical = await getActiveVertical(user);

  const leads = await prisma.lead.findMany({
    where: {
      AND: [
        scope,
        { vertical },
        {
          OR: [
            { firstName: contains },
            { lastName: contains },
            { email: contains },
            { phone: contains },
            { address: contains },
          ],
        },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      address: true,
      city: true,
      state: true,
      assignedRepId: true,
      assignedRep: { select: { firstName: true, lastName: true } },
    },
  });

  return NextResponse.json({
    leads: leads.map(
      (l): LeadLookupItem => ({
        id: l.id,
        name: `${l.firstName} ${l.lastName}`.trim(),
        subtitle:
          [l.address, [l.city, l.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || null,
        assignedRepId: l.assignedRepId,
        assignedRepName: l.assignedRep
          ? `${l.assignedRep.firstName} ${l.assignedRep.lastName}`.trim()
          : null,
      })
    ),
  });
}
