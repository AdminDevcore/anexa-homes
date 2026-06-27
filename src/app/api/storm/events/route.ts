import { NextResponse } from "next/server";
import type { StormType } from "@prisma/client";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getStormEvents, type StormEventFilters } from "@/server/modules/storm/queries";
import { getStormConfig } from "@/server/modules/storm/config";

const VALID: StormType[] = ["hail", "wind", "tornado"];

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
    return NextResponse.json({ events: [] }, { status: 401 });
  }
  const sp = new URL(req.url).searchParams;
  const cfg = await getStormConfig(user.companyId);

  const lat = num(sp.get("lat"));
  const lng = num(sp.get("lng"));
  const radius = num(sp.get("radius"));
  const center = lat != null && lng != null ? { lat, lng } : cfg.center;
  const radiusMiles = radius != null && radius > 0 ? radius : cfg.radiusMiles;

  const types = (sp.get("types")?.split(",") ?? []).filter((t): t is StormType =>
    (VALID as string[]).includes(t),
  );

  const filters: StormEventFilters = {
    center,
    radiusMiles,
    types: types.length ? types : undefined,
    from: date(sp.get("from")),
    to: date(sp.get("to")),
    minHailIn: num(sp.get("hailMin")),
    minWindMph: num(sp.get("windMin")),
    county: sp.get("county") || undefined,
    city: sp.get("city") || undefined,
    zip: sp.get("zip") || undefined,
  };

  const events = await getStormEvents(user.companyId, filters);
  return NextResponse.json({ events, center, radiusMiles });
}
