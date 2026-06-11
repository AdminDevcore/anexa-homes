import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getKnocksInBounds, type Bounds } from "@/server/modules/canvassing/queries";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Canvassing")) {
    return NextResponse.json({ knocks: [] }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const num = (k: string) => Number(searchParams.get(k));
  const bounds: Bounds = {
    minLat: num("minLat"),
    minLng: num("minLng"),
    maxLat: num("maxLat"),
    maxLng: num("maxLng"),
  };
  if (Object.values(bounds).some((v) => Number.isNaN(v))) {
    return NextResponse.json({ knocks: [] }, { status: 400 });
  }
  const repId = searchParams.get("rep") || undefined;
  const statusParam = searchParams.get("status") || "";
  const statuses = statusParam ? statusParam.split(",").filter(Boolean) : undefined;

  const knocks = await getKnocksInBounds(user.companyId, user.userId, user.role, bounds, {
    repId: repId && repId !== "all" ? repId : undefined,
    statuses,
  });
  return NextResponse.json({ knocks });
}
