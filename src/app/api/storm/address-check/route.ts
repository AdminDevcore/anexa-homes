import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { addressCheck } from "@/server/modules/storm/queries";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "StormIntelligence")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  if (q.length < 4) return NextResponse.json({ error: "Enter a fuller address." }, { status: 400 });
  const radiusRaw = Number(sp.get("radius"));
  const radius = [1, 3, 5, 10].includes(radiusRaw) ? radiusRaw : 10;
  const result = await addressCheck(user.companyId, q, radius);
  return NextResponse.json(result);
}
