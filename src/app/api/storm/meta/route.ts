import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { getStormConfig } from "@/server/modules/storm/config";

// Bootstrap data for the Storm Intelligence UI: search center/radius, assignable
// reps (for zone assignment), and whether the viewer can manage (import/zones).
export async function GET() {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "StormIntelligence")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const canManage = can(user, "manage", "StormIntelligence");
  const cfg = await getStormConfig(user.companyId);

  const reps = await prisma.user.findMany({
    where: {
      companyId: user.companyId,
      status: "active",
      role: { in: ["manager", "sales_rep", "canvasser"] },
    },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ firstName: "asc" }],
  });

  return NextResponse.json({
    center: cfg.center,
    radiusMiles: cfg.radiusMiles,
    canManage,
    reps: reps.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}`.trim() })),
  });
}
