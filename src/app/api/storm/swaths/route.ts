import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getStormSwaths } from "@/server/modules/storm/queries";
import { getStormConfig } from "@/server/modules/storm/config";

function num(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function date(v: string | null): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "StormIntelligence")) {
    return NextResponse.json({ swaths: [] }, { status: 401 });
  }
  const sp = new URL(req.url).searchParams;
  const cfg = await getStormConfig(user.companyId);
  const lat = num(sp.get("lat"));
  const lng = num(sp.get("lng"));
  const radius = num(sp.get("radius"));
  const swaths = await getStormSwaths({
    from: date(sp.get("from")),
    to: date(sp.get("to")),
    center: lat != null && lng != null ? { lat, lng } : cfg.center,
    radiusMiles: radius != null && radius > 0 ? radius : cfg.radiusMiles,
  });
  return NextResponse.json({ swaths });
}
