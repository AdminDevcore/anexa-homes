import type { RenderableReport } from "@/server/modules/reports/builders";
import { prisma } from "@/server/db/client";
import type { AccessUser } from "@/server/rbac/guards";
import { getStormMatches, type StormMatchFilters } from "./queries";

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Build an internal Storm Intelligence report (metrics + top leads) for PDF. */
export async function buildStormReport(
  viewer: AccessUser,
  filters: StormMatchFilters,
): Promise<RenderableReport> {
  const matches = await getStormMatches(viewer, filters, 5000);
  const eventCount = await prisma.stormEvent.count({ where: { companyId: viewer.companyId } });

  const leads = matches.filter((m) => m.subjectType === "lead").length;
  const knocks = matches.filter((m) => m.subjectType === "knock").length;
  const high = matches.filter((m) => m.score >= 90).length;
  const avg = matches.length ? Math.round(matches.reduce((n, m) => n + m.score, 0) / matches.length) : 0;
  const top = matches.slice(0, 30);

  const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const scopeBits: string[] = [];
  if (filters.minScore != null) scopeBits.push(`score >= ${filters.minScore}`);
  if (filters.subjectType) scopeBits.push(filters.subjectType === "lead" ? "leads" : "door knocks");

  return {
    title: "Storm Intelligence - Lead Report",
    periodLabel: `As of ${today}`,
    scopeLabel: scopeBits.length ? scopeBits.join(" · ") : "All matches",
    metrics: [
      { label: "Scored matches", value: String(matches.length) },
      { label: "High priority", value: String(high), hint: "score >= 90" },
      { label: "Pipeline leads", value: String(leads) },
      { label: "Door knocks", value: String(knocks) },
      { label: "Average score", value: String(avg) },
      { label: "Storm events on file", value: String(eventCount) },
    ],
    tables: [
      {
        title: "Top storm leads",
        columns: ["Score", "Name", "Address", "Hail", "Wind", "Date of loss"],
        rows: top.map((m) => [
          m.score,
          m.name,
          m.address,
          m.maxHailIn != null ? `${m.maxHailIn.toFixed(2)}in` : "-",
          m.maxWindMph != null ? `${m.maxWindMph}` : "-",
          fmtDate(m.dateOfLoss),
        ]),
      },
    ],
  };
}
