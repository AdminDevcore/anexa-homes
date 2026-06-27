import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getStormMatches } from "@/server/modules/storm/queries";

function cell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const user = await requireUser();
  if (!can(user, "read", "StormIntelligence")) return new NextResponse("Forbidden", { status: 403 });

  const sp = new URL(req.url).searchParams;
  const minScoreRaw = sp.get("minScore");
  const minScore = minScoreRaw != null && minScoreRaw !== "" ? Number(minScoreRaw) : undefined;
  const subject = sp.get("subject");
  const subjectType = subject === "lead" || subject === "knock" ? subject : undefined;

  const matches = await getStormMatches(
    user.companyId,
    { minScore: Number.isFinite(minScore) ? minScore : undefined, subjectType },
    5000,
  );

  const header = [
    "Score",
    "Type",
    "Name",
    "Address",
    "Max hail (in)",
    "Max wind (mph)",
    "Reports nearby",
    "Date of loss",
    "Nearest (mi)",
    "Lat",
    "Lng",
  ];
  const rows = matches.map((m) => [
    m.score,
    m.subjectType,
    m.name,
    m.address,
    m.maxHailIn != null ? m.maxHailIn.toFixed(2) : "",
    m.maxWindMph ?? "",
    m.eventCount,
    m.dateOfLoss ? m.dateOfLoss.slice(0, 10) : "",
    m.distanceMiles,
    m.lat,
    m.lng,
  ]);
  const csv = [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="storm-leads.csv"`,
    },
  });
}
