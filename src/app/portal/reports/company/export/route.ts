import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import {
  resolvePeriod,
  resolveScope,
  buildMasterReport,
} from "@/server/modules/reports/builders";

function cell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const user = await requireUser();
  if (!can(user, "export", "Report")) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const period = resolvePeriod(
    url.searchParams.get("period") ?? "week",
    url.searchParams.get("from") ?? undefined,
    url.searchParams.get("to") ?? undefined,
  );
  const ru = { companyId: user.companyId, userId: user.userId, role: user.role };
  const scope = await resolveScope(ru, url.searchParams.get("scope") ?? undefined);
  const master = await buildMasterReport(ru, period, scope);

  const lines: (string | number)[][] = [];
  lines.push([master.title]);
  lines.push([`Period: ${master.periodLabel}`, `Scope: ${master.scopeLabel}`]);

  for (const section of master.sections) {
    lines.push([]);
    lines.push([`== ${section.title} ==`]);
    lines.push(["Summary"]);
    for (const m of section.metrics) lines.push([`${m.label}${m.hint ? ` (${m.hint})` : ""}`, m.value]);
    for (const t of section.tables) {
      lines.push([]);
      lines.push([t.title]);
      lines.push(t.columns);
      for (const row of t.rows) lines.push(row);
    }
  }

  const csv = lines.map((r) => r.map(cell).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="company-report-${period.preset}.csv"`,
    },
  });
}
